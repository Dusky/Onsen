import { afterEach, describe, expect, test } from "bun:test";
import { ScriptedAdapter, completeSetup, createHarness, type TestHarness } from "./helpers.ts";
import type { SceneDto, SceneStatsDto } from "../shared/types.ts";

/**
 * A scene rolled up (SPEC §16, §20 phase 128).
 *
 * The per-message gutter shows what one turn cost; the stats sheet rolls the
 * scene up — messages, words, and who has carried it. This pins the endpoint's
 * shape and that it counts only visible messages.
 */

let harness: TestHarness | null = null;
let adapter: ScriptedAdapter;

async function signedIn(): Promise<TestHarness> {
  if (harness === null) {
    adapter = new ScriptedAdapter();
    harness = createHarness({ adapter });
    await completeSetup(harness);
  }
  return harness;
}

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

async function json<T>(t: TestHarness, method: string, path: string, body?: unknown): Promise<T> {
  const response = await t.fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  return (await response.json()) as T;
}

describe("scene stats", () => {
  test("rolls the scene up, and a missing scene is a 404", async () => {
    const t = await signedIn();
    const profiles = await json<{ id: string }[]>(t, "GET", "/api/connections/profiles");
    const scene = await json<SceneDto>(t, "POST", "/api/scenes", {
      title: "Ridge station",
      connectionProfileId: profiles[0]!.id,
    });
    await json(t, "POST", `/api/scenes/${scene.id}/messages`, {
      kind: "user",
      authorType: "user",
      content: "Has anyone counted the lamp oil?",
    });

    const stats = await json<SceneStatsDto>(t, "GET", `/api/scenes/${scene.id}/stats`);
    expect(stats.messages).toBe(1);
    expect(stats.userMessages).toBe(1);
    expect(stats.aiMessages).toBe(0);
    expect(stats.words).toBe(6);

    const missing = await t.fetch("/api/scenes/nope/stats");
    expect(missing.status).toBe(404);
  });
});
