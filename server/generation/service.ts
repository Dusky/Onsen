import type { Database } from "bun:sqlite";
import { ulid } from "../lib/ulid.ts";
import { decryptSecret, type Keyring } from "../lib/crypto.ts";
import { createAdapter as defaultCreateAdapter, AdapterError, type Adapter } from "../adapters/index.ts";
import { buildPrompt, createEstimatingTokenizer, PromptBudgetError } from "../prompt/index.ts";
import type { ProviderKind, SamplerSettings } from "../../shared/types.ts";
import {
  appendMessage,
  findSceneById,
  type MessageRowWithSiblings,
  type SceneRow,
} from "../db/queries/history.ts";
import { buildPromptContext, resolvePreset } from "./context.ts";
import { internalIdOf, resolveNextSpeaker } from "./turn.ts";

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

export type GenerationEvent =
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
}

interface ResolvedRoute {
  kind: ProviderKind;
  providerName: string;
  baseUrl: string;
  apiKey: string | null;
  model: string;
  presetId: number | null;
}

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
    const parentId = options.parentId === undefined ? scene.active_leaf_id : options.parentId;
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
      spotlightId: options.spotlightId ?? directorChoice(this.db, scene),
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

      const context = buildPromptContext({
        db: this.db,
        scene,
        capabilities: adapter.capabilities,
        spotlightId: generation.spotlightId,
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
      const message = appendMessage(this.db, {
        sceneId: generation.sceneId,
        parentId: generation.parentId,
        kind: "spotlight",
        authorType: "character",
        content: generation.buffer,
        characterId: generation.spotlightId,
      });
      this.db
        .query("UPDATE messages SET generation_meta = $meta WHERE id = $id")
        .run({ id: message.id, meta: JSON.stringify(generation.meta) });
      generation.messageUlid = message.ulid;
      this.db
        .query("UPDATE generations SET target_message_id = $target WHERE id = $id")
        .run({ id: generation.rowId, target: message.id });
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
  private resolveRoute(scene: SceneRow, overrideProfileId: number | null): ResolvedRoute {
    const profileId = overrideProfileId ?? scene.connection_profile_id;
    if (profileId === null) {
      throw new GenerationError(
        "no_connection",
        "This scene has no connection profile. Choose one before generating.",
      );
    }

    const row = this.db
      .query(
        `SELECT cp.model AS profile_model, cp.preset_id,
                p.name AS provider_name, p.kind, p.base_url, p.api_key_encrypted, p.model AS provider_model, p.enabled
           FROM connection_profiles cp
           JOIN providers p ON p.id = cp.provider_id
          WHERE cp.id = $id`,
      )
      .get({ id: profileId }) as
      | {
          profile_model: string | null;
          preset_id: number | null;
          provider_name: string;
          kind: ProviderKind;
          base_url: string | null;
          api_key_encrypted: string | null;
          provider_model: string | null;
          enabled: number;
        }
      | null;

    if (row === null) {
      throw new GenerationError("no_connection", "That connection profile no longer exists.");
    }
    if (row.enabled !== 1) {
      throw new GenerationError("provider_disabled", `${row.provider_name} is disabled.`);
    }

    const model = row.profile_model ?? row.provider_model;
    if (model === null) {
      throw new GenerationError("no_model", `No model is set for ${row.provider_name}.`);
    }
    if (row.base_url === null) {
      throw new GenerationError("no_base_url", `No address is set for ${row.provider_name}.`);
    }

    let apiKey: string | null = null;
    if (row.api_key_encrypted !== null) {
      try {
        apiKey = decryptSecret(this.keyring, row.api_key_encrypted);
      } catch {
        throw new GenerationError(
          "unreadable_key",
          `The stored API key for ${row.provider_name} cannot be decrypted. Re-enter it.`,
        );
      }
    }

    return {
      kind: row.kind,
      providerName: row.provider_name,
      baseUrl: row.base_url,
      apiKey,
      model,
      presetId: row.preset_id,
    };
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
