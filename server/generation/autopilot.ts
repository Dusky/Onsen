import type { Database } from "bun:sqlite";
import type { Tokenizer, BuiltPrompt } from "../prompt/index.ts";
import { createEstimatingTokenizer } from "../prompt/index.ts";
import { AUTOPILOT_CHECK, taskKind } from "../tasks/registry.ts";
import type { TaskRunner } from "../tasks/runner.ts";
import { findSceneById } from "../db/queries/history.ts";
import type { MessageRow, SceneRow } from "../db/queries/history.ts";
import type { AutopilotStateDto, AutopilotStopReason } from "../../shared/types.ts";
import type { GenerationService } from "./service.ts";

/**
 * Autopilot (SPEC §6): after a reply completes, keep writing turns until one of
 * five things says stop — the cap, the reader, the stop control, a character
 * turning to face the reader, or a failure.
 *
 * The loop lives on the server for the same reason generation does (§0.7): a
 * phone suspending its tab must not stop the scene, and a client that vanishes
 * mid-run must be able to come back and find it still going. It is memory, not
 * a row — an autopilot that resumed after a restart would be a scene writing
 * itself with nobody watching, which is a different and worse feature than the
 * one the reader turned on.
 *
 * One rule shapes the wiring: the loop never gets in the reader's way. Anything
 * the reader does — sends a message, revises a turn, asks the author something —
 * stops it first (`yieldToUser`), and a turn the reader started themselves is
 * what arms it, not what interrupts it. Autopilot is a mode the scene is in,
 * not a process the reader competes with.
 */

/* ------------------------------------------------------------------ */
/* The addressed check — pure                                          */
/* ------------------------------------------------------------------ */

/** How much of the turn the check is shown. It needs the drift, not the prose. */
const EXCERPT_LIMIT = 900;

export interface AddressedInput {
  /** The reader's character, by name. Null when they have not named one. */
  persona: string | null;
  /** Who the turn is attributed to — a character, or narration. */
  speaker: string;
  /** The turn's content. */
  content: string;
}

/** The question, as text. Separated from the prompt so it can be read in a test. */
export function addressedQuestion(input: AddressedInput): string {
  const reader = input.persona ?? "the reader";
  const flat = input.content.replace(/\s+/g, " ").trim();
  const excerpt = flat.length <= EXCERPT_LIMIT ? flat : `${flat.slice(0, EXCERPT_LIMIT - 1)}…`;
  return [
    `You are reading a turn from a story, written by one author voicing the whole cast.`,
    ``,
    `The turn, attributed to ${input.speaker}:`,
    excerpt,
    ``,
    `Does anyone in this turn address ${reader} directly — speaking to them, ` +
      `asking them something, or otherwise turning to face them in a way that ` +
      `waits on their answer? Ordinary narration that mentions them does not ` +
      `count; a question or a direct address does.`,
    ``,
    `Answer with one word, YES or NO, and nothing else.`,
  ].join("\n");
}

export function buildAddressedPrompt(input: AddressedInput, tokenizer: Tokenizer): BuiltPrompt {
  const system =
    `You decide, quickly and without commentary, whether a turn of a story has ` +
    `turned to face the reader. You answer in the exact format you are given.`;
  const question = addressedQuestion(input);
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
          label: "Addressed check",
          source: "autopilot",
          role: "system",
          content: system,
          placement: { kind: "prefix" },
          tokens: tokenizer.count(system),
        },
        {
          id: "spotlight_instruction",
          label: "Question",
          source: "autopilot",
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
    },
  };
}

/**
 * Read the answer. True means addressed, false means not, null means unreadable
 * — and an unreadable answer counts as *not* addressed, for the same reason the
 * classifier's failures fall back rather than fail: a check that could stop the
 * scene on a hiccup is worse than no check. The cap still bounds the run.
 */
export function parseAddressedReply(text: string): boolean | null {
  const first = text.trim().split(/\r?\n/, 1)[0] ?? "";
  const flat = first.trim().toLowerCase();
  if (flat === "") return null;
  // The word has to lead or at least appear on the first line: past it, the
  // model has started talking, and its answer is not on later lines.
  if (flat.startsWith("yes")) return true;
  if (flat.startsWith("no")) return false;
  if (/\byes\b/.test(flat)) return true;
  if (/\bno\b/.test(flat)) return false;
  return null;
}

/* ------------------------------------------------------------------ */
/* The loop                                                            */
/* ------------------------------------------------------------------ */

interface LoopState {
  sceneId: number;
  /** Turns the loop has written this run. Counted when one of ours lands. */
  turns: number;
  running: boolean;
  /** Why the last run ended. Kept for the row the state endpoint returns. */
  stopReason: AutopilotStopReason | null;
  /** The generation in flight, when the loop is mid-turn. */
  generationId: string | null;
}

export interface AutopilotRunnerOptions {
  db: Database;
  tasks: TaskRunner;
  now?: () => number;
}

export class AutopilotRunner {
  private readonly db: Database;
  private readonly tasks: TaskRunner;
  private readonly now: () => number;
  private readonly loops = new Map<number, LoopState>();
  private generation: GenerationService | null = null;
  private stopped = false;

  constructor(options: AutopilotRunnerOptions) {
    this.db = options.db;
    this.tasks = options.tasks;
    this.now = options.now ?? Date.now;
  }

  /**
   * Bound after both exist, because the runner starts turns and the service
   * reports landings — each needs the other, so one link is made late.
   */
  attach(generation: GenerationService): void {
    this.generation = generation;
  }

  /** The process is going away. Loops end; nothing writes another turn. */
  shutdown(): void {
    this.stopped = true;
  }

  /* ---------------- called by the generation service ---------------- */

  /**
   * A turn finished. `movesScene` is true only for a turn that appended to the
   * tree as a spotlight or beat — a revise is an edit, a recast is a splice, an
   * OOC answer is not a turn in the scene at all, and none of them is the
   * "reply completes" §6 means.
   */
  onTurnFinished(
    sceneId: number,
    generationId: string,
    messageId: number | null,
    movesScene: boolean,
    status: "complete" | "cancelled" | "error",
  ): void {
    if (this.stopped) return;
    const loop = this.loops.get(sceneId);

    if (loop === undefined || !loop.running) {
      // Nothing is running. A completed reply is the moment §6 arms the loop:
      // the reader sent a message, the scene answered, and autopilot continues
      // from there — but only if the scene asked for it.
      //
      // The addressed check does *not* run on this turn, ever. The reply the
      // reader just got is an answer to something they said; addressing them
      // is what an answer does, and a loop that stopped there would never
      // write its first turn.
      if (status === "complete" && movesScene && messageId !== null) {
        const scene = findSceneById(this.db, sceneId);
        if (scene !== null && scene.autopilot_enabled === 1) {
          this.startTurn(scene, this.begin(scene, 0));
        }
      }
      return;
    }

    if (status === "error") {
      this.end(loop, "error");
      return;
    }
    if (status === "cancelled") {
      // The stop control cancels the turn and ends the loop itself, in that
      // order; this is the belt to that braces.
      this.end(loop, "stopped");
      return;
    }

    // A turn landed while the loop runs. Only one the loop wrote counts
    // against the cap — and only one the loop wrote is read for having turned
    // to face the reader, which is §6's "a character addresses the persona":
    // a turn the reader asked for is allowed to address them, because it is
    // theirs.
    if (generationId !== loop.generationId || messageId === null || !movesScene) return;
    loop.turns += 1;
    void this.advance(sceneId, messageId);
  }

  /* ---------------- the loop itself ---------------- */

  private begin(scene: SceneRow, turns: number): LoopState {
    const loop: LoopState = {
      sceneId: scene.id,
      turns,
      running: true,
      stopReason: null,
      generationId: null,
    };
    this.loops.set(scene.id, loop);
    return loop;
  }

  private end(loop: LoopState, reason: AutopilotStopReason): void {
    loop.running = false;
    loop.stopReason = reason;
    loop.generationId = null;
  }

  /** Decide whether another turn follows one the loop just wrote. */
  private async advance(sceneId: number, messageId: number): Promise<void> {
    const scene = findSceneById(this.db, sceneId);
    if (scene === null) return;
    const current = this.loops.get(sceneId);
    if (current === undefined || !current.running) return;

    // The switch may have been thrown while a turn was in flight. The loop
    // respects it immediately: a reader who turned autopilot off mid-run has
    // already said what they want, and one more turn is one too many.
    if (scene.autopilot_enabled !== 1) {
      this.end(current, "off");
      return;
    }

    if (current.turns >= scene.autopilot_max_turns) {
      this.end(current, "cap");
      return;
    }

    // The one stop that needs to be *detected* rather than counted or pressed.
    // §6: a character addressing the reader's persona directly is the story
    // handing the scene back, and the loop must see it the moment it happens.
    const addressed = await this.checkAddressed(scene, messageId);
    if (this.stopped) return;
    if (addressed === true) {
      this.end(current, "addressed");
      return;
    }

    const fresh = findSceneById(this.db, sceneId);
    if (fresh === null || fresh.autopilot_enabled !== 1) {
      this.end(current, "off");
      return;
    }
    this.startTurn(fresh, current);
  }

  /** Start the loop's next turn, or end the loop if it cannot be started. */
  private startTurn(scene: SceneRow, loop: LoopState): void {
    try {
      const snapshot = this.generation!.start({ scene });
      loop.generationId = snapshot.id;
    } catch {
      // Anything refusing the start — a route failure, a missing profile —
      // ends the loop rather than retrying into the same wall.
      this.end(loop, "error");
    }
  }

  /**
   * Ask the side call whether the turn faced the reader. Never throws, never
   * stops the loop on its own failure: an unreachable checker reads as "not
   * addressed", and the cap remains the bound.
   */
  private async checkAddressed(scene: SceneRow, messageId: number): Promise<boolean | null> {
    const kind = taskKind(AUTOPILOT_CHECK)!;
    const message = this.db
      .query("SELECT * FROM messages WHERE id = $id")
      .get({ id: messageId }) as MessageRow | null;
    if (message === null) return null;

    const personaRow =
      scene.persona_id === null
        ? null
        : (this.db
            .query("SELECT name FROM personas WHERE id = $id")
            .get({ id: scene.persona_id }) as { name: string } | null);
    const persona = personaRow?.name ?? null;

    const outcome = await this.tasks.run({
      kind,
      sceneId: scene.id,
      profileId: null,
      fallbackProfileId: scene.connection_profile_id,
      prompt: buildAddressedPrompt(
        {
          persona,
          speaker: message.character_id === null
            ? "narration"
            : ((this.db.query("SELECT name FROM characters WHERE id = $id").get({
                id: message.character_id,
              }) as { name: string } | null)?.name ?? "a character"),
          content: message.content,
        },
        createEstimatingTokenizer(),
      ),
    });
    if (!outcome.ok) return null;
    return parseAddressedReply(outcome.text);
  }

  /* ---------------- called by routes and the reader ---------------- */

  /**
   * Stop the loop and wait for its in-flight turn to settle, so the caller can
   * safely write to the tree behind it. The turn keeps whatever it produced —
   * cancel keeps partial output by design (§5.6), and the reader may well want
   * to read what half-arrived.
   */
  async stop(sceneId: number, reason: AutopilotStopReason): Promise<void> {
    const loop = this.loops.get(sceneId);
    if (loop === undefined || !loop.running) return;
    const inFlight = loop.generationId;
    this.end(loop, reason);
    if (inFlight !== null && this.generation !== null) {
      this.generation.cancel(inFlight);
      await this.generation.awaitSettled(inFlight);
    }
  }

  /**
   * What every reader-driven entry point calls before it touches a scene that
   * might be autopiloting: stop the loop, wait for the turn in flight, and get
   * out of the way. A no-op when nothing is running, which is the common case
   * and must stay cheap.
   */
  async yieldToUser(sceneId: number): Promise<void> {
    await this.stop(sceneId, "user");
  }

  /** The state row the client reads. */
  stateOf(sceneId: number): AutopilotStateDto {
    const loop = this.loops.get(sceneId);
    const scene = findSceneById(this.db, sceneId);
    const maxTurns = scene?.autopilot_max_turns ?? 3;
    if (loop === undefined) {
      return { active: false, turns: 0, maxTurns, stopReason: null, generationId: null };
    }
    return {
      active: loop.running,
      turns: loop.turns,
      maxTurns,
      stopReason: loop.stopReason,
      generationId: loop.generationId,
    };
  }
}
