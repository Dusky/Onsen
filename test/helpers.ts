import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../server/db/index.ts";
import { migrate } from "../server/db/migrate.ts";
import { loadOrCreateKeyring } from "../server/lib/crypto.ts";
import { loadConfig, ensureDataDirs, type Config } from "../server/config.ts";
import { createServer } from "../server/app.ts";
import { GenerationService } from "../server/generation/service.ts";
import { TaskRunner } from "../server/tasks/runner.ts";
import { PassPipeline } from "../server/passes/pipeline.ts";
import { GuideRunner } from "../server/guides/runner.ts";
import { SummaryRunner } from "../server/summaries/runner.ts";
import type { AppContext } from "../server/context.ts";
import type { Hono } from "hono";
import type { AppEnv } from "../server/context.ts";
import type { Adapter, TokenChunk } from "../server/adapters/index.ts";
import type { BuiltPrompt } from "../server/prompt/index.ts";
import { OPENAI_COMPATIBLE_CAPABILITIES } from "../server/adapters/index.ts";

export interface TestHarness {
  ctx: AppContext;
  app: Hono<AppEnv>;
  config: Config;
  generation: GenerationService;
  tasks: TaskRunner;
  passes: PassPipeline;
  guides: GuideRunner;
  summaries: SummaryRunner;
  /** Sends a request through the app, carrying the session cookie if one is held. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  /** Capture the session cookie from a response so later requests are authenticated. */
  captureCookie(response: Response): void;
  cookie: string | null;
  cleanup(): void;
}

export interface HarnessOptions {
  /**
   * Supplied so tests never contact a live provider (SPEC §23). The adapter
   * this returns is usually a ScriptedAdapter, which lets a test control
   * exactly when tokens arrive.
   */
  adapter?: Adapter;
}

export function createHarness(options: HarnessOptions = {}): TestHarness {
  const dataDir = mkdtempSync(join(tmpdir(), "onsen-test-"));
  const config = loadConfig({ ONSEN_DATA_DIR: dataDir } as NodeJS.ProcessEnv);
  ensureDataDirs(config);

  const db = openDatabase(":memory:");
  migrate(db);
  const ctx: AppContext = { db, config, keyring: loadOrCreateKeyring(config, {} as NodeJS.ProcessEnv) };
  const adapterOption =
    options.adapter === undefined ? {} : { createAdapter: () => options.adapter as Adapter };
  // The runner is shared with the generation service, as it is in production:
  // a side call and the turn it belongs to run against the same fixture.
  const tasks = new TaskRunner({ db, keyring: ctx.keyring, ...adapterOption });
  const passes = new PassPipeline({ db, tasks });
  const guides = new GuideRunner({ db, tasks });
  const summaries = new SummaryRunner({ db, tasks });
  const generation = new GenerationService({
    db,
    keyring: ctx.keyring,
    tasks,
    passes,
    guides,
    summaries,
    ...adapterOption,
  });
  const { app } = createServer(ctx, {
    serveClient: false,
    generationService: generation,
    taskRunner: tasks,
    passPipeline: passes,
    guideRunner: guides,
    summaryRunner: summaries,
  });

  const harness: TestHarness = {
    ctx,
    app,
    config,
    generation,
    tasks,
    passes,
    guides,
    summaries,
    cookie: null,
    async fetch(path, init) {
      const headers = new Headers(init?.headers);
      if (harness.cookie) headers.set("Cookie", harness.cookie);
      const response = await app.request(path, { ...init, headers });
      return response;
    },
    captureCookie(response) {
      const raw = response.headers.get("set-cookie");
      if (!raw) return;
      const value = raw.split(";")[0];
      harness.cookie = value ?? null;
    },
    cleanup() {
      generation.shutdown();
      tasks.shutdown();
      passes.shutdown();
      guides.shutdown();
      summaries.shutdown();
      db.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };

  return harness;
}

export const VALID_SETUP = {
  password: "correct horse battery",
  connection: {
    profileName: "Local 70B",
    providerName: "llama.cpp",
    kind: "text_completion" as const,
    baseUrl: "http://localhost:8080",
    model: "llama-3.3-70b",
  },
};

/** Runs the wizard and leaves the harness holding an authenticated cookie. */
export async function completeSetup(harness: TestHarness): Promise<Response> {
  const response = await harness.fetch("/api/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(VALID_SETUP),
  });
  harness.captureCookie(response);
  return response;
}


/* ------------------------------------------------------------------ */
/* A controllable adapter                                              */
/* ------------------------------------------------------------------ */

type ScriptItem = { text: string } | { end: true } | { error: Error };

/**
 * An adapter whose output a test drives token by token. This is what makes the
 * streaming behaviour testable: a test can push a token, disconnect a client,
 * push another, reconnect, and assert nothing was lost.
 */
export class ScriptedAdapter implements Adapter {
  readonly kind = "scripted";
  readonly capabilities = OPENAI_COMPATIBLE_CAPABILITIES;

  /** Set when the generation service aborted this adapter. */
  aborted = false;
  /** Every prompt this adapter was handed, so tests can read what was sent. */
  readonly prompts: BuiltPrompt[] = [];
  /**
   * What to answer a background task with (SPEC §7). Side calls share the
   * adapter with the generation they belong to, so a test that scripts both
   * needs them told apart; a task's prompt says who built it, and answering it
   * never touches the queue driving the prose.
   */
  taskReply: string | null = null;
  /**
   * A reply chosen from the prompt, for tests that script several kinds of side
   * call at once — the post-generation pipeline runs three in a row, and they
   * all reach the same adapter.
   */
  taskReplyFor: ((prompt: BuiltPrompt) => string | null) | null = null;
  /** How many side calls this adapter has been asked, of every kind. */
  taskCalls = 0;
  /** Set to make side calls fail, as an unreachable local model would. */
  taskFails = false;
  /** Resolves once generate() has actually been entered. */
  readonly started: Promise<void>;

  private queue: ScriptItem[] = [];
  private wake: (() => void) | null = null;
  private markStarted!: () => void;

  constructor() {
    this.started = new Promise((resolve) => {
      this.markStarted = resolve;
    });
  }

  push(text: string): void {
    this.queue.push({ text });
    this.flush();
  }

  end(): void {
    this.queue.push({ end: true });
    this.flush();
  }

  fail(error: Error): void {
    this.queue.push({ error });
    this.flush();
  }

  private flush(): void {
    this.wake?.();
    this.wake = null;
  }

  private next(): Promise<void> {
    return new Promise((resolve) => {
      this.wake = resolve;
    });
  }

  /**
   * The last prompt for a *turn*, ignoring side calls.
   *
   * Several side calls now follow every turn — the classifier before it, the
   * passes and the guides after — so "the last thing the adapter saw" stopped
   * meaning "the turn" the moment guides landed. A turn's prompt is assembled
   * from §3's blocks and has more than the two a side call builds.
   */
  get lastPrompt(): BuiltPrompt {
    const prompt = this.prompts.filter((entry) => entry.debug.blocks.length > 2).at(-1);
    if (prompt === undefined) throw new Error("nothing has been generated yet");
    return prompt;
  }

  /** Side-call prompts, by the label their first block carries. */
  promptsLabelled(label: string): BuiltPrompt[] {
    return this.prompts.filter((prompt) => prompt.debug.blocks[0]?.label === label);
  }

  /** How many side calls of one kind this adapter has been asked. */
  callsLabelled(label: string): number {
    return this.promptsLabelled(label).length;
  }

  async *generate(
    prompt: BuiltPrompt,
    _settings: unknown,
    signal: AbortSignal,
  ): AsyncIterable<TokenChunk> {
    this.prompts.push(prompt);

    // A side call builds its own small prompt and names itself as the source;
    // a turn's prompt is assembled from §3's blocks and never looks like this.
    const source = prompt.debug.blocks[0]?.source;
    if (source === "turn director" || source === "guided op") {
      this.taskCalls += 1;
      if (this.taskFails) throw new Error("the model is unreachable");
      const chosen = this.taskReplyFor?.(prompt) ?? this.taskReply;
      if (chosen !== null) yield { text: chosen };
      return;
    }

    this.markStarted();
    signal.addEventListener("abort", () => {
      this.aborted = true;
      this.flush();
    });

    for (;;) {
      if (signal.aborted) return;
      const item = this.queue.shift();
      if (item === undefined) {
        await this.next();
        continue;
      }
      if ("text" in item) yield { text: item.text };
      else if ("end" in item) return;
      else throw item.error;
    }
  }
}

/** Give the event loop a turn, so background work can advance. */
export async function tick(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Wait for a condition something reaches asynchronously.
 *
 * The predicate may be async — the post-generation pipeline is only observable
 * over HTTP — and the result is awaited rather than tested for truthiness. A
 * pending promise is truthy, so a version of this that did not await would
 * return immediately and the test would pass by luck.
 */
export async function until(
  predicate: () => boolean | Promise<boolean>,
  { timeoutMs = 2000 }: { timeoutMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("timed out waiting for a condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
