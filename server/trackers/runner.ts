import type { Database } from "bun:sqlite";
import { createEstimatingTokenizer, defaultTemplateOf, fillTemplate } from "../prompt/index.ts";
import type { BuiltPrompt } from "../prompt/index.ts";
import { activePath, speakerLookup, type SceneRow } from "../db/queries/history.ts";
import { activeTrackerOf, writeTracker } from "../db/queries/trackers.ts";
import { taskConfig, templateOf } from "../db/queries/tasks.ts";
import { TRACKER_KINDS, trackerOpKey, taskKind } from "../tasks/registry.ts";
import type { TrackerKind } from "../../shared/types.ts";
import type { TaskRunner } from "../tasks/runner.ts";
import type { WebhookSender } from "../webhooks/sender.ts";

/**
 * Writing the structured trackers (SPEC §8, §20 phase 31).
 *
 * Same shape as the guides — a side call per kind, versioned, pinned, flushed —
 * but the reply is JSON and the parse is strict. §8's rule is the whole point:
 * a malformed reply keeps the previous state and logs, because a tracker that
 * wipes itself on a bad answer is worse than no tracker.
 */

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

/** A tracker's question, from its template. Pure. */
export function trackerQuestion(template: string, input: { transcript: string; previous: string | null }): string {
  return fillTemplate(template, {
    transcript: input.transcript,
    previous: input.previous === null ? "Nothing has been written down yet." : input.previous.trim(),
  }).trim();
}

export function buildTrackerPrompt(question: string): BuiltPrompt {
  const tokenizer = createEstimatingTokenizer();
  const system =
    `You keep one structured JSON note about a story in progress and rewrite it as the story moves. ` +
    `You reply with JSON only — no preamble, no code fences, no explanation.`;
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
          label: "Tracker",
          source: "guided op",
          role: "system",
          content: system,
          placement: { kind: "prefix" },
          tokens: tokenizer.count(system),
        },
        {
          id: "trackers",
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
      loreTrace: [],
      retrievedChunks: [],
    },
  };
}

/**
 * Parse strictly: a JSON object is the bar. Anything else — prose, a fence, an
 * array where an object was asked — is a failure the caller keeps the previous
 * state over.
 */
export function parseTrackerReply(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  // A model that wraps its JSON in a fence still gets read, but nothing else:
  // the outermost object is the contract.
  const open = trimmed.indexOf("{");
  const close = trimmed.lastIndexOf("}");
  if (open === -1 || close <= open) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed.slice(open, close + 1));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export interface TrackerRunnerOptions {
  db: Database;
  tasks: TaskRunner;
}

export class TrackerRunner {
  private readonly db: Database;
  private readonly tasks: TaskRunner;
  private stopped = false;
  /** §15's outbound webhooks. Bound late, and optional: nothing here waits. */
  private webhooks: WebhookSender | null = null;

  constructor(options: TrackerRunnerOptions) {
    this.db = options.db;
    this.tasks = options.tasks;
  }

  setWebhooks(sender: WebhookSender): void {
    this.webhooks = sender;
  }

  shutdown(): void {
    this.stopped = true;
  }

  private automatic(): TrackerKind[] {
    return TRACKER_KINDS.filter((kind) => {
      const op = taskKind(trackerOpKey(kind));
      if (op === null) return false;
      const row = taskConfig(this.db, op);
      return row.enabled === 1 && row.auto_trigger === 1;
    });
  }

  willRunAutomatically(): boolean {
    return this.automatic().length > 0;
  }

  async refresh(
    scene: SceneRow,
    options: { kinds?: TrackerKind[]; automatic: boolean } = { automatic: false },
  ): Promise<void> {
    const kinds = options.kinds ?? (options.automatic ? this.automatic() : [...TRACKER_KINDS]);
    const leaf = scene.active_leaf_id;
    for (const kind of kinds) {
      if (this.stopped) return;
      await this.refreshOne(scene, kind, leaf);
    }
  }

  private async refreshOne(scene: SceneRow, kind: TrackerKind, leaf: number | null): Promise<void> {
    const op = taskKind(trackerOpKey(kind));
    if (op === null) return;
    const row = taskConfig(this.db, op);

    const previous = activeTrackerOf(this.db, scene.id, kind);
    if (previous !== null && previous.is_pinned === 1) {
      this.tasks.noteSkipped(
        { kind: op, sceneId: scene.id, fallbackProfileId: scene.connection_profile_id },
        "You edited this one, so it was left alone.",
      );
      return;
    }

    const question = trackerQuestion(templateOf(row, op), {
      transcript: transcriptOf(this.db, scene),
      previous: previous?.content ?? null,
    });

    const outcome = await this.tasks.run({
      kind: op,
      sceneId: scene.id,
      prompt: buildTrackerPrompt(question),
      profileId: row.connection_profile_id,
      fallbackProfileId: scene.connection_profile_id,
    });
    if (!outcome.ok || this.stopped) return;

    const parsed = parseTrackerReply(outcome.text);
    if (parsed === null) {
      // §8: a tracker failure must never block generation, and a malformed
      // reply keeps the previous state. The run is logged, the turn is not.
      this.tasks.noteUnusable(
        { kind: op, sceneId: scene.id, fallbackProfileId: scene.connection_profile_id, prompt: buildTrackerPrompt(question) },
        outcome.text,
        "The reply was not a JSON object.",
      );
      return;
    }

    const content = JSON.stringify(parsed, null, 2);
    writeTracker(this.db, {
      sceneId: scene.id,
      kind,
      content,
      messageId: leaf,
      pinned: false,
    });

    // §15's `tracker.updated`. Not awaited, like everything else a webhook
    // touches: a receiver that stopped answering must not delay the next turn.
    if (this.webhooks?.anyFor("tracker.updated") === true) {
      this.webhooks.emit(
        "tracker.updated",
        { sceneId: scene.ulid, sceneTitle: scene.title },
        { kind, content: parsed },
      );
    }
  }
}

export { defaultTemplateOf };
