import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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
});
