import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../server/db/index.ts";
import { migrate } from "../server/db/migrate.ts";
import { loadOrCreateKeyring } from "../server/lib/crypto.ts";
import { loadConfig, ensureDataDirs, type Config } from "../server/config.ts";
import { createServer } from "../server/app.ts";
import { GenerationService } from "../server/generation/service.ts";
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
  const generation = new GenerationService({
    db,
    keyring: ctx.keyring,
    ...(options.adapter === undefined
      ? {}
      : { createAdapter: () => options.adapter as Adapter }),
  });
  const { app } = createServer(ctx, { serveClient: false, generationService: generation });

  const harness: TestHarness = {
    ctx,
    app,
    config,
    generation,
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
   * What to answer a turn director's question with (SPEC §6). Side calls share
   * the adapter with the generation they are part of, so a test that wants to
   * script both needs them told apart; the classifier's prompt says who built
   * it, and answering it never touches the queue driving the prose.
   */
  classifierReply: string | null = null;
  /** How many director questions this adapter has been asked. */
  classifierCalls = 0;
  /** Set to make the director's call fail, as an unreachable local model would. */
  classifierFails = false;
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

  get lastPrompt(): BuiltPrompt {
    const prompt = this.prompts.at(-1);
    if (prompt === undefined) throw new Error("nothing has been generated yet");
    return prompt;
  }

  async *generate(
    prompt: BuiltPrompt,
    _settings: unknown,
    signal: AbortSignal,
  ): AsyncIterable<TokenChunk> {
    this.prompts.push(prompt);

    if (prompt.debug.blocks[0]?.source === "turn director") {
      this.classifierCalls += 1;
      if (this.classifierFails) throw new Error("the director's model is unreachable");
      if (this.classifierReply !== null) yield { text: this.classifierReply };
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

/** Wait for a condition the generation service reaches asynchronously. */
export async function until(
  predicate: () => boolean,
  { timeoutMs = 2000 }: { timeoutMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for a condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
