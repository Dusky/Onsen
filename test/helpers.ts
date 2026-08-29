import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../server/db/index.ts";
import { migrate } from "../server/db/migrate.ts";
import { loadOrCreateKeyring } from "../server/lib/crypto.ts";
import { loadConfig, ensureDataDirs, type Config } from "../server/config.ts";
import { createApp } from "../server/app.ts";
import type { AppContext } from "../server/context.ts";
import type { Hono } from "hono";
import type { AppEnv } from "../server/context.ts";

export interface TestHarness {
  ctx: AppContext;
  app: Hono<AppEnv>;
  config: Config;
  /** Sends a request through the app, carrying the session cookie if one is held. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  /** Capture the session cookie from a response so later requests are authenticated. */
  captureCookie(response: Response): void;
  cookie: string | null;
  cleanup(): void;
}

export function createHarness(): TestHarness {
  const dataDir = mkdtempSync(join(tmpdir(), "onsen-test-"));
  const config = loadConfig({ ONSEN_DATA_DIR: dataDir } as NodeJS.ProcessEnv);
  ensureDataDirs(config);

  const db = openDatabase(":memory:");
  migrate(db);
  const ctx: AppContext = { db, config, keyring: loadOrCreateKeyring(config, {} as NodeJS.ProcessEnv) };
  const app = createApp(ctx, { serveClient: false });

  const harness: TestHarness = {
    ctx,
    app,
    config,
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
