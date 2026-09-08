import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { completeSetup, createHarness, type TestHarness } from "./helpers.ts";
import { loadExtensionModule } from "../server/extensions/loader.ts";
import { loadInstalledExtensions, installShippedExtensions } from "../server/extensions/install.ts";
import { postGenerationExtensionTasks, clearExtensionTasks, collectExtensionInjections } from "../server/extensions/registry.ts";
import { writeExtensionState } from "../server/extensions/state.ts";
import { isSummariseSuppressed } from "../server/db/queries/settings.ts";

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

/* ------------------------------------------------------------------ */
/* Built-in extensions (SPEC §15, §20 phase 144)                      */
/* ------------------------------------------------------------------ */

describe("built-in extensions", () => {
  test("boot seeds the built-ins disabled, with their schemas", async () => {
    const t = await signedIn();
    await loadInstalledExtensions(t.ctx.db, t.config.extensionsDir);

    const list = await (await t.fetch("/api/extensions")).json() as Array<{
      name: string;
      enabled: boolean;
      builtIn: boolean;
      settingsSchema: Array<{ key: string }>;
    }>;
    const proofread = list.find((entry) => entry.name === "Proofread");
    expect(proofread).toBeDefined();
    expect(proofread!.builtIn).toBe(true);
    expect(proofread!.enabled).toBe(false);
    expect(proofread!.settingsSchema.map((f) => f.key)).toContain("level");
    // Disabled, so it contributes no tasks.
    expect(postGenerationExtensionTasks().map((entry) => entry.task.key)).not.toContain("proofread");
  });

  test("enabling a built-in registers its tasks, and a built-in cannot be removed", async () => {
    const t = await signedIn();
    await loadInstalledExtensions(t.ctx.db, t.config.extensionsDir);
    const list = await (await t.fetch("/api/extensions")).json() as Array<{ id: string; name: string; builtIn: boolean }>;
    const proofread = list.find((entry) => entry.name === "Proofread")!;

    const on = await t.fetch(`/api/extensions/${proofread.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(on.status).toBe(200);
    expect(postGenerationExtensionTasks().map((entry) => entry.task.key)).toContain("proofread");

    const removed = await t.fetch(`/api/extensions/${proofread.id}`, { method: "DELETE" });
    expect(removed.status).toBe(400);
    expect(t.ctx.db.query("SELECT id FROM extensions WHERE name = 'Proofread'").get()).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Task gating and prompt injection (SPEC §15, §20 phase 145)          */
/* ------------------------------------------------------------------ */

const INJECT_SERVER_TS = `
export function register(ctx) {
  ctx.task({
    key: "every3",
    label: "Every three",
    prompt: "hi",
    stage: "post_generation",
    shouldRun: (ctx) => ctx.messageCount % 3 === 0,
  });
  ctx.inject({
    key: "note",
    label: "Note",
    position: "in_chat",
    depth: 1,
    render: () => "[Extension note]",
  });
}
`;

describe("task gating and prompt injection", () => {
  test("a gated task keeps its shouldRun and decides per turn", async () => {
    const t = await signedIn();
    const dir = mkdtempSync(join(tmpdir(), "onsen-ext-"));
    writeFileSync(join(dir, "server.ts"), INJECT_SERVER_TS);
    try {
      const registration = await loadExtensionModule(join(dir, "server.ts"), "suite");
      const task = registration.tasks.find((entry) => entry.key === "every3")!;
      expect(task.shouldRun).toBeDefined();
      expect(task.shouldRun!({ db: t.ctx.db, sceneId: 1, messageCount: 3 })).toBe(true);
      expect(task.shouldRun!({ db: t.ctx.db, sceneId: 1, messageCount: 2 })).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an injection renders into the prompt blocks at its placement", async () => {
    const t = await signedIn();
    const dir = repoWith({
      "pack.json": JSON.stringify({ name: "Notes", version: "1.0.0", author: "me", description: "" }),
      "server.ts": INJECT_SERVER_TS,
    });
    try {
      const installed = await t.fetch("/api/packs/install-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: dir }),
      });
      expect(installed.status).toBe(201);

      const blocks = collectExtensionInjections(t.ctx.db, 1);
      const note = blocks.find((block) => block.key === "Notes:note");
      expect(note?.content).toBe("[Extension note]");
      expect(note?.placement).toEqual({ kind: "depth", depth: 1 });
      expect(note?.role).toBe("system");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/* ------------------------------------------------------------------ */
/* Shipped extensions (SPEC §15, §20 phase 147)                       */
/* ------------------------------------------------------------------ */

describe("shipped extensions", () => {
  test("the shipped Summarize installs as an external extension, once", async () => {
    const t = await signedIn();
    await installShippedExtensions(t.ctx.db, t.config.extensionsDir);

    const row = t.ctx.db
      .query("SELECT name, built_in, enabled, dir FROM extensions WHERE name = 'Summarize'")
      .get() as { name: string; built_in: number; enabled: number; dir: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.built_in).toBe(0);
    expect(row!.enabled).toBe(1);
    expect(row!.dir).toContain("summarize");

    // The flag makes a re-run a no-op, so an uninstall would stick.
    await installShippedExtensions(t.ctx.db, t.config.extensionsDir);
    const count = t.ctx.db
      .query("SELECT COUNT(*) AS n FROM extensions WHERE name = 'Summarize'")
      .get() as { n: number };
    expect(count.n).toBe(1);
  });

  test("the shipped Summarize injects its summary and gates on the interval", async () => {
    const t = await signedIn();
    await installShippedExtensions(t.ctx.db, t.config.extensionsDir);
    await loadInstalledExtensions(t.ctx.db, t.config.extensionsDir);

    // A real scene, so `extension_state` has something to reference.
    const profiles = (await (await t.fetch("/api/connections/profiles")).json()) as Array<{ id: string }>;
    const created = (await (
      await t.fetch("/api/scenes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Ridge station", connectionProfileId: profiles[0]!.id }),
      })
    ).json()) as { id: string };
    const sceneId = (
      t.ctx.db.query("SELECT id FROM scenes WHERE ulid = $ulid").get({ ulid: created.id }) as { id: number }
    ).id;

    // As if a previous apply had written the running summary.
    writeExtensionState(t.ctx.db, "Summarize", sceneId, "summary", "They crossed the ridge.");
    const blocks = collectExtensionInjections(t.ctx.db, sceneId);
    const block = blocks.find((entry) => entry.key === "Summarize:summary");
    expect(block?.content).toBe("[Summary: They crossed the ridge.]");

    const task = postGenerationExtensionTasks().find((entry) => entry.task.key === "summarize")!.task;
    expect(task.shouldRun!({ db: t.ctx.db, sceneId, messageCount: 3 })).toBe(false);
    expect(task.shouldRun!({ db: t.ctx.db, sceneId, messageCount: 12 })).toBe(true);
  });

  test("the Summarize extension suppresses the native summarizer while enabled", async () => {
    const t = await signedIn();
    await installShippedExtensions(t.ctx.db, t.config.extensionsDir);
    await loadInstalledExtensions(t.ctx.db, t.config.extensionsDir);
    expect(isSummariseSuppressed(t.ctx.db)).toBe(true);

    // The summaries panel reports it, rather than showing inert native rows.
    const profiles = (await (await t.fetch("/api/connections/profiles")).json()) as Array<{ id: string }>;
    const created = (await (
      await t.fetch("/api/scenes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Ridge station", connectionProfileId: profiles[0]!.id }),
      })
    ).json()) as { id: string };
    const state = (await (await t.fetch(`/api/scenes/${created.id}/summaries`)).json()) as { suppressed: boolean };
    expect(state.suppressed).toBe(true);

    // Disabling it hands summarisation back to the native summarizer.
    const list = (await (await t.fetch("/api/extensions")).json()) as Array<{ id: string; name: string }>;
    const id = list.find((entry) => entry.name === "Summarize")!.id;
    const off = await t.fetch(`/api/extensions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(off.status).toBe(200);
    expect(isSummariseSuppressed(t.ctx.db)).toBe(false);

    const after = (await (await t.fetch(`/api/scenes/${created.id}/summaries`)).json()) as { suppressed: boolean };
    expect(after.suppressed).toBe(false);
  });
});
