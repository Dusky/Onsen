import type { Database } from "bun:sqlite";
import { ulid } from "../lib/ulid.ts";
import type { Keyring } from "../lib/crypto.ts";
import { createAdapter as defaultCreateAdapter, AdapterError, type Adapter } from "../adapters/index.ts";
import { buildPrompt, createEstimatingTokenizer, PromptBudgetError } from "../prompt/index.ts";
import { DEFAULT_BEAT_BOUND } from "../../shared/types.ts";
import type {
  BeatBound,
  MessageKind,
  ResolvedTurnScope,
  SamplerSettings,
  TurnScope,
} from "../../shared/types.ts";
import type { PromptDocumentChunk } from "../prompt/types.ts";
import {
  activePath,
  appendMessage,
  applySegmentExpressions,
  findMessageById,
  findSceneById,
  reparseSegments,
  replaceSegment,
  segmentDtosOf,
  segmentRowsOf,
  speakerLookup,
  type MessageRow,
  type MessageRowWithSiblings,
  type SceneRow,
} from "../db/queries/history.ts";
import { buildPromptContext, presetIdFor, resolvePreset } from "./context.ts";
import { resolveRoute, RouteError, type ResolvedRoute } from "./route.ts";
import { internalIdOf, resolveNextSpeaker } from "./turn.ts";
import {
  buildClassifierPrompt,
  parseClassifierReply,
  type ClassifierCandidate,
} from "./classifier.ts";
import { castRowsOf } from "../db/queries/authors.ts";
import { taskKind, TURN_CLASSIFIER } from "../tasks/registry.ts";
import type { TaskRunner } from "../tasks/runner.ts";
import type { PassPipeline } from "../passes/pipeline.ts";
import type { GuideRunner } from "../guides/runner.ts";
import type { SummaryRunner } from "../summaries/runner.ts";
import type { TrackerRunner } from "../trackers/runner.ts";
import { ReasoningSplitter, parseReasoningConfig } from "./reasoning.ts";
import { OocSplitter } from "./ooc.ts";
import { ExprSplitter } from "./expression.ts";
import { retrieve } from "../documents/store.ts";
import type { AutopilotRunner } from "./autopilot.ts";
import { templateFor } from "../db/queries/instruct.ts";
import { scriptText } from "../scripts/runtime.ts";
import type { TriggerRunner } from "../triggers/runner.ts";
import type { WebhookSender } from "../webhooks/sender.ts";
import type { WebhookEvent } from "../webhooks/events.ts";
import { sceneChannel } from "../sync/channel.ts";
import { recall, type MemoryRunner } from "../memory/runner.ts";
import type { PromptMemoryEntity } from "../prompt/types.ts";
import type { MemoryRecallTrace } from "../../shared/types.ts";
import type { InstructTemplate } from "../prompt/index.ts";
import type { TaskRunStatus } from "../../shared/types.ts";

/**
 * The generation service (SPEC §5).
 *
 * The server owns generation. A generation outlives the request that started it
 * and the client that was watching it: mobile browsers suspend backgrounded tabs
 * and drop connections on network handoff, so the design assumption is that the
 * client will disappear mid-stream and come back wanting the part it missed.
 *
 * The buffer is the whole mechanism. Everything generated is appended to it,
 * subscribers are told the offset each chunk starts at, and a reconnecting
 * client asks for everything past the offset it already has.
 */

export type GenerationStatus = "pending" | "streaming" | "complete" | "cancelled" | "error";

export type { GenerationMeta } from "@shared/types.ts";
import type { GenerationMeta } from "@shared/types.ts";

/**
 * What the turn director settled on, announced before any prose arrives.
 *
 * SPEC §6 requires the decision to be exposed in the UI, and with the
 * classifier it is not known until the generation is already under way — the
 * call has to happen somewhere, and doing it inside `start()` would make
 * pressing send wait on a second model. So it is an event: the composer says
 * "choosing", then names who and why, then the prose streams under it.
 */
export interface DirectorEvent {
  characterId: string | null;
  name: string;
  reason: string;
  source: "user" | "director";
  scope: ResolvedTurnScope;
}

export type GenerationEvent =
  | ({ type: "director" } & DirectorEvent)
  | { type: "chunk"; offset: number; text: string }
  /**
   * Reasoning, streamed separately from the prose (SPEC §13). Deltas rather
   * than offsets: a reconnecting client is replayed the whole block at once,
   * because nobody reads reasoning a token at a time — it is collapsed by
   * default, and what matters live is only that something is happening.
   */
  | { type: "reasoning"; text: string }
  | { type: "done"; messageId: string; meta: GenerationMeta }
  | { type: "cancelled"; messageId: string | null; meta: GenerationMeta }
  | { type: "error"; message: string; detail: string | null };

export interface GenerationSnapshot {
  id: string;
  sceneId: string;
  status: GenerationStatus;
  /** Everything generated so far. */
  buffer: string;
  /** Character length of `buffer`; what a client resumes from. */
  offset: number;
  /** Reasoning so far, hidden from the prose by default (SPEC §13). */
  reasoning: string;
  messageId: string | null;
  meta: GenerationMeta | null;
  /** Null until the director has decided, which the classifier does mid-flight. */
  director: DirectorEvent | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

interface ActiveGeneration {
  id: string;
  rowId: number;
  sceneId: number;
  sceneUlid: string;
  parentId: number | null;
  status: GenerationStatus;
  buffer: string;
  /** Reasoning, kept apart from the prose all the way to the message (§13). */
  reasoning: string;
  /** Splits inline `<think>` tags out of the stream. Stateful across chunks. */
  splitter: ReasoningSplitter;
  /**
   * Splits out-of-character asides out of the stream (§7). Runs whether or not
   * the scene invited one: a model that volunteers `((…))` unprompted must
   * still not have it land in the middle of the scene.
   */
  oocSplitter: OocSplitter;
  /** Splits `<expr>` tags out of the prose, storing them apart (§12). */
  exprSplitter: ExprSplitter;
  meta: GenerationMeta;
  error: string | null;
  detail: string | null;
  messageUlid: string | null;
  /** Which cast member this turn is voiced as, recorded on the message. */
  spotlightId: number | null;
  /** The character the user cued, which always beats the strategy (SPEC §6). */
  requestedSpotlightId: number | null;
  /** What was asked for, and where the result lands (SPEC §3.5, §7). */
  turn: ResolvedTurn;
  /** Announced once, before streaming, and replayed to anyone who joins late. */
  director: DirectorEvent | null;
  /** The message this turn produced, for the passes that read it afterwards. */
  landedMessageId: number | null;
  /** One-shot direction for this generation, never stored as a message (§7). */
  nudge: string | null;
  abort: AbortController;
  listeners: Set<(event: GenerationEvent) => void>;
  startedAt: number;
  finishedAt: number | null;
  /**
   * The automation ids of the lore entries that fired for this turn (§10, §14).
   * Collected at build time and dispatched after the turn - see `runTriggers`.
   */
  automationIds: string[];
  /** Characters already written to the database. */
  persistedOffset: number;
  lastPersistAt: number;
}

/** Finished generations linger so a client that reconnects late still sees the end. */
const FINISHED_TTL_MS = 5 * 60 * 1000;

/** How often the buffer is flushed to the database while streaming. */
const PERSIST_INTERVAL_MS = 1_000;

export interface GenerationServiceOptions {
  db: Database;
  keyring: Keyring;
  now?: () => number;
  /** Injected in tests so no live provider is ever contacted (§23). */
  createAdapter?: typeof defaultCreateAdapter;
  /** Runs the side calls a turn needs, off the main path (SPEC §7). */
  tasks: TaskRunner;
  /** Reads a finished turn and can revise it (SPEC §7.5). */
  passes: PassPipeline;
  /** Keeps the persistent guides current (SPEC §8). */
  guides: GuideRunner;
  /** Keeps the structured trackers current (SPEC §8). */
  trackers: TrackerRunner;
  /** Condenses old history when it is time to (SPEC §11). */
  summaries: SummaryRunner;
}

/**
 * What asking the classifier came to.
 *
 * `decided` is the answer; `why` is the sentence explaining its absence, which
 * exists because "no answer" and "no answer because the model was unreachable"
 * look identical to a user otherwise.
 */
interface ClassifierOutcome {
  decided: { characterId: string; name: string; reason: string; scope: ResolvedTurnScope } | null;
  why: string | null;
}

/** Why the fallback is standing, in words that belong under a cast strip. */
function reasonForFailure(status: Exclude<TaskRunStatus, "ok">): string {
  switch (status) {
    case "skipped":
      return "the classifier is turned off";
    case "timeout":
      return "the classifier took too long";
    case "cancelled":
      return "the turn was cancelled";
    case "unusable":
      return "the classifier answered with nothing";
    case "failed":
      return "the classifier could not be reached";
  }
}

export interface StartOptions {
  scene: SceneRow;
  /**
   * Where the new message attaches. Defaults to the scene's active leaf.
   * Captured now rather than at completion, so a leaf move mid-generation
   * cannot silently reparent the result.
   */
  parentId?: number | null;
  /** Per-call profile override — the mechanism behind per-operation routing (§7). */
  connectionProfileId?: number | null;
  /**
   * Who speaks this turn. Omitted means the first cast member; the turn
   * director picks in phase 8, and a guided op can force a speaker.
   */
  spotlightId?: number | null;
  /**
   * One character or several (SPEC §3.5). Defaults to a spotlight. A beat with
   * fewer than two active cast members degrades to a spotlight in the context
   * builder rather than being refused.
   */
  scope?: TurnScope;
  /** How long a beat runs. Ignored for a spotlight. */
  beatBound?: BeatBound;
  /**
   * Rewrite one character's part of an existing beat, holding the rest of it
   * fixed (SPEC §7). The result is spliced into that beat rather than appended
   * as a new message.
   */
  recast?: { message: MessageRow; ordinal: number };
  /**
   * A one-shot instruction for this generation only (SPEC §7). Injected at
   * depth 0 and never persisted as a message: a nudge is direction, not
   * something the reader said, and a scene that fills up with the user's stage
   * directions reads wrong on the next pass.
   */
  nudge?: string;
  /**
   * Produce a better version of a turn that already exists (SPEC §7). The
   * result is a sibling of the target, so nothing is lost — expanding a turn
   * and disliking the result must leave the original one swipe away.
   */
  revise?: { message: MessageRow; mode: "expand" | "correct" | "continue"; instructions?: string };
  /**
   * Answer the reader out of character (SPEC §7). The question is already a
   * message in the tree by the time this is called — unlike a nudge, an OOC
   * question *is* something the reader said, and the answer would make no sense
   * beside a transcript that did not contain it.
   */
  ooc?: { question: string };
}

/**
 * What this generation produces and where it goes.
 *
 * A spotlight and a beat both append a message; a recast edits one that already
 * exists. Keeping the three in one value is what lets `finish` land the output
 * without re-deriving what was asked for half an hour after the request.
 */
type ResolvedTurn =
  | { kind: "spotlight" }
  /** The director decides one voice or several. Never survives past `direct`. */
  | { kind: "auto"; bound: BeatBound }
  | { kind: "beat"; bound: BeatBound }
  | { kind: "recast"; messageId: number; ordinal: number; beatText: string; characterName: string }
  | {
      kind: "revise";
      mode: "expand" | "correct" | "continue";
      original: string;
      instructions?: string;
      /** Who the target was voiced as, so the new version is voiced the same. */
      characterId: number | null;
      characterName: string;
      /** The target's parent: the new version is its sibling, not its child. */
      parentId: number | null;
      /** A revised beat is still a beat, and still needs parsing into parts. */
      targetKind: MessageKind;
    }
  /** Answering the reader out of character (SPEC §7). The scene does not move. */
  | { kind: "ooc"; question: string };

export class GenerationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "GenerationError";
    this.code = code;
  }
}

export class GenerationService {
  private readonly db: Database;
  private readonly keyring: Keyring;
  private readonly now: () => number;
  private readonly makeAdapter: typeof defaultCreateAdapter;
  private readonly tasks: TaskRunner;
  private readonly passes: PassPipeline;
  private readonly guides: GuideRunner;
  private readonly trackers: TrackerRunner;
  private readonly summaries: SummaryRunner;
  private readonly active = new Map<string, ActiveGeneration>();
  /**
   * Set once the process is shutting down. Aborting a generation resolves
   * asynchronously, so its run loop can reach `finish` after the database has
   * already been closed — on SIGTERM in production as readily as in a test.
   * Past this point the service stops writing and only unwinds.
   */
  private stopped = false;

  constructor(options: GenerationServiceOptions) {
    this.db = options.db;
    this.keyring = options.keyring;
    this.now = options.now ?? Date.now;
    this.makeAdapter = options.createAdapter ?? defaultCreateAdapter;
    this.tasks = options.tasks;
    this.passes = options.passes;
    this.guides = options.guides;
    this.trackers = options.trackers;
    this.summaries = options.summaries;
  }

  /* ---------------- lifecycle ---------------- */

  /**
   * Begin a generation and return its identifier immediately (SPEC §5.1). The
   * work continues in the background; the caller subscribes to watch it.
   */
  start(options: StartOptions): GenerationSnapshot {
    const scene = options.scene;

    // One generation per scene at a time. Two in flight would race to attach to
    // the same parent, and the second would silently become a sibling of the
    // first — a swipe the user never asked for.
    for (const generation of this.active.values()) {
      if (
        generation.sceneId === scene.id &&
        (generation.status === "pending" || generation.status === "streaming")
      ) {
        throw new GenerationError(
          "already_generating",
          "This scene is already generating. Cancel it first.",
        );
      }
    }

    const route = this.resolveRoute(scene, options.connectionProfileId ?? null);
    const turn = resolveTurn(this.db, options);
    // A recast rewrites part of a beat, so it generates from the history the
    // beat itself was generated from: everything up to that beat's parent.
    const beat = turn.kind === "recast" ? findMessageById(this.db, turn.messageId) : null;
    const parentId =
      beat !== null
        ? beat.parent_id
        : // A revised turn is a sibling of the one it revises, so the original
          // is always one swipe away.
          turn.kind === "revise"
          ? turn.parentId
          : options.parentId === undefined
            ? scene.active_leaf_id
            : options.parentId;
    const startedAt = this.now();
    const id = ulid();

    const row = this.db
      .query(
        `INSERT INTO generations (ulid, scene_id, parent_id, status, buffer, offset, started_at)
         VALUES ($ulid, $scene_id, $parent_id, 'pending', '', 0, $started_at)
         RETURNING id`,
      )
      .get({ ulid: id, scene_id: scene.id, parent_id: parentId, started_at: startedAt }) as {
      id: number;
    };

    const generation: ActiveGeneration = {
      id,
      rowId: row.id,
      sceneId: scene.id,
      sceneUlid: scene.ulid,
      parentId,
      status: "pending",
      buffer: "",
      reasoning: "",
      splitter: new ReasoningSplitter(),
      oocSplitter: new OocSplitter(),
      exprSplitter: new ExprSplitter(),
      meta: {
        provider: route.providerName,
        model: route.model,
        ttftMs: null,
        completionTokens: null,
        tokensPerSecond: null,
        promptTokens: 0,
        tokensAreEstimated: true,
        samplers: {},
      },
      error: null,
      detail: null,
      messageUlid: null,
      // Resolved now rather than at completion: the cast can change mid-turn,
      // and the message must record who actually spoke. An explicit choice
      // wins; otherwise the turn director decides (SPEC §6).
      // For a recast the character is already known. For everything else the
      // director decides once the generation is running: the classifier is a
      // model call, and pressing send must not wait on one.
      spotlightId:
        turn.kind === "recast"
          ? recastSpeakerId(this.db, turn)
          : turn.kind === "revise"
            ? turn.characterId
            : null,
      requestedSpotlightId: options.spotlightId ?? null,
      turn,
      director: null,
      landedMessageId: null,
      nudge: options.nudge?.trim() === "" ? null : (options.nudge ?? null),
      abort: new AbortController(),
      listeners: new Set(),
      startedAt,
      finishedAt: null,
      automationIds: [],
      persistedOffset: 0,
      lastPersistAt: startedAt,
    };
    this.active.set(id, generation);

    // Deliberately not awaited: SPEC §5.1 returns the identifier immediately and
    // the generation continues without a client attached.
    void this.run(generation, scene, route);

    return this.snapshot(generation);
  }

  /**
   * Watch a generation from `offset`. Everything already buffered past that
   * offset is replayed synchronously, then live chunks follow (SPEC §5.3).
   * Returns an unsubscribe function; unsubscribing never stops the generation.
   */
  subscribe(
    id: string,
    offset: number,
    listener: (event: GenerationEvent) => void,
  ): (() => void) | null {
    const generation = this.active.get(id);
    if (generation === undefined) return null;

    // A client that reconnected mid-stream still needs to know who is speaking.
    if (generation.director !== null) {
      listener({ type: "director", ...generation.director });
    }

    // Reasoning is replayed whole rather than from an offset. It is collapsed
    // by default and nobody reads it a token at a time, so a client that
    // reconnects wants all of it once, not the tail it happens to have missed.
    if (generation.reasoning !== "") {
      listener({ type: "reasoning", text: generation.reasoning });
    }

    const from = Math.max(0, Math.min(offset, generation.buffer.length));
    if (from < generation.buffer.length) {
      listener({ type: "chunk", offset: from, text: generation.buffer.slice(from) });
    }

    // A client that reconnects after the end still needs the terminal event.
    const terminal = this.terminalEvent(generation);
    if (terminal !== null) {
      listener(terminal);
      return () => {};
    }

    generation.listeners.add(listener);
    return () => generation.listeners.delete(listener);
  }

  /** Abort and persist whatever was produced (SPEC §5.6). */
  cancel(id: string): GenerationSnapshot | null {
    const generation = this.active.get(id);
    if (generation === undefined) return null;
    if (generation.status === "pending" || generation.status === "streaming") {
      generation.abort.abort();
    }
    return this.snapshot(generation);
  }

  get(id: string): GenerationSnapshot | null {
    const generation = this.active.get(id);
    if (generation !== undefined) return this.snapshot(generation);
    return this.loadFromDatabase(id);
  }

  /** Active or recently finished generations for a scene. */
  listForScene(sceneId: number): GenerationSnapshot[] {
    return [...this.active.values()]
      .filter((generation) => generation.sceneId === sceneId)
      .map((generation) => this.snapshot(generation));
  }

  /** Cancel everything in flight. Called when the process is shutting down. */
  shutdown(): void {
    this.stopped = true;
    for (const generation of this.active.values()) generation.abort.abort();
  }

  /**
   * Bound after both exist: the service reports landings, the runner starts
   * turns (SPEC §6). Until this is set, scenes simply never autopilot.
   */
  setAutopilot(runner: AutopilotRunner): void {
    this.autopilot = runner;
  }

  /**
   * §14's event triggers. Bound late, like autopilot, because the runner needs
   * the guide and tracker runners this service was already given.
   */
  setTriggers(runner: TriggerRunner): void {
    this.triggers = runner;
  }

  /** §15's outbound webhooks. Bound late, and nothing here waits on one. */
  setWebhooks(sender: WebhookSender): void {
    this.webhooks = sender;
  }

  /** §11 layer 3's extractor. Bound late, and only runs where a scene asked. */
  setMemory(runner: MemoryRunner): void {
    this.memory = runner;
  }

  private autopilot: AutopilotRunner | null = null;
  private triggers: TriggerRunner | null = null;
  private webhooks: WebhookSender | null = null;
  private memory: MemoryRunner | null = null;

  /**
   * Resolves when the generation is no longer running — the drain half of
   * autopilot's stop, and the reason a stop can hand the tree back safely.
   */
  awaitSettled(id: string): Promise<GenerationSnapshot | null> {
    const generation = this.active.get(id);
    if (generation === undefined) return Promise.resolve(this.get(id));
    if (generation.status !== "pending" && generation.status !== "streaming") {
      return Promise.resolve(this.snapshot(generation));
    }
    return new Promise((resolve) => {
      const unsubscribe = this.subscribe(id, generation.buffer.length, (event) => {
        if (event.type === "done" || event.type === "cancelled" || event.type === "error") {
          unsubscribe?.();
          resolve(this.snapshot(generation));
        }
      });
    });
  }

  /* ---------------- the work ---------------- */

  private async run(
    generation: ActiveGeneration,
    scene: SceneRow,
    route: ResolvedRoute,
  ): Promise<void> {
    let adapter: Adapter;
    let instruct: InstructTemplate | null = null;
    try {
      // Text completion only, and the same object is handed to the builder
      // below: the template that renders the prompt and the template whose stop
      // sequences end the turn have to be one template, or the model is stopped
      // on markers it was never given.
      instruct =
        route.kind === "text_completion" ? templateFor(this.db, route.instructTemplateId) : null;
      adapter = this.makeAdapter(route.kind, {
        baseUrl: route.baseUrl,
        apiKey: route.apiKey,
        model: route.model,
        ...(route.supportsPrefill === null ? {} : { supportsPrefill: route.supportsPrefill }),
        ...(instruct === null ? {} : { instruct }),
      });
    } catch (caught) {
      this.fail(generation, caught);
      return;
    }

    let dispatchedAt = this.now();
    try {
      // One preset for the whole generation: the samplers, the prompt and the
      // reasoning settings all come from the same row (SPEC §13).
      const presetId = presetIdFor(this.db, scene, route.presetId);
      const { samplers } = resolvePreset(this.db, presetId);
      generation.meta.samplers = samplers;

      // Who speaks, and whether one of them or several. For the classifier this
      // is a model call, which is why it happens here rather than in `start`.
      await this.direct(generation, scene);
      if (generation.abort.signal.aborted) {
        this.finish(generation, dispatchedAt);
        return;
      }

      // §14's `before_generation`. Awaited on purpose: a trigger bound here
      // exists to change what the prompt says, and one that ran alongside the
      // build would change the turn after this one instead.
      if (this.triggers?.anyFor("before_generation") === true) {
        await this.triggers.fire("before_generation", { scene });
      }

      const context = buildPromptContext({
        db: this.db,
        scene,
        capabilities: adapter.capabilities,
        ...(instruct === null ? {} : { instruct }),
        presetId,
        spotlightId: generation.spotlightId,
        turn: promptTurnOf(generation.turn),
        ...(generation.nudge === null ? {} : { nudge: generation.nudge }),
        now: this.now(),
        // The seed is derived from the generation's own identifier, so a reroll
        // is a genuinely different draw while one generation stays reproducible.
        seed: hashToSeed(generation.id),
        ...(generation.parentId === null
          ? { history: [] }
          : { history: pathTo(this.db, generation.parentId) }),
        // The data bank (SPEC §11): retrieved before the build, in the I/O
        // layer, so the builder stays pure. A retrieval that fails or finds
        // nothing is an empty block, never a failed turn.
        documents: await this.retrieveDocuments(scene, generation.parentId),
        // §11 layer 3, resolved here for the same reason: the ranking needs an
        // embeddings provider and the builder is pure. A scene with memory
        // switched off recalls nothing and costs nothing.
        ...(await this.recallMemory(scene, generation.parentId)),
      });

      const prompt = buildPrompt(context);
      // Which entries fired, for §14's `lore_activation`. Collected here
      // because this is the only moment it is known, and dispatched after the
      // turn - see `runTriggers`.
      generation.automationIds = this.automationIdsOf(context.loreTrace ?? []);

      // §15's `lore.activated`: which entries reached this prompt and why. The
      // trace is already computed for the inspector, so this costs nothing but
      // the forwarding.
      this.emitWebhook("lore.activated", generation.sceneId, {
        generationId: generation.id,
        entries: (context.loreTrace ?? [])
          .filter((entry) => entry.skipped === null)
          .map((entry) => ({
            id: entry.entryId,
            title: entry.title,
            matchedKey: entry.matchedKey,
            constant: entry.constant,
            sticky: entry.sticky,
            round: entry.round,
          })),
      });
      const reasoningConfig = parseReasoningConfig(this.reasoningJson(presetId));
      generation.meta.promptTokens = prompt.debug.totalTokens;
      generation.meta.tokensAreEstimated = prompt.debug.tokensAreEstimated;

      // Captured the moment the prompt is built, before a token streams, so
      // the inspector can answer for a cancelled or failed generation too
      // (§16, phase 25): "what did the model see" is about the ask.
      if (!this.stopped) {
        this.db
          .query("UPDATE generations SET prompt_debug = $debug WHERE id = $id")
          .run({ id: generation.rowId, debug: JSON.stringify(prompt.debug) });
      }

      this.setStatus(generation, "streaming");
      // §5's other device: a turn started here, so a phone showing this scene
      // gets an indicator without having asked for one.
      sceneChannel.publish(generation.sceneUlid, {
        type: "generation",
        state: "started",
        generationId: generation.id,
      });
      dispatchedAt = this.now();

      const parseInline = reasoningConfig.parseInline;
      const splitAsides = generation.turn.kind !== "ooc";
      for await (const chunk of adapter.generate(prompt, samplers, generation.abort.signal)) {
        if (generation.abort.signal.aborted) break;
        // Reasoning does not count as the first token: §13 hides it from the
        // prose, and a time-to-first-token that measured private planning would
        // report a speed the reader never sees.
        if (chunk.reasoning !== undefined && chunk.reasoning !== "") {
          this.appendReasoning(generation, chunk.reasoning);
        }
        if (chunk.text === "") continue;
        // Inline `<think>` tags are a streaming problem, not a parsing one:
        // the splitter holds back anything that could still turn out to be a
        // tag, so a stray `<think>` never reaches the reader for a frame.
        const split = parseInline
          ? generation.splitter.push(chunk.text)
          : { prose: chunk.text, reasoning: "" };
        if (split.reasoning !== "") this.appendReasoning(generation, split.reasoning);
        if (split.prose === "") continue;
        // Then the OOC markers, out of what is left. Second because reasoning
        // is a wrapper around the whole turn and an aside is a passage inside
        // it: splitting the other way round would look for `((` in text that
        // has not been established as prose yet. Not on an out-of-character
        // turn: the whole answer is already the aside, and a `((…))` inside one
        // is just something the author wrote.
        const staged = splitAsides
          ? generation.oocSplitter.push(split.prose)
          : { prose: split.prose };
        if (staged.prose === "") continue;
        if (generation.meta.ttftMs === null) generation.meta.ttftMs = this.now() - dispatchedAt;
        this.appendProse(generation, staged.prose);
      }
      // An unclosed block is reasoning, not prose. Printing a model's private
      // planning into the scene because it forgot a closing tag would be the
      // worst possible failure of this feature.
      if (parseInline) {
        const rest = generation.splitter.flush();
        if (rest.reasoning !== "") this.appendReasoning(generation, rest.reasoning);
        if (rest.prose !== "") {
          const staged = splitAsides
            ? generation.oocSplitter.push(rest.prose)
            : { prose: rest.prose };
          if (staged.prose !== "") this.appendProse(generation, staged.prose);
        }
      }
      // An unterminated aside is prose, marker and all — the opposite of the
      // rule above, and deliberately so (§7): `((` is a sequence fiction does
      // contain, and eating the rest of a turn on a stray double-paren is far
      // worse than showing one.
      if (splitAsides) {
        const trailing = generation.oocSplitter.flush();
        if (trailing.prose !== "") this.appendProse(generation, trailing.prose);
      }
      // An unclosed expression tag is prose too, for the same reason: showing
      // a stray `<expr` is less wrong than eating the turn after it.
      const exprRest = generation.exprSplitter.flush();
      if (exprRest.prose !== "") this.append(generation, exprRest.prose);
    } catch (caught) {
      // An abort surfaces here as a thrown error on some runtimes and as a
      // clean end on others; a cancelled generation is not a failed one.
      if (!generation.abort.signal.aborted) {
        this.fail(generation, caught);
        return;
      }
    }

    this.finish(generation, dispatchedAt);
  }

  /**
   * Read the finished turn, if the scene asked for that (SPEC §7.5), keep the
   * guides current (§8), and condense old history when it is due (§11).
   *
   * Deliberately not awaited by `finish` and deliberately swallowing
   * everything: a pass is a second reader's note, and a note that could break
   * the turn it is about would not be worth having.
   */
  /**
   * What this moment recalls from narrative memory (SPEC §11 layer 3).
   *
   * Never throws and never blocks: a recall that failed is an empty block, the
   * same trade the data bank makes. The trace rides along for the inspector.
   */
  private async recallMemory(
    scene: SceneRow,
    parentId: number | null,
  ): Promise<{ memory?: PromptMemoryEntity[]; memoryTrace?: MemoryRecallTrace[] }> {
    if (scene.memory_enabled !== 1) return {};
    try {
      const last = parentId === null ? null : findMessageById(this.db, parentId);
      const query = last?.content ?? scene.title;
      const recalled = await recall(this.db, this.keyring, scene, query);
      if (recalled.length === 0) return {};
      return {
        memory: recalled.map((item) => ({
          id: item.id,
          name: item.name,
          // The links travel with the entity: "Hollis took the bribe" is worth
          // less than "Hollis took the bribe from the man she is about to
          // serve", and the relation is where the second half lives.
          content:
            item.links.length === 0 ? item.content : `${item.content} (${item.links.join("; ")})`,
          salience: item.effectiveSalience,
        })),
        memoryTrace: recalled.map((item) => ({
          id: item.id,
          name: item.name,
          kind: item.kind,
          score: item.score,
          similarity: Math.round(item.similarity * 1000) / 1000,
          salience: item.salience,
          effectiveSalience: item.effectiveSalience,
          turnsSince: item.turnsSince,
          userEdited: item.userEdited,
        })),
      };
    } catch {
      return {};
    }
  }

  /**
   * The automation ids of the entries that actually fired (SPEC §10, §14).
   *
   * Skipped entries are excluded: the trace records everything considered, and
   * an action bound to an entry that lost to the budget or a cooldown should
   * not run as though the entry had reached the prompt.
   */
  private automationIdsOf(trace: readonly { entryId: string; skipped: unknown }[]): string[] {
    const fired = trace.filter((entry) => entry.skipped === null).map((entry) => entry.entryId);
    if (fired.length === 0) return [];
    const placeholders = fired.map((_, index) => `$k${index}`).join(", ");
    const values = Object.fromEntries(fired.map((id, index) => [`k${index}`, id]));
    const rows = this.db
      .query(
        `SELECT automation_id FROM lore_entries
          WHERE ulid IN (${placeholders}) AND automation_id IS NOT NULL`,
      )
      .all(values) as { automation_id: string }[];
    return rows.map((row) => row.automation_id);
  }

  /**
   * Fire an outbound webhook (SPEC §15).
   *
   * Never awaited and never able to throw. §15's argument for out-of-process
   * integration is that it is safer than a plugin, and that stops being true
   * the moment a receiver that stopped answering can stall a generation.
   */
  private emitWebhook(
    event: WebhookEvent,
    sceneId: number,
    data: Record<string, unknown>,
  ): void {
    const sender = this.webhooks;
    if (sender === null || !sender.anyFor(event)) return;
    try {
      const scene = findSceneById(this.db, sceneId);
      if (scene === null) return;
      sender.emit(event, { sceneId: scene.ulid, sceneTitle: scene.title }, data);
    } catch {
      /* Never reaches the turn. */
    }
  }

  /**
   * §14's after-the-turn events, run inside the same swallow-everything block
   * as the passes and for the same reason.
   *
   * `lore_activation` fires here rather than at the moment of activation, and
   * the reason is what an action costs: a guide refresh is a side call, and
   * stalling a turn on one before a token has streamed to pay for an entry
   * having matched is the wrong trade. So an entry's action runs after the turn
   * its activation was part of, and lands on the next one.
   */
  private async runTriggers(sceneId: number, automationIds: readonly string[]): Promise<void> {
    const runner = this.triggers;
    if (runner === null) return;
    const wantsAfter = runner.anyFor("after_generation");
    const wantsLore = automationIds.length > 0 && runner.anyFor("lore_activation");
    if (!wantsAfter && !wantsLore) return;

    const scene = findSceneById(this.db, sceneId);
    if (scene === null) return;
    if (wantsAfter) await runner.fire("after_generation", { scene });
    if (wantsLore) {
      const current = findSceneById(this.db, sceneId);
      if (current !== null) await runner.fire("lore_activation", { scene: current, automationIds });
    }
  }

  private async runPasses(sceneId: number, messageId: number): Promise<void> {
    if (this.stopped) return;
    try {
      const scene = findSceneById(this.db, sceneId);
      const message = findMessageById(this.db, messageId);
      if (scene === null || message === null) return;
      if (this.passes.willRunAutomatically(scene)) {
        await this.passes.run({ scene, message, automatic: true });
      }
      // Guides are refreshed after the passes, not before: a pass may have
      // rewritten the turn a guide is about to read (SPEC §7.5, §8).
      if (this.guides.willRunAutomatically()) {
        const current = findSceneById(this.db, sceneId);
        if (current !== null) await this.guides.refresh(current, { automatic: true });
      }
      // Trackers read the same turn, after the guides: a tracker's fields are
      // the strict, structured sibling of a guide's prose (§8).
      if (this.trackers.willRunAutomatically()) {
        const current = findSceneById(this.db, sceneId);
        if (current !== null) await this.trackers.refresh(current, { automatic: true });
      }
      // §11 layer 3, after the passes for the same reason the guides are: it
      // reads the turn, so it wants the version the passes settled on. Last of
      // the readers because it is the most expensive and the least urgent —
      // nothing on the next turn breaks if this one has not finished.
      const forMemory = findSceneById(this.db, sceneId);
      if (forMemory !== null && this.memory?.willRunFor(forMemory) === true) {
        await this.memory.extract(forMemory);
      }
      // Summarisation last, and for the same reason: it reads the turn, so it
      // wants the version the passes settled on. It also runs least often.
      const afterGuides = findSceneById(this.db, sceneId);
      if (afterGuides !== null && this.summaries.willRunAutomatically(afterGuides)) {
        await this.summaries.run(afterGuides, { automatic: true });
      }
    } catch {
      /* Never reaches the turn. */
    }
  }

  /* ---------------- the turn director ---------------- */

  /**
   * Settle who speaks and whether one of them or several, then announce it.
   *
   * The announcement is the point as much as the decision is: SPEC §6 requires
   * the choice to be visible so it never reads as a dice roll, and with the
   * classifier the choice is not known until a model has answered. Every path
   * out of here sets `spotlightId`, resolves `turn` away from `auto`, and emits
   * exactly one director event — including every failure path, because a turn
   * whose speaker was chosen by a silent fallback is the thing this replaces.
   */
  private async direct(generation: ActiveGeneration, scene: SceneRow): Promise<void> {
    // Nobody in the cast is speaking on an out-of-character turn: the author is
    // answering as itself (§7). Asking a director who should speak would spend
    // a model call to pick a character who is not going to say anything.
    if (generation.turn.kind === "ooc") {
      this.announce(generation, {
        characterId: null,
        name: this.authorNameOf(scene),
        source: "user",
        reason: "Answering you out of character",
        scope: "spotlight",
      });
      return;
    }

    if (generation.turn.kind === "recast") {
      const name = generation.turn.characterName;
      this.announce(generation, {
        characterId: null,
        name,
        source: "user",
        reason: `Rewriting ${name}'s part of this beat`,
        scope: "spotlight",
      });
      return;
    }

    // A revised turn is voiced by whoever voiced the original. There is nothing
    // for a director to decide, and asking one would let it change the speaker
    // halfway through a correction.
    if (generation.turn.kind === "revise") {
      const turn = generation.turn;
      this.announce(generation, {
        characterId: null,
        name: turn.characterName,
        source: "user",
        reason:
          turn.mode === "expand"
            ? `Writing ${turn.characterName}'s turn again, longer`
            : turn.mode === "continue"
              ? `Carrying on from where ${turn.characterName} stopped`
              : `Rewriting ${turn.characterName}'s turn`,
        scope: turn.targetKind === "beat" ? "beat" : "spotlight",
      });
      return;
    }

    const requestedUlid =
      generation.requestedSpotlightId === null
        ? null
        : (castRowsOf(this.db, scene.id).find(
            (row) => row.id === generation.requestedSpotlightId,
          )?.ulid ?? null);

    const fallback = resolveNextSpeaker(this.db, scene, requestedUlid);
    const wantsScope = generation.turn.kind === "auto";

    // Nobody to choose: an empty or entirely benched cast. The author narrates,
    // and a beat has nobody to be a beat between.
    if (fallback === null) {
      this.settleTurn(generation, null, "spotlight");
      this.announce(generation, {
        characterId: null,
        name: scene.author_id === null ? "the narrator" : "the author",
        source: "director",
        reason: "Nobody is in the cast, so this is narration",
        scope: "spotlight",
      });
      return;
    }

    const asked =
      scene.turn_strategy === "classifier"
        ? await this.classify(generation, scene, fallback.source === "user", wantsScope)
        : { decided: null, why: null };
    const decided = asked.decided;

    const characterUlid = decided?.characterId ?? fallback.characterId;
    const name = decided?.name ?? fallback.name;
    // When the classifier was asked and could not answer, the reason says so
    // rather than repeating the provisional sentence the scene carried before
    // the turn: a director that is quietly broken should not look exactly like
    // one that is quietly working. The fallback under `classifier` is round
    // robin (see `chooseSpeaker`), which is what the sentence names.
    const reason =
      decided?.reason ??
      (asked.why === null ? fallback.reason : `Round robin — ${asked.why}`);
    const scope: ResolvedTurnScope =
      generation.turn.kind === "beat"
        ? "beat"
        : wantsScope
          ? (decided?.scope ?? "spotlight")
          : "spotlight";

    this.settleTurn(generation, internalIdOf(this.db, scene, characterUlid), scope);
    this.announce(generation, {
      characterId: characterUlid,
      name,
      // A cue the classifier was never allowed to overrule stays the user's.
      source: fallback.source === "user" ? "user" : "director",
      reason,
      scope,
    });
  }

  /** Fix the speaker and resolve `auto` into what the turn actually is. */
  private settleTurn(
    generation: ActiveGeneration,
    spotlightId: number | null,
    scope: ResolvedTurnScope,
  ): void {
    generation.spotlightId = spotlightId;
    if (generation.turn.kind !== "auto") return;
    generation.turn =
      scope === "beat" ? { kind: "beat", bound: generation.turn.bound } : { kind: "spotlight" };
  }

  private announce(generation: ActiveGeneration, event: DirectorEvent): void {
    generation.director = event;
    this.emit(generation, { type: "director", ...event });
  }

  /**
   * Ask a model who should speak (SPEC §6).
   *
   * Null means "no usable answer", and every way of getting there — no cast to
   * choose between, no profile, a provider that failed, a reply that named
   * nobody — returns it rather than throwing. A classifier that can cost the
   * user their turn is worse than no classifier, so this never fails a
   * generation; the pure director's answer stands and the reason says why.
   */
  private async classify(
    generation: ActiveGeneration,
    scene: SceneRow,
    speakerIsPinned: boolean,
    wantsScope: boolean,
  ): Promise<ClassifierOutcome> {
    const kind = taskKind(TURN_CLASSIFIER)!;
    const base = {
      kind,
      sceneId: scene.id,
      profileId: scene.director_profile_id,
      fallbackProfileId: scene.connection_profile_id,
      signal: generation.abort.signal,
    };

    const path = activePathOf(this.db, scene.id);
    const lastSpoke = lastCharacterOf(path);
    const cast = castRowsOf(this.db, scene.id).filter((row) => row.is_active === 1);

    // Never twice consecutively (SPEC §6) is enforced by not offering them,
    // rather than by asking the model nicely and hoping.
    const offered = cast.length > 1 ? cast.filter((row) => row.id !== lastSpoke) : cast;
    // With the speaker already pinned and no scope to decide, there is nothing
    // left to ask; with one candidate and no scope question, likewise.
    const nothingToAsk =
      offered.length === 0 ||
      (!wantsScope && (speakerIsPinned || offered.length < 2));
    if (nothingToAsk) {
      this.tasks.noteSkipped(base, "There was only one turn this could be.");
      return { decided: null, why: null };
    }

    const candidates: ClassifierCandidate[] = offered.map((row) => ({
      id: row.ulid,
      name: row.name,
      description: row.description,
      turnsSilent: turnsSinceSpeaking(path, row.id),
    }));

    const request = {
      ...base,
      prompt: buildClassifierPrompt(
        {
          candidates,
          history: recentTurns(this.db, path),
          reader: personaNameOf(this.db, scene),
          askScope: wantsScope,
        },
        createEstimatingTokenizer(),
      ),
    };

    const outcome = await this.tasks.run(request);
    if (!outcome.ok) {
      // Never fails the turn (SPEC §7) — but the fallback should say *why* it
      // is the fallback, or a director that is quietly broken looks the same
      // as one that is quietly working.
      return { decided: null, why: reasonForFailure(outcome.status) };
    }

    const parsed = parseClassifierReply(outcome.text, candidates);
    if (parsed === null) {
      this.tasks.noteUnusable(request, outcome.text, "The reply named nobody in the cast.");
      return { decided: null, why: "the classifier named nobody in the cast" };
    }

    const scope: ResolvedTurnScope = wantsScope ? (parsed.scope ?? "spotlight") : "spotlight";
    return {
      decided: {
        characterId: speakerIsPinned ? candidates[0]!.id : parsed.characterId,
        name: speakerIsPinned ? candidates[0]!.name : parsed.name,
        reason: parsed.reason ?? "Chosen by the classifier",
        scope,
      },
      why: null,
    };
  }

  private append(generation: ActiveGeneration, text: string): void {
    if (text === "") return;
    const offset = generation.buffer.length;
    generation.buffer += text;
    this.emit(generation, { type: "chunk", offset, text });

    const at = this.now();
    if (at - generation.lastPersistAt >= PERSIST_INTERVAL_MS) {
      this.persistBuffer(generation);
      generation.lastPersistAt = at;
    }
  }

  /**
   * Prose bound for the scene, after the expression tags are lifted out of it
   * (§12). The tags never reach the buffer or the prompt; they ride alongside
   * the turn and land on the message at `land` time.
   */
  private appendProse(generation: ActiveGeneration, text: string): void {
    if (text === "") return;
    const split = generation.exprSplitter.push(text);
    if (split.prose !== "") this.append(generation, split.prose);
  }

  /**
   * Recall data-bank chunks for this turn (SPEC §11). The query is the scene's
   * own recent words; the answer feeds the prompt's documents block. A failure
   * — a provider down, a bad vector — is an empty recall, never a failed turn.
   */
  private async retrieveDocuments(
    scene: SceneRow,
    parentId: number | null,
  ): Promise<PromptDocumentChunk[]> {
    try {
      const path = parentId === null ? [] : pathTo(this.db, parentId);
      const query = path
        .slice(-2)
        .map((message) => message.content)
        .join("\n")
        .trim();
      if (query === "") return [];
      const chunks = await retrieve(this.db, this.keyring, scene.id, query);
      return chunks.map((chunk) => ({
        id: chunk.documentId,
        documentName: chunk.documentTitle,
        content: chunk.text,
        score: chunk.score,
      }));
    } catch {
      return [];
    }
  }

  /** The preset's reasoning settings, or null for the built-in defaults (§13). */
  private reasoningJson(presetId: number | null): string | null {    if (presetId === null) return null;
    const row = this.db
      .query("SELECT reasoning_config FROM presets WHERE id = $id")
      .get({ id: presetId }) as { reasoning_config: string | null } | null;
    return row?.reasoning_config ?? null;
  }

  /**
   * Reasoning, kept out of the prose buffer entirely (SPEC §13).
   *
   * Separate storage is what makes "do not feed it back into context" free
   * rather than a rule somebody has to remember: the history renderer reads a
   * message's content, so reasoning cannot leak into a later prompt by accident.
   */
  private appendReasoning(generation: ActiveGeneration, text: string): void {
    generation.reasoning += text;
    this.emit(generation, { type: "reasoning", text });
  }

  /**
   * Write the message node and emit the terminal event (SPEC §5.5). A cancelled
   * generation keeps whatever it produced — partial output is still the user's
   * text, and discarding it loses work they watched arrive.
   */
  private finish(generation: ActiveGeneration, dispatchedAt: number): void {
    const cancelled = generation.abort.signal.aborted;
    const finishedAt = this.now();
    generation.finishedAt = finishedAt;

    // Announced on every path out of here, including the failing ones. An
    // indicator that only cleared on success would leave the other device
    // showing "still writing" for a turn that stopped.
    sceneChannel.publish(generation.sceneUlid, {
      type: "generation",
      state: "finished",
      generationId: generation.id,
    });

    // Shutting down is not a completed turn: there is no database left to write
    // the message into, and the generation was aborted rather than finished.
    if (this.stopped) {
      generation.status = "cancelled";
      this.emit(generation, {
        type: "cancelled",
        messageId: null,
        meta: generation.meta,
      });
      return;
    }

    const elapsedSeconds = Math.max(1, finishedAt - dispatchedAt) / 1000;
    const tokenizer = createEstimatingTokenizer();
    const completionTokens = tokenizer.count(generation.buffer);
    generation.meta.completionTokens = completionTokens;
    generation.meta.tokensPerSecond =
      completionTokens === 0 ? null : Number((completionTokens / elapsedSeconds).toFixed(2));

    if (generation.buffer.trim() !== "") {
      const message = this.land(generation);
      if (message !== null) {
        this.db
          .query("UPDATE messages SET generation_meta = $meta WHERE id = $id")
          .run({ id: message.id, meta: JSON.stringify(generation.meta) });
        // §13: reasoning lives on the message, apart from its content, so it
        // can be shown collapsed and never reaches a later prompt unasked.
        if (generation.reasoning.trim() !== "") {
          this.db
            .query("UPDATE messages SET reasoning = $reasoning WHERE id = $id")
            .run({ id: message.id, reasoning: generation.reasoning.trim() });
        }
        generation.messageUlid = message.ulid;
        generation.landedMessageId = message.id;
        this.db
          .query("UPDATE generations SET target_message_id = $target WHERE id = $id")
          .run({ id: generation.rowId, target: message.id });
        this.landAside(generation, message.id);
      }
    }

    generation.status = cancelled ? "cancelled" : "complete";
    this.persist(generation);
    // A cancelled generation that produced nothing has no message, so its event
    // carries null rather than a fabricated identifier.
    this.emit(
      generation,
      cancelled
        ? { type: "cancelled", messageId: generation.messageUlid, meta: generation.meta }
        : { type: "done", messageId: generation.messageUlid ?? "", meta: generation.meta },
    );

    // The pipeline starts *after* the turn is finished and announced. SPEC §7
    // is absolute that a background task must never block a user-facing
    // generation, and three extra model calls in front of every reply would be
    // a worse product than no pipeline at all (§7.5).
    // Not after an out-of-character answer. Every one of the three reads the
    // turn as prose — the passes annotate it, the guides describe what the
    // characters are doing, the summariser condenses the story — and an aside
    // to the reader is none of those things (§7).
    if (!cancelled && generation.landedMessageId !== null && generation.turn.kind !== "ooc") {
      void this.runPasses(generation.sceneId, generation.landedMessageId);
      // §14's after-the-turn events, alongside the pipeline and under the same
      // rule: never in front of a reply, and never able to break one.
      void this.runTriggers(generation.sceneId, generation.automationIds).catch(() => {});
    }

    // §15's `generation.complete`. Fired for a cancelled and a failed turn too:
    // a bridge that only heard about the ones that worked would sit waiting on
    // the ones that did not, which is the state it most needs told about.
    if (generation.messageUlid !== null || generation.error !== null || cancelled) {
      const landed =
        generation.landedMessageId === null
          ? null
          : findMessageById(this.db, generation.landedMessageId);
      this.emitWebhook("generation.complete", generation.sceneId, {
        generationId: generation.id,
        status: generation.status,
        messageId: landed?.ulid ?? null,
        content: landed?.content ?? null,
        speaker: generation.spotlightId === null ? null : this.speakerName(generation.spotlightId),
        error: generation.error,
        meta: generation.meta,
      });

      // And the message itself, for a receiver that wants every turn rather
      // than the shape of the generation that produced it.
      if (landed !== null) {
        this.emitWebhook("message.created", generation.sceneId, {
          messageId: landed.ulid,
          kind: landed.kind,
          authorType: landed.author_type,
          content: landed.content,
          speaker: landed.character_id === null ? null : this.speakerName(landed.character_id),
          createdAt: landed.created_at,
        });
      }
    }

    // Autopilot's moment (SPEC §6): a reply has completed. Spotlight and beat
    // turns only — a revise is an edit and a recast is a splice, and neither is
    // the "reply completes" the loop continues from. The runner decides
    // whether anything follows; most scenes, most of the time, will not.
    if (
      !cancelled &&
      generation.landedMessageId !== null &&
      (generation.turn.kind === "spotlight" || generation.turn.kind === "beat")
    ) {
      this.autopilot?.onTurnFinished(
        generation.sceneId,
        generation.id,
        generation.landedMessageId,
        true,
        "complete",
      );
    } else if (cancelled) {
      this.autopilot?.onTurnFinished(generation.sceneId, generation.id, null, false, "cancelled");
    }

    this.scheduleEviction(generation);
  }

  /**
   * Put the finished text where it belongs.
   *
   * A spotlight and a beat append a new message; a beat also gets parsed into
   * segments, because the parsed view is derived from the content and must
   * never lag behind it. A recast splices into a beat that already exists —
   * correcting one character's part is an edit to that beat, not a new version
   * of it, which is what distinguishes recast from a swipe (SPEC §3.5, §7).
   */
  /**
   * §14's `ai_output` stage: the model's prose is rewritten before it is
   * stored, so the log, the prompt and any later edit all see one text.
   *
   * Applied to the prose only. The out-of-character aside that came out of the
   * same stream is a different channel - §7 is explicit that it never touches
   * the prose - and a script written to trim a model's trailing half-sentence
   * has no business rewriting a question the author asked the reader.
   *
   * A `continue` is scripted as the joined whole rather than as the new half:
   * the message that lands is one turn, and a script that trims its ending
   * cannot find the ending if it is only shown the middle.
   */
  private scripted(generation: ActiveGeneration, text: string): string {
    return scriptText(this.db, "ai_output", text, {
      sceneId: generation.sceneId,
      characterId: generation.spotlightId,
    });
  }

  private land(generation: ActiveGeneration): MessageRow | null {
    if (generation.turn.kind === "recast") {
      const beat = findMessageById(this.db, generation.turn.messageId);
      // The beat was deleted while this was generating. The text is kept on the
      // generation row either way; there is nothing left to splice it into.
      if (beat === null) return null;
      return replaceSegment(
        this.db,
        beat,
        generation.turn.ordinal,
        this.scripted(generation, generation.buffer),
      );
    }

    // An out-of-character answer is the author speaking as itself, so it is
    // filed as one: `ooc` on both counts, attributed to nobody in the cast, and
    // never parsed for segments. It is not a turn in the scene (§7).
    if (generation.turn.kind === "ooc") {
      return appendMessage(this.db, {
        sceneId: generation.sceneId,
        parentId: generation.parentId,
        kind: "ooc",
        authorType: "ooc",
        content: generation.buffer.trim(),
        characterId: null,
      });
    }

    const revise = generation.turn.kind === "revise" ? generation.turn : null;
    const isBeat = revise === null ? generation.turn.kind === "beat" : revise.targetKind === "beat";
    const message = appendMessage(this.db, {
      sceneId: generation.sceneId,
      parentId: generation.parentId,
      kind: isBeat ? "beat" : "spotlight",
      authorType: "character",
      // Continue extends rather than replaces: the message that lands is the
      // whole turn, original and continuation, so the log reads as one piece of
      // writing rather than a fragment beside its own beginning.
      // Trimmed, which matters once an aside can be lifted off the end of a
      // turn (§7): the prose before it keeps the space that separated them,
      // and a turn should not end in whitespace the reader cannot see.
      content: this.scripted(
        generation,
        revise?.mode === "continue"
          ? `${revise.original.trimEnd()} ${generation.buffer.trimStart()}`
          : generation.buffer.trim(),
      ),
      // A beat is filed under whoever opened it, so the log has something to
      // attribute it to; who spoke *last* in it comes from its segments (§6).
      characterId: generation.spotlightId,
    });
    if (isBeat) {
      reparseSegments(this.db, message);
      // §15's `beat.parsed`: the one event that says *who said what*, which is
      // the whole reason a bridge would want a beat rather than a message.
      this.emitWebhook("beat.parsed", generation.sceneId, {
        messageId: message.ulid,
        segments: segmentDtosOf(this.db, message, speakerLookup(this.db)),
      });
    }

    // The author's declared expressions (§12), lifted out of the stream and
    // stored against the message. A spotlight carries one label; a beat's tags
    // name their character and land on that character's segment.
    const expressions = generation.exprSplitter.result();
    if (expressions.length > 0) {
      if (isBeat) {
        applySegmentExpressions(this.db, message.id, expressions);
      } else {
        const label = expressions.at(-1)?.label ?? null;
        if (label !== null) {
          this.db.query("UPDATE messages SET expression = $e WHERE id = $id").run({
            id: message.id,
            e: label,
          });
        }
      }
    }
    return message;
  }

  /**
   * File an out-of-character aside as its own message (SPEC §7).
   *
   * A **child** of the turn it came out of, rather than a sibling. §1 says
   * history is a tree, and the aside belongs to that particular telling of the
   * turn: rerolling the prose makes a new sibling, which takes the reader down
   * a path the aside is not on, and it disappears exactly when it should.
   * Deleting the turn takes it too, by the same cascade.
   *
   * `author_type` is `ooc` rather than `character`, because the author is
   * speaking as itself here — that is the whole distinction §2 draws between a
   * partner and the roles it plays, and it is what the blue pencil in the
   * design marks.
   */
  private landAside(generation: ActiveGeneration, parentId: number): void {
    const aside = generation.oocSplitter.result().trim();
    if (aside === "") return;
    appendMessage(this.db, {
      sceneId: generation.sceneId,
      parentId,
      kind: "ooc",
      authorType: "ooc",
      content: aside,
      characterId: null,
    });
  }

  /** A cast member's name, for a payload a receiver has to read without a join. */
  private speakerName(characterId: number): string | null {
    const row = this.db
      .query("SELECT name FROM characters WHERE id = $id")
      .get({ id: characterId }) as { name: string } | null;
    return row?.name ?? null;
  }

  /** The author's name, for announcing a turn nobody in the cast is speaking. */
  private authorNameOf(scene: SceneRow): string {
    if (scene.author_id === null) return "Out of character";
    const row = this.db
      .query("SELECT name FROM authors WHERE id = $id")
      .get({ id: scene.author_id }) as { name: string } | null;
    return row?.name ?? "Out of character";
  }

  private fail(generation: ActiveGeneration, caught: unknown): void {
    const { message, detail } = describeFailure(caught);
    generation.status = "error";
    generation.error = message;
    generation.detail = detail;
    generation.finishedAt = this.now();
    // The other device is told before the early return below: a shutdown is
    // exactly when a listener still connected most needs to stop showing
    // "still writing" (§5). `finish` is not on this path - a failure returns
    // through here instead - so this is the only place that can say so.
    sceneChannel.publish(generation.sceneUlid, {
      type: "generation",
      state: "finished",
      generationId: generation.id,
    });
    // Nothing left to write to, and nobody left to tell.
    if (this.stopped) return;
    this.persist(generation);
    this.emit(generation, { type: "error", message, detail });
    // A failed turn ends the loop, as §6's last stop says it must — retrying
    // into a dead provider is a loop that costs money to learn nothing.
    this.autopilot?.onTurnFinished(generation.sceneId, generation.id, null, false, "error");
    this.scheduleEviction(generation);
  }

  /* ---------------- plumbing ---------------- */

  private emit(generation: ActiveGeneration, event: GenerationEvent): void {
    for (const listener of generation.listeners) {
      try {
        listener(event);
      } catch {
        // A broken subscriber — a client that vanished mid-write — must never
        // take the generation down with it.
      }
    }
  }

  private terminalEvent(generation: ActiveGeneration): GenerationEvent | null {
    switch (generation.status) {
      case "complete":
        return { type: "done", messageId: generation.messageUlid ?? "", meta: generation.meta };
      case "cancelled":
        return { type: "cancelled", messageId: generation.messageUlid, meta: generation.meta };
      case "error":
        return {
          type: "error",
          message: generation.error ?? "The generation failed.",
          detail: generation.detail,
        };
      default:
        return null;
    }
  }

  private setStatus(generation: ActiveGeneration, status: GenerationStatus): void {
    generation.status = status;
    if (this.stopped) return;
    this.db
      .query("UPDATE generations SET status = $status WHERE id = $id")
      .run({ id: generation.rowId, status });
  }

  private persistBuffer(generation: ActiveGeneration): void {
    if (this.stopped) return;
    if (generation.buffer.length === generation.persistedOffset) return;
    this.db
      .query("UPDATE generations SET buffer = $buffer, offset = $offset WHERE id = $id")
      .run({
        id: generation.rowId,
        buffer: generation.buffer,
        offset: generation.buffer.length,
      });
    generation.persistedOffset = generation.buffer.length;
  }

  private persist(generation: ActiveGeneration): void {
    if (this.stopped) return;
    this.db
      .query(
        `UPDATE generations
            SET status = $status, buffer = $buffer, offset = $offset,
                meta = $meta, error = $error, finished_at = $finished_at
          WHERE id = $id`,
      )
      .run({
        id: generation.rowId,
        status: generation.status,
        buffer: generation.buffer,
        offset: generation.buffer.length,
        meta: JSON.stringify(generation.meta),
        error: generation.error,
        finished_at: generation.finishedAt,
      });
    generation.persistedOffset = generation.buffer.length;
  }

  /**
   * Finished generations linger briefly so a client reconnecting after a
   * network handoff still receives the terminal event, then are dropped from
   * memory (SPEC §5). The row stays in the database either way.
   */
  private scheduleEviction(generation: ActiveGeneration): void {
    const timer = setTimeout(() => this.active.delete(generation.id), FINISHED_TTL_MS);
    // Never hold the process open for a cache entry.
    if (typeof timer === "object" && timer !== null && "unref" in timer) {
      (timer as { unref: () => void }).unref();
    }
  }

  private snapshot(generation: ActiveGeneration): GenerationSnapshot {
    return {
      id: generation.id,
      sceneId: generation.sceneUlid,
      status: generation.status,
      buffer: generation.buffer,
      offset: generation.buffer.length,
      reasoning: generation.reasoning,
      messageId: generation.messageUlid,
      meta: generation.meta,
      director: generation.director,
      error: generation.error,
      startedAt: generation.startedAt,
      finishedAt: generation.finishedAt,
    };
  }

  /** A generation this process no longer holds in memory, read back from disk. */
  private loadFromDatabase(id: string): GenerationSnapshot | null {
    const row = this.db
      .query(
        `SELECT g.*, s.ulid AS scene_ulid, m.ulid AS message_ulid
           FROM generations g
           JOIN scenes s ON s.id = g.scene_id
           LEFT JOIN messages m ON m.id = g.target_message_id
          WHERE g.ulid = $ulid`,
      )
      .get({ ulid: id }) as
      | {
          status: GenerationStatus;
          buffer: string;
          offset: number;
          meta: string | null;
          error: string | null;
          started_at: number;
          finished_at: number | null;
          scene_ulid: string;
          message_ulid: string | null;
        }
      | null;
    if (row === null) return null;

    let meta: GenerationMeta | null = null;
    if (row.meta !== null) {
      try {
        meta = JSON.parse(row.meta) as GenerationMeta;
      } catch {
        meta = null;
      }
    }

    return {
      id,
      sceneId: row.scene_ulid,
      status: row.status,
      buffer: row.buffer,
      offset: row.buffer.length,
      // Not persisted on the generation row: reasoning belongs to the message
      // it produced, and a generation read back from disk has already landed.
      reasoning: "",
      messageId: row.message_ulid,
      meta,
      // A generation read back from disk is finished; the decision belonged to
      // the turn it was taken for and is not worth a column of its own.
      director: null,
      error: row.error,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    };
  }

  /**
   * Work out which provider, model and preset this call runs against. An
   * explicit profile wins over the scene's, which is the mechanism per-operation
   * model routing is built on (SPEC §0.11, §7).
   */
  /**
   * Where this scene generates. A per-call override beats the scene's own
   * profile, which is the mechanism behind per-operation routing (SPEC §7).
   */
  private resolveRoute(scene: SceneRow, overrideProfileId: number | null): ResolvedRoute {
    try {
      return resolveRoute(this.db, this.keyring, {
        profileId: overrideProfileId ?? scene.connection_profile_id,
      });
    } catch (caught) {
      // The generation path speaks in GenerationErrors, which routes map onto
      // status codes; a routing failure is one of those, not a crash.
      if (caught instanceof RouteError) throw new GenerationError(caught.code, caught.message);
      throw caught;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * The path from a root down to `messageId` — the history this generation
 * continues from. Distinct from the scene's active path, because a generation
 * attaches to the parent it captured at start, not to wherever the leaf has
 * moved since.
 *
 * Sibling counts are irrelevant to prompt assembly, so they are not computed.
 */
function pathTo(db: Database, messageId: number): MessageRowWithSiblings[] {
  return db
    .query(
      `WITH RECURSIVE ancestry(id, depth) AS (
           SELECT id, 0 FROM messages WHERE id = $leaf
           UNION ALL
           SELECT m.parent_id, ancestry.depth + 1
             FROM messages m JOIN ancestry ON m.id = ancestry.id
            WHERE m.parent_id IS NOT NULL
         )
         SELECT m.*, 0 AS sibling_index, 1 AS sibling_count
           FROM ancestry JOIN messages m ON m.id = ancestry.id
          ORDER BY ancestry.depth DESC`,
    )
    .all({ leaf: messageId }) as MessageRowWithSiblings[];
}

/**
 * What this generation was asked for, resolved once at the start.
 *
 * A recast reads the beat as it stands *now*, because that is the text the
 * model is being asked to fit around; if the beat changes while this generates,
 * the splice still lands at the segment's own offsets.
 */
function resolveTurn(db: Database, options: StartOptions): ResolvedTurn {
  const recast = options.recast;
  if (recast !== undefined) {
    const segment = segmentRowsOf(db, recast.message.id).find(
      (row) => row.ordinal === recast.ordinal,
    );
    if (segment === undefined || segment.speaker_type !== "character") {
      throw new GenerationError(
        "not_recastable",
        "That part of the beat is narration, not a character, so there is nobody to recast.",
      );
    }
    // A speaker the beat named but the cast does not contain has no card to
    // write from. Recasting them would silently rewrite them as somebody else.
    if (segment.character_id === null) {
      throw new GenerationError(
        "not_recastable",
        `${segment.speaker_label ?? "That speaker"} is not in this roleplay's cast, so there is ` +
          `no character to write them from.`,
      );
    }
    return {
      kind: "recast",
      messageId: recast.message.id,
      ordinal: recast.ordinal,
      beatText: recast.message.content,
      characterName: segment.speaker_label ?? "",
    };
  }

  const revise = options.revise;
  if (revise !== undefined) {
    const target = revise.message;
    if (target.author_type === "user") {
      throw new GenerationError(
        "not_revisable",
        "That is your own message. Edit it directly rather than asking for another version.",
      );
    }
    if (target.content.trim() === "") {
      throw new GenerationError("not_revisable", "There is nothing there to work from.");
    }
    const speaker =
      target.character_id === null
        ? null
        : (db.query("SELECT name FROM characters WHERE id = $id").get({ id: target.character_id }) as
            | { name: string }
            | null);
    return {
      kind: "revise",
      mode: revise.mode,
      original: target.content,
      ...(revise.instructions === undefined ? {} : { instructions: revise.instructions }),
      characterId: target.character_id,
      characterName: speaker?.name ?? "the narrator",
      parentId: target.parent_id,
      targetKind: target.kind,
    };
  }

  if (options.ooc !== undefined) return { kind: "ooc", question: options.ooc.question };

  if (options.scope === "beat") return { kind: "beat", bound: options.beatBound ?? DEFAULT_BEAT_BOUND };
  if (options.scope === "auto") return { kind: "auto", bound: options.beatBound ?? DEFAULT_BEAT_BOUND };
  return { kind: "spotlight" };
}

/**
 * The turn as the prompt builder reads it.
 *
 * `auto` never reaches the builder — the director resolves it into a spotlight
 * or a beat first — so it maps to a spotlight here only as a guard against a
 * path that should not exist.
 */
function promptTurnOf(turn: ResolvedTurn) {
  switch (turn.kind) {
    case "recast":
      return { kind: "recast" as const, beatText: turn.beatText };
    case "revise":
      return {
        kind: "revise" as const,
        mode: turn.mode,
        original: turn.original,
        ...(turn.instructions === undefined ? {} : { instructions: turn.instructions }),
      };
    case "auto":
      return { kind: "spotlight" as const };
    default:
      return turn;
  }
}

/** The character a recast is rewriting, which is the segment's own speaker. */
function recastSpeakerId(
  db: Database,
  turn: Extract<ResolvedTurn, { kind: "recast" }>,
): number | null {
  const segment = segmentRowsOf(db, turn.messageId).find((row) => row.ordinal === turn.ordinal);
  return segment?.character_id ?? null;
}

/* ---------------- reading the scene for the classifier ---------------- */

/** How many turns of the scene the classifier is shown. It needs the gist. */
const CLASSIFIER_HISTORY_TURNS = 8;

function activePathOf(db: Database, sceneId: number): MessageRowWithSiblings[] {
  return activePath(db, sceneId);
}

/** The last cast member to speak, counting who a beat ended on (SPEC §3.5). */
function lastCharacterOf(path: MessageRowWithSiblings[]): number | null {
  for (let index = path.length - 1; index >= 0; index--) {
    const row = path[index]!;
    if (row.character_id !== null) return row.character_id;
  }
  return null;
}

function turnsSinceSpeaking(path: MessageRowWithSiblings[], characterId: number): number | null {
  for (let index = path.length - 1; index >= 0; index--) {
    if (path[index]!.character_id === characterId) return path.length - 1 - index;
  }
  return null;
}

/** The tail of the scene, with each turn labelled by who said it. */
function recentTurns(
  db: Database,
  path: MessageRowWithSiblings[],
): { speaker: string; content: string }[] {
  const speakers = speakerLookup(db);
  return path
    .filter((row) => row.is_hidden === 0)
    .slice(-CLASSIFIER_HISTORY_TURNS)
    .map((row) => ({
      speaker:
        row.character_id === null
          ? row.author_type === "user"
            ? "The reader"
            : "Narration"
          : (speakers.nameById.get(row.character_id) ?? "Someone"),
      content: row.content,
    }));
}

function personaNameOf(db: Database, scene: SceneRow): string | null {
  if (scene.persona_id === null) return null;
  const row = db.query("SELECT name FROM personas WHERE id = $id").get({ id: scene.persona_id }) as
    | { name: string }
    | null;
  return row?.name ?? null;
}

/** Who the turn director says speaks, as an internal id. */
function directorChoice(db: Database, scene: SceneRow): number | null {
  const decision = resolveNextSpeaker(db, scene);
  return decision === null ? null : internalIdOf(db, scene, decision.characterId);
}

function hashToSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Turn a thrown value into something worth showing a user. */
function describeFailure(caught: unknown): { message: string; detail: string | null } {
  if (caught instanceof PromptBudgetError) {
    return { message: caught.message, detail: null };
  }
  if (caught instanceof AdapterError) {
    return { message: caught.message, detail: caught.providerMessage };
  }
  if (caught instanceof GenerationError) {
    return { message: caught.message, detail: null };
  }
  if (caught instanceof Error) {
    return { message: "The generation failed.", detail: caught.message };
  }
  return { message: "The generation failed.", detail: null };
}

export { findSceneById };
