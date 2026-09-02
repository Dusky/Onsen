import type { Database } from "bun:sqlite";
import { createEstimatingTokenizer, defaultTemplateOf, fillTemplate } from "../prompt/index.ts";
import type { BuiltPrompt } from "../prompt/index.ts";
import {
  activePath,
  speakerLookup,
  type MessageRow,
  type SceneRow,
} from "../db/queries/history.ts";
import {
  activeSummaries,
  countWords,
  markSuperseded,
  pendingForSummary,
  replaceSummaryContent,
  summaryIsDue,
  writeSummary,
  type SummaryRow,
} from "../db/queries/summaries.ts";
import { taskConfig, templateOf } from "../db/queries/tasks.ts";
import { RESUMMARISE, SUMMARISE, taskKind } from "../tasks/registry.ts";
import type { TaskRunner } from "../tasks/runner.ts";

/**
 * Rolling summarisation (SPEC §11 layer 1).
 *
 * The mechanism is phase 11's side call again, so all of that comes free: its
 * own model, its own timeout, a bounded run log, and a failure that costs
 * nothing. What is new here is *when* and *over what*.
 *
 * **When** is §11's pair of thresholds — every N messages or N words, whichever
 * comes first — counted over the messages that have not been summarised yet.
 * Two thresholds rather than one because message count and volume diverge
 * wildly in a roleplay: twenty one-line exchanges and twenty long descriptive
 * turns are the same number and a very different amount of story.
 *
 * **Over what** is everything after the last summary and before the threshold's
 * protected tail. Summarising right up to the leaf would spend a model call
 * describing the turn that just happened, which the prompt is still showing in
 * full and will keep showing for another N messages.
 */

/** How much of a message the summariser is shown. Enough to summarise from. */
const EXCERPT_LIMIT = 1_200;

/**
 * When the summaries themselves are worth condensing (§11). A budget in tokens
 * rather than a count, because the point is the size of the block the prompt
 * carries, and twelve terse summaries can be cheaper than four long ones.
 */
const RESUMMARISE_BUDGET_TOKENS = 1_500;
/** How many are folded together at a time. Enough to be worth a call. */
const RESUMMARISE_RUN = 4;

function excerpt(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length <= EXCERPT_LIMIT ? flat : `${flat.slice(0, EXCERPT_LIMIT - 1)}…`;
}

export function transcriptOf(db: Database, messages: MessageRow[]): string {
  const speakers = speakerLookup(db);
  return messages
    .filter((row) => row.is_hidden === 0)
    .map((row) => {
      const who =
        row.character_id === null
          ? row.author_type === "user"
            ? "The reader"
            : "Narration"
          : (speakers.nameById.get(row.character_id) ?? "Someone");
      return `${who}: ${excerpt(row.content)}`;
    })
    .join("\n");
}

function previousClause(previous: SummaryRow | null): string {
  return previous === null
    ? "This is the first stretch; nothing has been summarised yet."
    : `What the record already says about earlier stretches — context only, do not ` +
      `repeat it:\n${previous.content.trim()}`;
}

/** The question one summarisation asks, from its template. Pure, so a test can read it. */
export function summaryQuestion(
  template: string,
  input: { transcript: string; previous: string },
): string {
  return fillTemplate(template, input).trim();
}

export function buildSummaryPrompt(
  question: string,
  tokenizer = createEstimatingTokenizer(),
): BuiltPrompt {
  const system =
    `You keep the record of a long story: you read a stretch of it and write down what happened, ` +
    `accurately and briefly. You reply with the record and nothing else — no preamble, no ` +
    `commentary on the writing.`;
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
          label: "Summary",
          // The marker every side call carries, so the harness and the task log
          // can tell one from a turn.
          source: "guided op",
          role: "system",
          content: system,
          placement: { kind: "prefix" },
          tokens: tokenizer.count(system),
        },
        {
          id: "summaries",
          label: "Stretch",
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
      // A side call's prompt has no lore to explain.
      loreTrace: [],
      // A side call's prompt recalls no documents.
      retrievedChunks: [],
    },
  };
}

/** Trim the wrapping a model puts around a record it was asked to write. */
export function cleanSummary(text: string): string {
  return text
    .trim()
    .replace(/^(?:here(?:'s| is)[^\n:]{0,80}:)\s*\n+/i, "")
    .replace(/^(?:summary|record)\s*:\s*/i, "")
    .trim();
}

export interface SummaryRunnerOptions {
  db: Database;
  tasks: TaskRunner;
}

export class SummaryRunner {
  private readonly db: Database;
  private readonly tasks: TaskRunner;
  private stopped = false;

  constructor(options: SummaryRunnerOptions) {
    this.db = options.db;
    this.tasks = options.tasks;
  }

  shutdown(): void {
    this.stopped = true;
  }

  /** Whether an automatic run would do anything, so a caller can skip the await. */
  willRunAutomatically(scene: SceneRow): boolean {
    if (scene.summarise === 0) return false;
    const op = taskKind(SUMMARISE);
    if (op === null) return false;
    const row = taskConfig(this.db, op);
    if (row.enabled === 0 || row.auto_trigger === 0) return false;
    return summaryIsDue(pendingForSummary(this.db, scene), scene);
  }

  /**
   * Summarise if it is time to, then condense the summaries if they have grown
   * past their budget. Never throws: §7 is absolute that a background task
   * cannot fail a turn, and a scene that stops remembering is bad where a scene
   * that crashes is worse.
   */
  async run(
    scene: SceneRow,
    options: { automatic: boolean } = { automatic: false },
  ): Promise<void> {
    if (scene.summarise === 0) return;
    const op = taskKind(SUMMARISE);
    if (op === null) return;
    const row = taskConfig(this.db, op);
    if (row.enabled === 0) return;
    if (options.automatic && row.auto_trigger === 0) return;

    const path = activePath(this.db, scene.id);
    const pending = pendingForSummary(this.db, scene, path);
    // A manual run summarises whatever is waiting; an automatic one waits for
    // one of §11's two thresholds.
    if (pending.length === 0) {
      if (!options.automatic) {
        this.tasks.noteSkipped(
          { kind: op, sceneId: scene.id, fallbackProfileId: scene.connection_profile_id },
          "Nothing old enough to summarise yet.",
        );
      }
      return;
    }
    if (options.automatic && !summaryIsDue(pending, scene)) return;

    await this.summariseRun(scene, pending);
    if (this.stopped) return;
    await this.condense(scene);
  }

  private async summariseRun(scene: SceneRow, pending: MessageRow[]): Promise<void> {
    const op = taskKind(SUMMARISE);
    if (op === null) return;
    const row = taskConfig(this.db, op);

    const existing = activeSummaries(this.db, scene.id);
    const question = summaryQuestion(templateOf(row, op), {
      transcript: transcriptOf(this.db, pending),
      previous: previousClause(existing.at(-1) ?? null),
    });

    const request = {
      kind: op,
      sceneId: scene.id,
      prompt: buildSummaryPrompt(question),
      profileId: row.connection_profile_id,
      fallbackProfileId: scene.connection_profile_id,
    };
    const outcome = await this.tasks.run(request);
    if (!outcome.ok || this.stopped) return;

    const content = cleanSummary(outcome.text);
    // An empty record is not a record, and writing one would mark the range
    // summarised — losing the messages behind a paragraph that says nothing.
    if (content === "") {
      this.tasks.noteUnusable(request, outcome.text, "The model returned nothing to record.");
      return;
    }

    writeSummary(this.db, {
      sceneId: scene.id,
      content,
      coversFromMessageId: pending[0]!.id,
      coversToMessageId: pending.at(-1)!.id,
      messageCount: pending.length,
    });
  }

  /**
   * Fold the oldest run of summaries into one when the block has outgrown its
   * budget (§11: "summaries can be re-summarised when they themselves grow past
   * a budget").
   *
   * An edited summary is never folded. §11 marks edits so regeneration does not
   * clobber them, and a fold is regeneration by another name — it would put
   * somebody's own words through a model and keep the output. That can leave
   * the block over budget, which is the right way round: the user wrote it, so
   * the user decides when it goes.
   */
  private async condense(scene: SceneRow): Promise<void> {
    const op = taskKind(RESUMMARISE);
    if (op === null) return;
    const row = taskConfig(this.db, op);
    if (row.enabled === 0) return;

    const all = activeSummaries(this.db, scene.id);
    const total = all.reduce((sum, item) => sum + item.token_count, 0);
    if (total <= RESUMMARISE_BUDGET_TOKENS) return;

    // The oldest unbroken run of unedited summaries, since folding across an
    // edited one would either swallow it or leave a gap in the range.
    const run: SummaryRow[] = [];
    for (const item of all) {
      if (item.is_edited === 1) break;
      run.push(item);
      if (run.length === RESUMMARISE_RUN) break;
    }
    if (run.length < 2) return;

    const question = summaryQuestion(templateOf(row, op), {
      transcript: run.map((item, at) => `Stretch ${at + 1}:\n${item.content}`).join("\n\n"),
      previous: "",
    });

    const outcome = await this.tasks.run({
      kind: op,
      sceneId: scene.id,
      prompt: buildSummaryPrompt(question),
      profileId: row.connection_profile_id,
      fallbackProfileId: scene.connection_profile_id,
    });
    if (!outcome.ok || this.stopped) return;

    const content = cleanSummary(outcome.text);
    if (content === "") return;
    // A fold that came back longer than what went in has not condensed
    // anything, and replacing four summaries with something bigger would make
    // the problem it exists to fix worse.
    const tokenizer = createEstimatingTokenizer();
    if (tokenizer.count(content) >= run.reduce((sum, item) => sum + item.token_count, 0)) return;

    const folded = writeSummary(this.db, {
      sceneId: scene.id,
      content,
      coversFromMessageId: run[0]!.covers_from_message_id,
      coversToMessageId: run.at(-1)!.covers_to_message_id,
      messageCount: run.reduce((sum, item) => sum + item.message_count, 0),
      level: Math.max(...run.map((item) => item.level)) + 1,
    });
    markSuperseded(
      this.db,
      run.map((item) => item.id),
      folded.id,
    );
  }

  /**
   * Rewrite one summary over the same range, which is what a user pressing
   * "write it again" means. An edited one is rewritten too: they asked.
   */
  async rewrite(scene: SceneRow, summary: SummaryRow): Promise<SummaryRow | null> {
    const op = taskKind(summary.level === 0 ? SUMMARISE : RESUMMARISE);
    if (op === null) return null;
    const row = taskConfig(this.db, op);

    const path = activePath(this.db, scene.id);
    const from = path.findIndex((item) => item.id === summary.covers_from_message_id);
    const to = path.findIndex((item) => item.id === summary.covers_to_message_id);
    if (from === -1 || to === -1) return null;

    const earlier = activeSummaries(this.db, scene.id).filter(
      (item) =>
        item.id !== summary.id &&
        item.covers_to_message_id !== summary.covers_to_message_id,
    );
    const question = summaryQuestion(templateOf(row, op), {
      transcript: transcriptOf(this.db, path.slice(from, to + 1)),
      previous: previousClause(earlier.at(-1) ?? null),
    });

    const outcome = await this.tasks.run({
      kind: op,
      sceneId: scene.id,
      prompt: buildSummaryPrompt(question),
      profileId: row.connection_profile_id,
      fallbackProfileId: scene.connection_profile_id,
    });
    if (!outcome.ok) return null;

    const content = cleanSummary(outcome.text);
    if (content === "") return null;
    return replaceSummaryContent(this.db, summary.id, content);
  }
}

export { countWords };
