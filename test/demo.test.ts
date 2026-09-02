import { afterEach, describe, expect, test } from "bun:test";
import { completeSetup, createHarness, type TestHarness } from "./helpers.ts";
import type { CharacterDto, DocumentDto, SceneDto, SceneWithHistoryDto } from "../shared/types.ts";

/**
 * The demo seed (first run): a cast, a scene, and the author's own user guide
 * in the data bank. Idempotent by name, so running it twice finds what it made.
 */

let harness: TestHarness | null = null;

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

async function signedIn(): Promise<TestHarness> {
  harness = createHarness();
  await completeSetup(harness);
  return harness;
}

describe("the demo seed", () => {
  test("creates a cast, a scene, and the guide — once", async () => {
    const t = await signedIn();

    const first = await json<{ sceneId: string; charactersCreated: number; guideAdded: boolean }>(
      t,
      "POST",
      "/api/demo/seed",
    );
    expect(first.charactersCreated).toBe(3);
    expect(first.guideAdded).toBe(true);
    expect(first.sceneId).toBeTruthy();

    const characters = await json<CharacterDto[]>(t, "GET", "/api/characters");
    expect(characters.map((character) => character.name)).toEqual(
      expect.arrayContaining(["Elira Voss", "Dusky", "The Warden"]),
    );

    const scene = await json<SceneWithHistoryDto>(t, "GET", `/api/scenes/${first.sceneId}`);
    expect(scene.scene.title).toBe("The Last Inn");
    expect(scene.scene.cast.length).toBe(3);
    expect(scene.messages.length).toBeGreaterThan(0);

    const documents = await json<DocumentDto[]>(t, "GET", "/api/documents");
    expect(documents.map((document) => document.title)).toContain("Onsen guide");

    // Idempotent: nothing is made twice, the scene is the same one.
    const again = await json<{ sceneId: string; charactersCreated: number; guideAdded: boolean }>(
      t,
      "POST",
      "/api/demo/seed",
    );
    expect(again.charactersCreated).toBe(0);
    expect(again.guideAdded).toBe(false);
    expect(again.sceneId).toBe(first.sceneId);
  });
});
