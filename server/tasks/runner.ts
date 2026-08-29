import type { Database } from "bun:sqlite";
import { createAdapter as defaultCreateAdapter, AdapterError } from "../adapters/index.ts";
import type { BuiltPrompt } from "../prompt/index.ts";
import type { Keyring } from "../lib/crypto.ts";
import type { TaskRunStatus } from "../../shared/types.ts";
import { recordTaskRun, samplersOf, taskConfig } from "../db/queries/tasks.ts";
import { resolveRoute, type ResolvedRoute } from "../generation/route.ts";
import type { TaskKind } from "./registry.ts";

/**
 * The background-task primitive (SPEC §7).
 *
 * Summarisation, tracker refresh, memory extraction, the turn classifier,
 * expression classification and every post-generation pass are the same shape:
 * a prompt, a model to run it on, and somewhere for the answer to go. This runs
 * the middle part, once, for all of them.
 *
 * The rule that shapes everything here is §7's: **a background task must never
 * block or fail a user-facing generation.** So `run` does not throw. Every way
 * a side call can go wrong — no profile, an unreachable provider, a timeout, a
 * cancelled turn — comes back as a result the caller reads and falls back from.
 * A caller that cannot tell the difference between "no answer" and "the answer
 * was no" would be a worse bug than any of them, so the failures are named.
 *
 * The second rule follows from the first: because every failure is swallowed,
 * every run is logged. Otherwise "never fails a generation" quietly becomes
 * "side calls fail forever and nobody can tell".
 */

export type TaskOutcome =
  | { ok: true; text: string; provider: string; model: string; durationMs: number }
  | { ok: false; status: Exclude<TaskRunStatus, "ok">; detail: string };

export interface TaskRunnerOptions {
  db: Database;
  keyring: Keyring;
  now?: () => number;
  /** Injected in tests so no live provider is ever contacted (§23). */
  createAdapter?: typeof defaultCreateAdapter;
  /** How many side calls may be in flight at once across the process. */
  concurrency?: number;
}

export interface TaskRequest {
  kind: TaskKind;
  /** The scene this is about, for the log. Null for a task about nothing. */
  sceneId: number | null;
  /** Built by the caller, because only the caller knows what to ask. */
  prompt: BuiltPrompt;
  /**
   * Where to run it. A scene-level override beats the task's configured
   * profile, which beats the scene's own — SPEC §6's director profile is the
   * first instance of that order.
   */
  profileId?: number | null;
  /** The scene's profile, used when nothing above it is set. */
  fallbackProfileId: number | null;
  /** Aborting the turn aborts its side calls. */
  signal?: AbortSignal;
}

/**
 * Side calls are cheap individually and unbounded in aggregate: a
 * post-generation pipeline with four passes over a beat's five segments is
 * twenty requests from one turn. The cap is what stops that saturating a local
 * model that serves one request at a time.
 */
const DEFAULT_CONCURRENCY = 2;

export class TaskRunner {
  private readonly db: Database;
  private readonly keyring: Keyring;
  private readonly now: () => number;
  private readonly makeAdapter: typeof defaultCreateAdapter;
  private readonly limit: number;
  private inFlight = 0;
  private readonly waiting: (() => void)[] = [];
  private stopped = false;

  constructor(options: TaskRunnerOptions) {
    this.db = options.db;
    this.keyring = options.keyring;
    this.now = options.now ?? Date.now;
    this.makeAdapter = options.createAdapter ?? defaultCreateAdapter;
    this.limit = options.concurrency ?? DEFAULT_CONCURRENCY;
  }

  /** Stop admitting work. Called when the process is shutting down. */
  shutdown(): void {
    this.stopped = true;
    for (const release of this.waiting.splice(0)) release();
  }

  /**
   * Run one task to completion. Never throws.
   *
   * A caller records its own `skipped` runs — only the task knows there was
   * nothing worth asking — so this is only reached once there is a question.
   */
  async run(request: TaskRequest): Promise<TaskOutcome> {
    const startedAt = this.now();
    const config = taskConfig(this.db, request.kind);

    if (config.enabled === 0) {
      return this.fail(request, "skipped", "Turned off in settings.", startedAt, null);
    }
    if (this.stopped) {
      return this.fail(request, "cancelled", "The server is shutting down.", startedAt, null);
    }

    let route: ResolvedRoute;
    try {
      route = resolveRoute(this.db, this.keyring, {
        // A scene's own override wins; then this task's configured model; then
        // whatever the scene generates prose on.
        profileId:
          request.profileId ?? config.connection_profile_id ?? request.fallbackProfileId,
      });
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "No model to run this on.";
      return this.fail(request, "failed", detail, startedAt, null);
    }

    await this.acquire();
    try {
      if (this.stopped) {
        return this.fail(request, "cancelled", "The server is shutting down.", startedAt, route);
      }

      const own = new AbortController();
      // Held separately rather than only merged: an adapter may end cleanly on
      // abort instead of throwing, and "we gave up waiting" then looks exactly
      // like "the model said nothing" unless the reason is still readable.
      const expiry = AbortSignal.timeout(config.timeout_ms);
      const signal = AbortSignal.any([
        ...(request.signal === undefined ? [] : [request.signal]),
        own.signal,
        expiry,
      ]);

      let text = "";
      let truncated = false;
      try {
        const adapter = this.makeAdapter(route.kind, {
          baseUrl: route.baseUrl,
          apiKey: route.apiKey,
          model: route.model,
        });
        for await (const chunk of adapter.generate(
          request.prompt,
          samplersOf(config, request.kind),
          signal,
        )) {
          text += chunk.text;
          if (text.length >= request.kind.replyLimit) {
            // The bound reached: stop the provider rather than reading a model
            // that has started talking. The signal reaches upstream (§4).
            truncated = true;
            own.abort();
            break;
          }
        }
      } catch (caught) {
        // Whatever arrived before the failure is often the whole answer — the
        // formats these tasks ask for put the answer on the first line — so a
        // partial reply is returned rather than thrown away.
        if (text.trim() === "") {
          return this.fail(
            request,
            statusOf(caught, expiry, request.signal),
            describe(caught),
            startedAt,
            route,
          );
        }
      }

      if (text.trim() === "") {
        // An adapter that returns rather than throwing on abort lands here, so
        // the reason has to come from the signals rather than from an error.
        if (expiry.aborted) {
          return this.fail(
            request,
            "timeout",
            `Gave up after ${config.timeout_ms}ms.`,
            startedAt,
            route,
          );
        }
        if (request.signal?.aborted === true) {
          return this.fail(request, "cancelled", "The turn was cancelled.", startedAt, route);
        }
        return this.fail(request, "unusable", "The model returned nothing.", startedAt, route);
      }

      const durationMs = this.now() - startedAt;
      this.log(request, {
        status: "ok",
        route,
        output: text,
        detail: truncated ? "Stopped at the reply limit." : null,
        durationMs,
      });
      return { ok: true, text, provider: route.providerName, model: route.model, durationMs };
    } finally {
      this.release();
    }
  }

  /**
   * Record a run the caller decided not to make, or whose answer it could not
   * use. Only the task knows either, and both belong in the log beside the
   * failures — "the classifier named somebody who is not in the cast" is the
   * thing you want to find when the director keeps falling back.
   */
  noteSkipped(request: Omit<TaskRequest, "prompt">, detail: string): void {
    this.log({ ...request, prompt: null }, {
      status: "skipped",
      route: null,
      output: null,
      detail,
      durationMs: 0,
    });
  }

  noteUnusable(request: TaskRequest, output: string, detail: string): void {
    this.log(request, { status: "unusable", route: null, output, detail, durationMs: 0 });
  }

  /* ---------------- plumbing ---------------- */

  private fail(
    request: TaskRequest,
    status: Exclude<TaskRunStatus, "ok">,
    detail: string,
    startedAt: number,
    route: ResolvedRoute | null,
  ): TaskOutcome {
    this.log(request, { status, route, output: null, detail, durationMs: this.now() - startedAt });
    return { ok: false, status, detail };
  }

  private log(
    request: { kind: TaskKind; sceneId: number | null; prompt: BuiltPrompt | null },
    entry: {
      status: TaskRunStatus;
      route: ResolvedRoute | null;
      output: string | null;
      detail: string | null;
      durationMs: number;
    },
  ): void {
    // Shutting down closes the database out from under an in-flight task; a log
    // line is not worth crashing the exit path for.
    if (this.stopped && entry.status !== "cancelled") return;
    try {
      recordTaskRun(this.db, {
        taskKey: request.kind.key,
        sceneId: request.sceneId,
        status: entry.status,
        provider: entry.route?.providerName ?? null,
        model: entry.route?.model ?? null,
        prompt: request.prompt === null ? null : promptText(request.prompt),
        output: entry.output,
        detail: entry.detail,
        durationMs: entry.durationMs,
      });
    } catch {
      /* The log is a convenience; failing to write it must not fail the task. */
    }
  }

  private async acquire(): Promise<void> {
    if (this.inFlight < this.limit) {
      this.inFlight += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.inFlight += 1;
  }

  private release(): void {
    this.inFlight -= 1;
    const next = this.waiting.shift();
    if (next !== undefined) next();
  }
}

/** The prompt as it was sent, for the log. */
function promptText(prompt: BuiltPrompt): string {
  return [
    ...(prompt.system === undefined ? [] : [prompt.system]),
    ...prompt.messages.map((message) => message.content),
  ].join("\n\n");
}

function statusOf(
  caught: unknown,
  expiry: AbortSignal,
  outer: AbortSignal | undefined,
): Exclude<TaskRunStatus, "ok"> {
  // The timeout is checked first: a turn cancelled *and* timed out is a turn
  // that took too long, which is the more useful thing to be told.
  if (expiry.aborted) return "timeout";
  if (outer?.aborted === true) return "cancelled";
  if (caught instanceof Error && caught.name === "TimeoutError") return "timeout";
  return "failed";
}

function describe(caught: unknown): string {
  if (caught instanceof AdapterError) {
    return caught.providerMessage === null
      ? caught.message
      : `${caught.message} ${caught.providerMessage}`;
  }
  if (caught instanceof Error) return caught.message;
  return "The call failed.";
}
