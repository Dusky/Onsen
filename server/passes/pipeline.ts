import type { Database } from "bun:sqlite";
import { createEstimatingTokenizer } from "../prompt/index.ts";
import {
  activePath,
  findMessageById,
  reparseSegments,
  segmentDtosOf,
  speakerLookup,
  updateMessage,
  type MessageRow,
  type SceneRow,
} from "../db/queries/history.ts";
import { recordAnnotation, setPassesPending } from "../db/queries/annotations.ts";
import { taskConfig } from "../db/queries/tasks.ts";
import {
  LOCK_CHECK,
  PASS_KEYS,
  PROSE_REFINE,
  SLOP_SCAN,
  taskKind,
  VOICE_CHECK,
} from "../tasks/registry.ts";
import { activeBans } from "../db/queries/options.ts";
import { findBanned } from "../options/analyse.ts";
import type { TaskRunner } from "../tasks/runner.ts";
import {
  buildLockCheckPrompt,
  buildRefinePrompt,
  buildVoiceCheckPrompt,
  cleanRefinement,
  parseVerdict,
} from "./prompts.ts";

/**
 * The post-generation pipeline (SPEC §7.5).
 *
 * An ordered set of passes that run after a message is generated and can revise
 * it. ReCast's rationale, which is sound: a model cannot go back once it has
 * committed to a response, but a second model reading the finished text can
 * catch what the first one got wrong.
 *
 * Three rules shape the whole thing.
 *
 * **It never delays the turn.** §7 is absolute that a background task must not
 * block or fail a user-facing generation, so the message lands first and the
 * pipeline runs behind it; `passes_pending` is what tells a client to look
 * again. A pipeline that made every turn wait on three extra model calls would
 * be a worse product than no pipeline.
 *
 * **A pass that cannot be read says nothing.** Every failure — unreachable
 * model, timeout, a reply in no recognisable shape — is recorded and moved past.
 * A pass that shouts at the user because a small model rambled is worse than
 * one that stays quiet.
 *
 * **Only one pass rewrites, and it keeps the original.** §7.5 is deliberate
 * that the user-lock check flags rather than rewriting: a pass that quietly
 * replaces a turn is a second author nobody hired.
 */

export interface PipelineOptions {
  db: Database;
  tasks: TaskRunner;
}

export interface RunPassesOptions {
  scene: SceneRow;
  message: MessageRow;
  /**
   * True when the pipeline is running because a turn just landed rather than
   * because the user asked. Only passes with `auto_trigger` take part.
   */
  automatic: boolean;
}

export class PassPipeline {
  private readonly db: Database;
  private readonly tasks: TaskRunner;
  private stopped = false;

  constructor(options: PipelineOptions) {
    this.db = options.db;
    this.tasks = options.tasks;
  }

  shutdown(): void {
    this.stopped = true;
  }

  /** Which passes would run, in order. Empty is a perfectly normal answer. */
  private scheduled(automatic: boolean): string[] {
    return PASS_KEYS.filter((key) => {
      const kind = taskKind(key);
      if (kind === null) return false;
      const row = taskConfig(this.db, kind);
      if (row.enabled === 0) return false;
      // Asked for by hand, every enabled pass runs; automatically, only the
      // ones the user put on the automatic list (SPEC §7's `auto_trigger`).
      return !automatic || row.auto_trigger === 1;
    }).sort((a, b) => (taskKind(a)?.passOrder ?? 0) - (taskKind(b)?.passOrder ?? 0));
  }

  /** True when a turn landing should start the pipeline at all. */
  willRunAutomatically(scene: SceneRow): boolean {
    return scene.auto_passes === 1 && this.scheduled(true).length > 0;
  }

  /**
   * Run the passes over one message. Never throws: every failure is recorded
   * against the message and the next pass carries on.
   */
  async run(options: RunPassesOptions): Promise<void> {
    const keys = this.scheduled(options.automatic);
    if (keys.length === 0) return;

    setPassesPending(this.db, options.message.id, true);
    try {
      for (const key of keys) {
        if (this.stopped) return;
        // Re-read each time: an earlier pass may have rewritten the content the
        // next one is about to judge.
        const current = findMessageById(this.db, options.message.id);
        if (current === null) return;
        await this.runOne(key, options.scene, current);
      }
    } finally {
      if (!this.stopped) setPassesPending(this.db, options.message.id, false);
    }
  }

  private async runOne(key: string, scene: SceneRow, message: MessageRow): Promise<void> {
    switch (key) {
      case VOICE_CHECK:
        return this.voiceCheck(scene, message);
      case LOCK_CHECK:
        return this.lockCheck(scene, message);
      case SLOP_SCAN:
        return this.slopScan(scene, message);
      case PROSE_REFINE:
        return this.refine(scene, message);
      default:
        return;
    }
  }

  private request(key: string, scene: SceneRow, prompt: ReturnType<typeof buildLockCheckPrompt>) {
    const kind = taskKind(key)!;
    const row = taskConfig(this.db, kind);
    return {
      kind,
      sceneId: scene.id,
      prompt,
      profileId: row.connection_profile_id,
      fallbackProfileId: scene.connection_profile_id,
    };
  }

  /* ---------------- the passes ---------------- */

  /**
   * Voice validation, per part (SPEC §7.5).
   *
   * The flagship. One author voicing a whole cast is this product's
   * architecture, and voices converging is the risk that architecture runs — so
   * a beat is read part by part and the annotation names which one drifted,
   * rather than saying the exchange as a whole felt off.
   */
  private async voiceCheck(scene: SceneRow, message: MessageRow): Promise<void> {
    const speakers = speakerLookup(this.db);
    const segments = segmentDtosOf(this.db, message, speakers);
    const tokenizer = createEstimatingTokenizer();

    for (const segment of segments) {
      if (this.stopped) return;
      if (segment.speakerType !== "character" || segment.characterId === null) continue;

      const character = this.db
        .query("SELECT name, description, voice_notes FROM characters WHERE ulid = $ulid")
        .get({ ulid: segment.characterId }) as
        | { name: string; description: string | null; voice_notes: string | null }
        | null;
      if (character === null) continue;

      const outcome = await this.tasks.run(
        this.request(
          VOICE_CHECK,
          scene,
          buildVoiceCheckPrompt(
            {
              character: {
                name: character.name,
                description: character.description,
                voiceNotes: character.voice_notes,
              },
              text: segment.content,
              earlier: this.earlierLines(scene, message, segment.characterId),
            },
            tokenizer,
          ),
        ),
      );

      const ordinal = segments.length > 1 ? segment.ordinal : null;
      if (!outcome.ok) {
        this.note(message, VOICE_CHECK, ordinal, "failed", outcome.detail);
        continue;
      }
      const verdict = parseVerdict(outcome.text, "drift");
      if (verdict === null) {
        this.note(message, VOICE_CHECK, ordinal, "failed", "The reply gave no verdict.");
        continue;
      }
      this.note(
        message,
        VOICE_CHECK,
        ordinal,
        verdict.flagged ? "flagged" : "ok",
        verdict.detail ??
          (verdict.flagged ? `${character.name} does not sound like themselves here.` : null),
      );
    }
  }

  /** What this character said earlier, so "sounds like them" has a reference. */
  private earlierLines(scene: SceneRow, message: MessageRow, characterUlid: string): string[] {
    const speakers = speakerLookup(this.db);
    const lines: string[] = [];
    for (const row of activePath(this.db, scene.id)) {
      if (row.id === message.id) break;
      for (const segment of segmentDtosOf(this.db, row, speakers)) {
        if (segment.characterId === characterUlid) lines.push(segment.content);
      }
    }
    // The most recent few: a voice is judged against how it has been sounding,
    // not against everything it ever said.
    return lines.slice(-3);
  }

  /**
   * The user-lock check (SPEC §0.5, §7.5).
   *
   * Flags. It does not rewrite, and §7.5 says so explicitly — the fix for the
   * author taking over the reader's character is a regeneration the user asks
   * for, not a silent edit that leaves them wondering what changed.
   */
  /**
   * The slop scan (SPEC §7.5, §13.6).
   *
   * The only pass that makes no model call, and that is the point of storing
   * the ban list as data rather than as a paragraph in the prompt: matching
   * text against a list is exact, instant and free, where asking a model
   * whether a turn contains a banned phrase would be slow, expensive, and
   * occasionally wrong about something that is simply true or not.
   *
   * It flags rather than rewriting, like the user-lock check. A phrase on the
   * list is not always a mistake — a character can say "in that moment" — so
   * the decision is the author's, and the pass is a reader pointing at a line.
   */
  private async slopScan(scene: SceneRow, message: MessageRow): Promise<void> {
    const bans = activeBans(this.db, scene.id).map((row) => row.phrase);
    const hits = findBanned(message.content, bans);
    // The one pass that says nothing when it is happy, and the reason is the
    // reason it needs no model: it cannot fail. Every other pass records `ok`
    // because "it ran and was happy" and "it never ran" are different things
    // to know — a small model can ramble, time out, or answer unreadably. This
    // one either found a phrase or it did not, so silence is unambiguous, and
    // a clean note on every turn forever would be a row per turn saying so.
    if (hits.length === 0) return Promise.resolve();
    this.note(
      message,
      SLOP_SCAN,
      null,
      "flagged",
      `${hits.length === 1 ? "Banned phrasing" : "Banned phrasings"}: ${hits
        .map((phrase) => `"${phrase}"`)
        .join(", ")}.`,
    );
    return Promise.resolve();
  }

  private async lockCheck(scene: SceneRow, message: MessageRow): Promise<void> {
    const persona =
      scene.persona_id === null
        ? { name: null, description: null }
        : ((this.db
            .query("SELECT name, description FROM personas WHERE id = $id")
            .get({ id: scene.persona_id }) as
            | { name: string; description: string | null }
            | null) ?? { name: null, description: null });

    const outcome = await this.tasks.run(
      this.request(
        LOCK_CHECK,
        scene,
        buildLockCheckPrompt(
          { persona, text: message.content },
          createEstimatingTokenizer(),
        ),
      ),
    );

    if (!outcome.ok) {
      this.note(message, LOCK_CHECK, null, "failed", outcome.detail);
      return;
    }
    const verdict = parseVerdict(outcome.text, "taken");
    if (verdict === null) {
      this.note(message, LOCK_CHECK, null, "failed", "The reply gave no verdict.");
      return;
    }
    this.note(
      message,
      LOCK_CHECK,
      null,
      verdict.flagged ? "flagged" : "ok",
      verdict.detail ??
        (verdict.flagged
          ? `This turn writes ${persona.name ?? "your character"}.`
          : null),
    );
  }

  /**
   * Prose refinement — the only pass that replaces (SPEC §7.5).
   *
   * The original is kept on the annotation so the change can be seen and undone.
   * Off by default, because it costs a second full generation.
   */
  private async refine(scene: SceneRow, message: MessageRow): Promise<void> {
    const speakers = speakerLookup(this.db);
    const speaker =
      message.character_id === null
        ? "the narrator"
        : (speakers.nameById.get(message.character_id) ?? "the narrator");

    const outcome = await this.tasks.run(
      this.request(
        PROSE_REFINE,
        scene,
        buildRefinePrompt({ text: message.content, speaker }, createEstimatingTokenizer()),
      ),
    );

    if (!outcome.ok) {
      this.note(message, PROSE_REFINE, null, "failed", outcome.detail);
      return;
    }

    const refined = cleanRefinement(outcome.text);
    // A pass that comes back with what it was given has not refined anything,
    // and recording a revision nobody can see would be noise with a revert
    // button on it.
    if (refined === "" || refined === message.content.trim()) {
      this.note(message, PROSE_REFINE, null, "ok", "Nothing worth changing.");
      return;
    }

    const original = message.content;
    const updated = updateMessage(this.db, message.id, { content: refined });
    if (updated.kind === "beat") reparseSegments(this.db, updated);
    this.note(message, PROSE_REFINE, null, "revised", "Vocabulary and rhythm.", original);
  }

  private note(
    message: MessageRow,
    passKey: string,
    segmentOrdinal: number | null,
    status: "ok" | "flagged" | "revised" | "failed",
    detail: string | null,
    originalContent?: string,
  ): void {
    // Shutting down closes the database out from under an in-flight pass.
    if (this.stopped) return;
    try {
      recordAnnotation(this.db, {
        messageId: message.id,
        passKey,
        segmentOrdinal,
        status,
        detail,
        ...(originalContent === undefined ? {} : { originalContent }),
      });
    } catch {
      /* A finding is not worth failing an exit path for. */
    }
  }
}
