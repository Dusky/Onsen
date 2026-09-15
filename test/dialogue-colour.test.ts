import { afterEach, describe, expect, test } from "bun:test";
import { ScriptedAdapter, completeSetup, createHarness, type TestHarness } from "./helpers.ts";
import { charxCard, pngCard, V2_CARD } from "./card-fixtures.ts";
import { buildPrompt } from "../server/prompt/index.ts";
import { character, context, flatten } from "./prompt-fixtures.ts";
import type { CharacterDto } from "../shared/types.ts";

/**
 * Colour is a client-side fact, not a prompt instruction (phase 185, revisited).
 *
 * Phase 185 asked the model to wrap spoken lines in the character's colour.
 * That made the prompt bigger, gave the model another way to leak raw tags, and
 * was redundant: the client already colours the speaker's name, spine and each
 * beat part's label from the cast's colours. So the instruction is gone — and
 * the one gap it was papering over, a cast with no colours at all, is now
 * closed at the source: a colourless character joining a scene takes the first
 * palette colour nobody else in that scene is using.
 */

let harness: TestHarness | null = null;

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

describe("colour no longer lives in the prompt", () => {
  test("a coloured cast gets no span instruction", () => {
    const bell = character("bell", "Bell", { colour: "#ff0000" });
    const mira = character("mira", "Mira", { colour: "#00aaff" });
    const text = flatten(buildPrompt(context({ cast: [bell, mira], spotlight: bell })));

    expect(text).not.toContain("Colour spoken dialogue");
    expect(text).not.toContain("spoken dialogue</span>");
  });
});

describe("a colourless cast is told apart automatically", () => {
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
    harness = createHarness({ adapter: new ScriptedAdapter() });
    await completeSetup(harness);
    return harness;
  }

  async function importCard(
    t: TestHarness,
    bytes: Uint8Array,
    filename: string,
  ): Promise<CharacterDto> {
    const form = new FormData();
    form.append("file", new File([bytes as unknown as BlobPart], filename));
    const body = (await (
      await t.fetch("/api/characters/import", { method: "POST", body: form })
    ).json()) as { character: CharacterDto };
    return body.character;
  }

  test("joining a scene assigns a distinct palette colour", async () => {
    const t = await signedIn();

    const bell = await importCard(t, pngCard({ chara: V2_CARD }), "bell.png");
    const aldan = await importCard(
      t,
      charxCard({
        ...V2_CARD,
        data: {
          ...V2_CARD.data,
          name: "Aldan Marsh",
          description: "Aldan ferries the black water between the lighthouses.",
        },
      }),
      "aldan.charx",
    );

    // Both start colourless — the exact state that left a whole cast grey.
    expect(bell.colour).toBeNull();
    expect(aldan.colour).toBeNull();

    const scene = await json<{ id: string }>(t, "POST", "/api/scenes", { title: "Two of them" });
    await json(t, "POST", `/api/scenes/${scene.id}/cast`, {
      characterIds: [bell.id, aldan.id],
    });

    const bellNow = await json<CharacterDto>(t, "GET", `/api/characters/${bell.id}`);
    const aldanNow = await json<CharacterDto>(t, "GET", `/api/characters/${aldan.id}`);
    expect(bellNow.colour).toMatch(/^#[0-9a-f]{6}$/i);
    expect(aldanNow.colour).toMatch(/^#[0-9a-f]{6}$/i);
    expect(bellNow.colour).not.toBe(aldanNow.colour);
  });

  test("a character who already has a colour keeps it", async () => {
    const t = await signedIn();

    const bell = await importCard(t, pngCard({ chara: V2_CARD }), "bell.png");
    const patched = await json<CharacterDto>(t, "PATCH", `/api/characters/${bell.id}`, {
      colour: "#123456",
    });
    expect(patched.colour).toBe("#123456");

    const scene = await json<{ id: string }>(t, "POST", "/api/scenes", { title: "One" });
    await json(t, "POST", `/api/scenes/${scene.id}/cast`, { characterIds: [bell.id] });

    const after = await json<CharacterDto>(t, "GET", `/api/characters/${bell.id}`);
    expect(after.colour).toBe("#123456");
  });
});
