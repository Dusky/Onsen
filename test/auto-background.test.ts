import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { completeSetup, createHarness, type TestHarness } from "./helpers.ts";
import { taskKind, BACKGROUND_DETECT } from "../server/tasks/registry.ts";
import type { SceneDto, SceneWithHistoryDto } from "../shared/types.ts";

/**
 * Automatic background generation (AutoBackground, ported — §20 phase 103).
 *
 * After each AI reply, when enabled, a detection call decides whether the scene
 * moved and draws a background. This pins the registry entry, the schema and
 * the settings round-trip.
 */

const MIGRATION = readFileSync(
  join(import.meta.dir, "..", "server", "db", "migrations", "0052_auto_background.sql"),
  "utf8",
);
const SCREEN = readFileSync(
  join(import.meta.dir, "..", "client", "screens", "SceneSetupScreen.tsx"),
  "utf8",
);

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
});

async function json<T>(
  t: TestHarness,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const response = await t.fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const parsed = response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  return { status: response.status, body: parsed };
}

describe("auto background", () => {
  test("the scene carries the four knobs", () => {
    expect(MIGRATION).toContain("auto_background_enabled");
    expect(MIGRATION).toContain("auto_background_cooldown");
    expect(MIGRATION).toContain("auto_background_min_messages");
    expect(MIGRATION).toContain("auto_background_prompt");
  });

  test("the setup screen exposes them", () => {
    expect(SCREEN).toContain("autoBackgroundEnabled");
    expect(SCREEN).toContain("autoBackgroundCooldown");
    expect(SCREEN).toContain("autoBackgroundMinMessages");
    expect(SCREEN).toContain("autoBackgroundPrompt");
  });

  test("the detection is a registered side call", () => {
    const kind = taskKind(BACKGROUND_DETECT);
    expect(kind).not.toBeNull();
    expect(kind!.runs).toBe("side_call");
  });

  test("the settings round-trip through the scene", async () => {
    const t = await signedIn();
    const scene = await json<SceneDto>(t, "POST", "/api/scenes", { title: "The lodge" });

    const patched = await json<SceneDto>(t, "PATCH", `/api/scenes/${scene.body.id}`, {
      autoBackgroundEnabled: true,
      autoBackgroundCooldown: 300,
      autoBackgroundMinMessages: 6,
      autoBackgroundPrompt: "Moved? {{text}} YES/NO",
    });
    expect(patched.status).toBe(200);
    expect(patched.body.autoBackgroundEnabled).toBe(true);
    expect(patched.body.autoBackgroundCooldown).toBe(300);
    expect(patched.body.autoBackgroundMinMessages).toBe(6);
    expect(patched.body.autoBackgroundPrompt).toBe("Moved? {{text}} YES/NO");

    const read = await json<SceneWithHistoryDto>(t, "GET", `/api/scenes/${scene.body.id}`);
    expect(read.body.scene.autoBackgroundEnabled).toBe(true);
    expect(read.body.scene.autoBackgroundCooldown).toBe(300);
  });
});
