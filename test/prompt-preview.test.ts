import { afterEach, describe, expect, test } from "bun:test";
import { completeSetup, createHarness, type TestHarness } from "./helpers.ts";
import type { CharacterDto, PromptPreviewDto, SceneDto } from "../shared/types.ts";

/**
 * The next-turn prompt preview (SPEC §16, §20 phase 68).
 *
 * The inspector looks back at a prompt behind a message; this looks forward.
 * It must assemble the same context a generation would — same route
 * resolution, same builder — and write nothing: a preview that left a
 * generation row behind would be a side effect wearing a read-only name.
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
});

async function send<T>(
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

async function sceneWith(
  t: TestHarness,
  names: string[],
): Promise<{ scene: SceneDto; characters: CharacterDto[] }> {
  const profiles = await send<{ id: string; isDefault?: boolean }[]>(t, "GET", "/api/connections/profiles");
  const profileId = profiles.body.find((p) => p.isDefault)?.id ?? profiles.body[0]!.id;
  const scene = (await send<SceneDto>(t, "POST", "/api/scenes", {
    title: "Preview",
    connectionProfileId: profileId,
  })).body;
  const characters: CharacterDto[] = [];
  for (const name of names) {
    const character = (await send<CharacterDto>(t, "POST", "/api/characters", { name })).body;
    await send(t, "PUT", `/api/scenes/${scene.id}/cast/${character.id}`);
    characters.push(character);
  }
  return { scene, characters };
}

describe("the next-turn preview", () => {
  test("returns the assembled prompt without generating", async () => {
    const t = await signedIn();
    const { scene } = await sceneWith(t, ["Sister Bell"]);

    const result = await send<PromptPreviewDto>(t, "POST", `/api/scenes/${scene.id}/preview`, {});
    expect(result.status).toBe(200);
    expect(result.body.debug.blocks.length).toBeGreaterThan(3);
    expect(result.body.debug.totalTokens).toBeGreaterThan(0);

    // A preview is a read: no generation row, no message.
    const gens = t.ctx.db.query("SELECT COUNT(*) AS n FROM generations").get() as { n: number };
    expect(gens.n).toBe(0);
    const messages = t.ctx.db.query("SELECT COUNT(*) AS n FROM messages").get() as { n: number };
    expect(messages.n).toBe(0);
  });

  test("a cued character reaches the spotlight", async () => {
    const t = await signedIn();
    const { scene, characters } = await sceneWith(t, ["Sister Bell", "The Cartwright"]);
    const bell = characters[0]!;

    const result = await send<PromptPreviewDto>(t, "POST", `/api/scenes/${scene.id}/preview`, {
      characterId: bell.id,
    });
    const spotlight = result.body.debug.blocks.find((block) => block.id === "spotlight_character");
    expect(spotlight?.content).toContain("Sister Bell");
  });

  test("a beat degrades to a spotlight when the cast cannot hold one", async () => {
    const t = await signedIn();
    const { scene } = await sceneWith(t, ["Sister Bell"]);

    const result = await send<PromptPreviewDto>(t, "POST", `/api/scenes/${scene.id}/preview`, {
      scope: "beat",
    });
    expect(result.status).toBe(200);
    // A one-member cast cannot stage an exchange, so it is still a spotlight.
    expect(result.body.debug.blocks.some((block) => block.id === "spotlight_character")).toBe(true);
  });

  test("no connection is refused rather than invented", async () => {
    const t = await signedIn();
    // A scene created without a profile has nowhere to generate.
    const scene = (await send<SceneDto>(t, "POST", "/api/scenes", { title: "Nowhere" })).body;
    const character = (await send<CharacterDto>(t, "POST", "/api/characters", { name: "Bell" })).body;
    await send(t, "PUT", `/api/scenes/${scene.id}/cast/${character.id}`);

    const result = await send(t, "POST", `/api/scenes/${scene.id}/preview`, {});
    expect(result.status).toBe(400);
  });
});
