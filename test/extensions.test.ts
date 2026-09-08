import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { completeSetup, createHarness, type TestHarness } from "./helpers.ts";
import { loadExtensionModule } from "../server/extensions/loader.ts";
import { postGenerationExtensionTasks, clearExtensionTasks } from "../server/extensions/registry.ts";

/**
 * The extension code API (SPEC §15, §20 phase 110).
 *
 * An extension's `server.ts` exports `register(ctx)`; `ctx.task` collects a
 * side-call task, persisted and run by the host. This pins the loader and the
 * install-from-URL path for code.
 */

let harness: TestHarness | null = null;

async function signedIn(): Promise<TestHarness> {
  if (harness === null) {
    harness = createHarness();
    await completeSetup(harness);
  }
  return harness;
}

afterEach(() => {
  harness?.cleanup();
  harness = null;
  clearExtensionTasks();
});

const SERVER_TS = `
export function register(ctx) {
  ctx.task({
    key: "roll",
    label: "Roll dice",
    prompt: "Roll 2d6 for: {{lastMessage}}",
    stage: "post_generation",
  });
}
`;

function repoWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "onsen-ext-"));
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  const run = (args: string[]) => Bun.spawnSync(["git", ...args], { cwd: dir });
  run(["init", "-q"]);
  run(["add", "-A"]);
  run(["-c", "user.email=x@y", "-c", "user.name=X", "commit", "-qm", "init"]);
  return dir;
}

describe("the extension code API", () => {
  test("register collects the tasks a module declares", async () => {
    const dir = mkdtempSync(join(tmpdir(), "onsen-ext-"));
    writeFileSync(join(dir, "server.ts"), SERVER_TS);
    try {
      const registration = await loadExtensionModule(join(dir, "server.ts"), "suite");
      expect(registration.tasks).toHaveLength(1);
      expect(registration.tasks[0]!.key).toBe("roll");
      expect(registration.tasks[0]!.stage).toBe("post_generation");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("installing a repository with server.ts registers and persists its task", async () => {
    const t = await signedIn();
    const dir = repoWith({
      "pack.json": JSON.stringify({ name: "Dice", version: "1.0.0", author: "me", description: "" }),
      "server.ts": SERVER_TS,
    });
    try {
      const response = await t.fetch("/api/packs/install-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: dir }),
      });
      expect(response.status).toBe(201);

      expect(postGenerationExtensionTasks().map((entry) => entry.task.key)).toContain("roll");
      const row = t.ctx.db
        .query("SELECT key, stage FROM tasks WHERE key = 'ext:Dice:roll'")
        .get() as { key: string; stage: string } | undefined;
      expect(row?.key).toBe("ext:Dice:roll");
      expect(row?.stage).toBe("post_generation");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("uninstalling the pack removes the extension's code, rows and callbacks", async () => {
    const t = await signedIn();
    const dir = repoWith({
      "pack.json": JSON.stringify({ name: "Dice", version: "1.0.0", author: "me", description: "" }),
      "server.ts": SERVER_TS,
    });
    try {
      const installed = await t.fetch("/api/packs/install-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: dir }),
      });
      expect(installed.status).toBe(201);
      const packId = (await installed.json()).packId as string;

      // The code directory landed under the extensions root, and the callback
      // is live in this process.
      const codeDir = join(t.config.extensionsDir, "dice");
      expect(existsSync(join(codeDir, "server.ts"))).toBe(true);
      expect(postGenerationExtensionTasks().map((entry) => entry.task.key)).toContain("roll");

      const removed = await t.fetch(`/api/packs/${packId}`, { method: "DELETE" });
      expect(removed.status).toBe(200);

      // The extension row and its tasks are gone.
      expect(t.ctx.db.query("SELECT id FROM extensions WHERE name = 'Dice'").get()).toBeNull();
      expect(t.ctx.db.query("SELECT key FROM tasks WHERE key = 'ext:Dice:roll'").get()).toBeNull();
      // The callback is gone now, not merely after a restart.
      expect(postGenerationExtensionTasks().map((entry) => entry.task.key)).not.toContain("roll");
      // The code directory is gone.
      expect(existsSync(codeDir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/* ------------------------------------------------------------------ */
/* Extension management (SPEC §15, §20 phase 143)                     */
/* ------------------------------------------------------------------ */

/** `register` bakes a setting into the prompt, so settings reach the code. */
const SETTINGS_SERVER_TS = `
export function register(ctx, settings) {
  ctx.task({
    key: "tone",
    label: "Tone",
    prompt: "Style: " + (settings && settings.style ? settings.style : "default"),
    stage: "post_generation",
  });
}
`;

const TONE_PACK = {
  name: "Tone",
  version: "1.0.0",
  author: "me",
  description: "A tone knob",
  settings: [
    { key: "style", label: "Style", type: "select", options: ["terse", "verbose"], default: "terse" },
    { key: "count", label: "Count", type: "number", default: 2, min: 1, max: 9 },
    { key: "dry", label: "Dry", type: "boolean", default: true },
  ],
};

describe("extension management", () => {
  test("installing from a GitHub link reads the manifest and its settings schema", async () => {
    const t = await signedIn();
    const dir = repoWith({
      "pack.json": JSON.stringify(TONE_PACK),
      "server.ts": SETTINGS_SERVER_TS,
    });
    try {
      const response = await t.fetch("/api/packs/install-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: dir }),
      });
      expect(response.status).toBe(201);

      const list = await t.fetch("/api/extensions");
      const body = (await list.json()) as Array<{
        name: string;
        enabled: boolean;
        description: string | null;
        settings: Record<string, unknown>;
        settingsSchema: Array<{ key: string; type: string }>;
      }>;
      const tone = body.find((entry) => entry.name === "Tone");
      expect(tone).toBeDefined();
      expect(tone!.enabled).toBe(true);
      expect(tone!.description).toBe("A tone knob");
      expect(tone!.settingsSchema).toHaveLength(3);
      // Defaults reach the stored settings on a fresh install.
      expect(tone!.settings).toEqual({ style: "terse", count: 2, dry: true });
      // And the defaults reach `register`, observable through the task prompt.
      const prompt = (postGenerationExtensionTasks().find((e) => e.task.key === "tone")?.task.prompt) ?? "";
      expect(prompt).toContain("terse");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("writing settings reloads the extension with the new values", async () => {
    const t = await signedIn();
    const dir = repoWith({
      "pack.json": JSON.stringify(TONE_PACK),
      "server.ts": SETTINGS_SERVER_TS,
    });
    try {
      const installed = await t.fetch("/api/packs/install-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: dir }),
      });
      expect(installed.status).toBe(201);
      const list = await (await t.fetch("/api/extensions")).json() as Array<{ id: string; name: string }>;
      const id = list.find((entry) => entry.name === "Tone")!.id;

      const patched = await t.fetch(`/api/extensions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { style: "verbose", count: 3, dry: false } }),
      });
      expect(patched.status).toBe(200);

      const prompt = (postGenerationExtensionTasks().find((e) => e.task.key === "tone")?.task.prompt) ?? "";
      expect(prompt).toContain("verbose");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("disabling unregisters the tasks, and deleting removes the extension", async () => {
    const t = await signedIn();
    const dir = repoWith({
      "pack.json": JSON.stringify(TONE_PACK),
      "server.ts": SETTINGS_SERVER_TS,
    });
    try {
      const installed = await t.fetch("/api/packs/install-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: dir }),
      });
      expect(installed.status).toBe(201);
      const list = await (await t.fetch("/api/extensions")).json() as Array<{ id: string; name: string }>;
      const id = list.find((entry) => entry.name === "Tone")!.id;

      const off = await t.fetch(`/api/extensions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      });
      expect(off.status).toBe(200);
      expect(postGenerationExtensionTasks().map((entry) => entry.task.key)).not.toContain("tone");

      const removed = await t.fetch(`/api/extensions/${id}`, { method: "DELETE" });
      expect(removed.status).toBe(200);
      expect(t.ctx.db.query("SELECT id FROM extensions WHERE name = 'Tone'").get()).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
