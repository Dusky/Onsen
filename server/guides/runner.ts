import type { Database } from "bun:sqlite";
import { createEstimatingTokenizer, defaultTemplateOf, fillTemplate } from "../prompt/index.ts";
import type { BuiltPrompt } from "../prompt/index.ts";
import { activePath, speakerLookup, type SceneRow } from "../db/queries/history.ts";
import { activeGuideOf, writeGuide } from "../db/queries/guides.ts";
import { taskConfig, templateOf } from "../db/queries/tasks.ts";
import { GUIDE_KINDS, guideOpKey, taskKind, type GuideKind } from "../tasks/registry.ts";
import type { TaskRunner } from "../tasks/runner.ts";

/**
 * Writing the persistent guides (SPEC §8).
 *
 * Each guide is a side call on phase 11's primitive with its own model, its own
 * auto-trigger and its own words — which is why they are six ops rather than
 * one with a parameter: §8 is specific that Thinking, Clothes and State default
 * on and the others do not, and that is a per-guide decision, not a setting.
 *
 * A refresh is handed the previous version. A guide that forgot everything each
 * time it ran would lose exactly the state it exists to carry: a coat somebody
 * took off three turns ago has to stay off.
 */

/** How much of the scene a guide is shown. Enough to write from. */
const HISTORY_TURNS = 14;
const EXCERPT_LIMIT = 500;

function excerpt(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length <= EXCERPT_LIMIT ? flat : `${flat.slice(0, EXCERPT_LIMIT - 1)}…`;
}

function transcriptOf(db: Database, scene: SceneRow): string {
  const speakers = speakerLookup(db);
  const lines = activePath(db, scene.id)
    .filter((row) => row.is_hidden === 0)
    .slice(-HISTORY_TURNS)
    .map((row) => {
      const who =
        row.character_id === null
          ? row.author_type === "user"
            ? "The reader"
            : "Narration"
          : (speakers.nameById.get(row.character_id) ?? "Someone");
      return `${who}: ${excerpt(row.content)}`;
    });
  return lines.length === 0 ? "(the scene has not started)" : lines.join("\n");
}

function previousClause(previous: string | null): string {
  return previous === null
    ? "Nothing has been written down yet."
    : `What you wrote last time:\n${previous.trim()}`;
}

export interface GuidePromptInput {
  transcript: string;
  previous: string | null;
  /** The custom guide's question, which is the user's own (SPEC §8). */
  input: string;
}

/** The question one guide asks, from its template. Pure, so a test can read it. */
export function guideQuestion(template: string, input: GuidePromptInput): string {
  return fillTemplate(template, {
    transcript: input.transcript,
    previous: previousClause(input.previous),
    input: input.input,
  }).trim();
}

export function buildGuidePrompt(question: string, tokenizer = createEstimatingTokenizer()): BuiltPrompt {
  const system =
    `You keep one short note about a story in progress, and rewrite it as the story moves. You ` +
    `reply with the note and nothing else — no preamble, no explanation of what changed.`;
  const tokens = tokenizer.count(system) + tokenizer.count(question);
  return {
    system,
    messages: [{ role: "user", content: question }],
    outlets: {},
    debug: {
      mode: "author",
      tokensAreEstimated: tokenizer.isEstimate,
      tokenizerId: tokenizer.id,
      budget: tokens,
      reservedForResponse: 0,
      available: tokens,
      fixedTokens: tokenizer.count(system),
      historyTokens: tokenizer.count(question),
      totalTokens: tokens,
      headroom: 0,
      blocks: [
        {
          id: "system_prompt",
          label: "Guide",
          // The marker every side call carries, so the harness and the task log
          // can tell one from a turn.
          source: "guided op",
          role: "system",
          content: system,
          placement: { kind: "prefix" },
          tokens: tokenizer.count(system),
        },
        {
          id: "guides",
          label: "Question",
          source: "guided op",
          role: "user",
          content: question,
          placement: { kind: "depth", depth: 0 },
          tokens: tokenizer.count(question),
        },
      ],
      evicted: [],
      historyIncluded: [],
      unresolvedOutlets: [],
      unknownMacros: [],
    },
  };
}

/** Trim the wrapping a model puts around a note it was asked to write. */
export function cleanGuide(text: string): string {
  return text
    .trim()
    .replace(/^(?:here(?:'s| is)[^\n:]{0,60}:)\s*\n+/i, "")
    .trim();
}

export interface GuideRunnerOptions {
  db: Database;
  tasks: TaskRunner;
}

export class GuideRunner {
  private readonly db: Database;
  private readonly tasks: TaskRunner;
  private stopped = false;

  constructor(options: GuideRunnerOptions) {
    this.db = options.db;
    this.tasks = options.tasks;
  }

  shutdown(): void {
    this.stopped = true;
  }

  /** Which guides would refresh unasked after a turn. */
  private automatic(): GuideKind[] {
    return GUIDE_KINDS.filter((kind) => {
      const op = taskKind(guideOpKey(kind));
      if (op === null) return false;
      const row = taskConfig(this.db, op);
      return row.enabled === 1 && row.auto_trigger === 1;
    });
  }

  willRunAutomatically(): boolean {
    return this.automatic().length > 0;
  }

  /**
   * Refresh guides. Never throws: a guide is a note the author keeps, and a
   * note that could break the turn it is about would not be worth having (§7).
   */
  async refresh(
    scene: SceneRow,
    options: { kinds?: GuideKind[]; automatic: boolean } = { automatic: false },
  ): Promise<void> {
    const kinds = options.kinds ?? (options.automatic ? this.automatic() : this.enabled());
    const leaf = scene.active_leaf_id;

    for (const kind of kinds) {
      if (this.stopped) return;
      await this.refreshOne(scene, kind, leaf);
    }
  }

  /** Every guide that is switched on, for a rebuild the user asked for. */
  private enabled(): GuideKind[] {
    return GUIDE_KINDS.filter((kind) => {
      const op = taskKind(guideOpKey(kind));
      return op !== null && taskConfig(this.db, op).enabled === 1;
    });
  }

  private async refreshOne(
    scene: SceneRow,
    kind: GuideKind,
    leaf: number | null,
  ): Promise<void> {
    const op = taskKind(guideOpKey(kind));
    if (op === null) return;
    const row = taskConfig(this.db, op);

    const previous = activeGuideOf(this.db, scene.id, kind);
    // A version somebody wrote by hand is theirs. SPEC §8 makes guides
    // hand-editable, and a refresh that overwrote the edit would make editing
    // pointless.
    if (previous !== null && previous.is_pinned === 1) {
      this.tasks.noteSkipped(
        { kind: op, sceneId: scene.id, fallbackProfileId: scene.connection_profile_id },
        "You edited this one, so it was left alone.",
      );
      return;
    }

    // The custom guide has no built-in question — §8 calls it a free-form
    // user-defined injection, so with nothing written there is nothing to ask.
    const userQuestion = scene.custom_guide_prompt?.trim() ?? "";
    if (kind === "custom" && userQuestion === "") {
      this.tasks.noteSkipped(
        { kind: op, sceneId: scene.id, fallbackProfileId: scene.connection_profile_id },
        "No question written for the custom guide yet.",
      );
      return;
    }

    const question = guideQuestion(templateOf(row, op), {
      transcript: transcriptOf(this.db, scene),
      previous: previous?.content ?? null,
      input: userQuestion,
    });

    const outcome = await this.tasks.run({
      kind: op,
      sceneId: scene.id,
      prompt: buildGuidePrompt(question),
      profileId: row.connection_profile_id,
      fallbackProfileId: scene.connection_profile_id,
    });
    if (!outcome.ok || this.stopped) return;

    const content = cleanGuide(outcome.text);
    // An empty note is not a note. Keeping the previous version is better than
    // replacing it with nothing.
    if (content === "") return;

    writeGuide(this.db, { sceneId: scene.id, kind, content, messageId: leaf });
  }
}

export { defaultTemplateOf };
