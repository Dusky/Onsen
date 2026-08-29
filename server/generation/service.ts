import type { Database } from "bun:sqlite";
import { ulid } from "../lib/ulid.ts";
import type { Keyring } from "../lib/crypto.ts";
import { createAdapter as defaultCreateAdapter, AdapterError, type Adapter } from "../adapters/index.ts";
import { buildPrompt, createEstimatingTokenizer, PromptBudgetError } from "../prompt/index.ts";
import { DEFAULT_BEAT_BOUND } from "../../shared/types.ts";
import type {
  BeatBound,
  ResolvedTurnScope,
  SamplerSettings,
  TurnScope,
} from "../../shared/types.ts";
import {
  activePath,
  appendMessage,
  findMessageById,
  findSceneById,
  reparseSegments,
  replaceSegment,
  segmentRowsOf,
  speakerLookup,
  type MessageRow,
  type MessageRowWithSiblings,
  type SceneRow,
} from "../db/queries/history.ts";
import { buildPromptContext, resolvePreset } from "./context.ts";
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

export interface GenerationMeta {
  provider: string;
  model: string;
  /** Milliseconds from dispatch to the first token. */
  ttftMs: number | null;
  /** Estimated, because the estimator is the only tokenizer that ships (§3). */
  completionTokens: number | null;
  tokensPerSecond: number | null;
  promptTokens: number;
  tokensAreEstimated: boolean;
  samplers: SamplerSettings;
}

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
  abort: AbortController;
  listeners: Set<(event: GenerationEvent) => void>;
  startedAt: number;
  finishedAt: number | null;
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
  | { kind: "recast"; messageId: number; ordinal: number; beatText: string; characterName: string };

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
      spotlightId: turn.kind === "recast" ? recastSpeakerId(this.db, turn) : null,
      requestedSpotlightId: options.spotlightId ?? null,
      turn,
      director: null,
      abort: new AbortController(),
      listeners: new Set(),
      startedAt,
      finishedAt: null,
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

  /* ---------------- the work ---------------- */

  private async run(
    generation: ActiveGeneration,
    scene: SceneRow,
    route: ResolvedRoute,
  ): Promise<void> {
    let adapter: Adapter;
    try {
      adapter = this.makeAdapter(route.kind, {
        baseUrl: route.baseUrl,
        apiKey: route.apiKey,
        model: route.model,
      });
    } catch (caught) {
      this.fail(generation, caught);
      return;
    }

    let dispatchedAt = this.now();
    try {
      const { samplers } = resolvePreset(this.db, route.presetId);
      generation.meta.samplers = samplers;

      // Who speaks, and whether one of them or several. For the classifier this
      // is a model call, which is why it happens here rather than in `start`.
      await this.direct(generation, scene);
      if (generation.abort.signal.aborted) {
        this.finish(generation, dispatchedAt);
        return;
      }

      const context = buildPromptContext({
        db: this.db,
        scene,
        capabilities: adapter.capabilities,
        spotlightId: generation.spotlightId,
        turn:
          generation.turn.kind === "recast"
            ? { kind: "recast", beatText: generation.turn.beatText }
            : generation.turn.kind === "auto"
              ? { kind: "spotlight" }
              : generation.turn,
        now: this.now(),
        // The seed is derived from the generation's own identifier, so a reroll
        // is a genuinely different draw while one generation stays reproducible.
        seed: hashToSeed(generation.id),
        ...(generation.parentId === null
          ? { history: [] }
          : { history: pathTo(this.db, generation.parentId) }),
      });

      const prompt = buildPrompt(context);
      generation.meta.promptTokens = prompt.debug.totalTokens;
      generation.meta.tokensAreEstimated = prompt.debug.tokensAreEstimated;

      this.setStatus(generation, "streaming");
      dispatchedAt = this.now();

      for await (const chunk of adapter.generate(prompt, samplers, generation.abort.signal)) {
        if (generation.abort.signal.aborted) break;
        if (generation.meta.ttftMs === null) generation.meta.ttftMs = this.now() - dispatchedAt;
        this.append(generation, chunk.text);
      }
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
   * Write the message node and emit the terminal event (SPEC §5.5). A cancelled
   * generation keeps whatever it produced — partial output is still the user's
   * text, and discarding it loses work they watched arrive.
   */
  private finish(generation: ActiveGeneration, dispatchedAt: number): void {
    const cancelled = generation.abort.signal.aborted;
    const finishedAt = this.now();
    generation.finishedAt = finishedAt;

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
        generation.messageUlid = message.ulid;
        this.db
          .query("UPDATE generations SET target_message_id = $target WHERE id = $id")
          .run({ id: generation.rowId, target: message.id });
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
  private land(generation: ActiveGeneration): MessageRow | null {
    if (generation.turn.kind === "recast") {
      const beat = findMessageById(this.db, generation.turn.messageId);
      // The beat was deleted while this was generating. The text is kept on the
      // generation row either way; there is nothing left to splice it into.
      if (beat === null) return null;
      return replaceSegment(this.db, beat, generation.turn.ordinal, generation.buffer);
    }

    const isBeat = generation.turn.kind === "beat";
    const message = appendMessage(this.db, {
      sceneId: generation.sceneId,
      parentId: generation.parentId,
      kind: isBeat ? "beat" : "spotlight",
      authorType: "character",
      content: generation.buffer,
      // A beat is filed under whoever opened it, so the log has something to
      // attribute it to; who spoke *last* in it comes from its segments (§6).
      characterId: generation.spotlightId,
    });
    if (isBeat) reparseSegments(this.db, message);
    return message;
  }

  private fail(generation: ActiveGeneration, caught: unknown): void {
    const { message, detail } = describeFailure(caught);
    generation.status = "error";
    generation.error = message;
    generation.detail = detail;
    generation.finishedAt = this.now();
    // Nothing left to write to, and nobody left to tell.
    if (this.stopped) return;
    this.persist(generation);
    this.emit(generation, { type: "error", message, detail });
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

  if (options.scope === "beat") return { kind: "beat", bound: options.beatBound ?? DEFAULT_BEAT_BOUND };
  if (options.scope === "auto") return { kind: "auto", bound: options.beatBound ?? DEFAULT_BEAT_BOUND };
  return { kind: "spotlight" };
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
