import { afterEach, describe, expect, test } from "bun:test";
import { completeSetup, createHarness, type TestHarness } from "./helpers.ts";
import { V2_CARD, pngCard } from "./card-fixtures.ts";
import { presetIdFor } from "../server/generation/context.ts";
import { findScene } from "../server/db/queries/history.ts";
import { findCharacter } from "../server/db/queries/characters.ts";
import { findPresetByUlid } from "../server/db/queries/connections.ts";

/**
 * Per-character presets (SPEC §13, §20 phase 140).
 *
 * A character can pin the preset it answers with. Resolution: the scene's own
 * preset, then the spotlight character's pin, then the profile's, then the
 * default. This pins the order.
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

async function json<T>(t: TestHarness, method: string, path: string, body?: unknown): Promise<T> {
  const response = await t.fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  return (await response.json()) as T;
}

describe("per-character presets", () => {
  test("a scene with no preset uses the spotlight character's pin", async () => {
    const t = await signedIn();

    const preset = await json<{ id: string }>(t, "POST", "/api/connections/presets", { name: "Chaotic" });
    const form = new FormData();
    form.append("file", new File([pngCard({ chara: V2_CARD }) as unknown as BlobPart], "bell.png"));
    const { character } = (await (
      await t.fetch("/api/characters/import", { method: "POST", body: form })
    ).json()) as { character: { id: string } };
    await json(t, "PATCH", `/api/characters/${character.id}`, { presetId: preset.id });

    const profiles = await json<{ id: string }[]>(t, "GET", "/api/connections/profiles");
    const scene = await json<{ id: string }>(t, "POST", "/api/scenes", {
      title: "The pass",
      connectionProfileId: profiles[0]!.id,
    });
    await json(t, "PUT", `/api/scenes/${scene.id}/cast/${character.id}`);

    const sceneRow = findScene(t.ctx.db, scene.id)!;
    const charRow = findCharacter(t.ctx.db, character.id)!;
    const presetRow = findPresetByUlid(t.ctx.db, preset.id)!;

    // The character's pin wins when nothing else is set.
    expect(presetIdFor(t.ctx.db, sceneRow, null, charRow.id)).toBe(presetRow.id);
    // Without the character, it falls back to the default, which is not this.
    expect(presetIdFor(t.ctx.db, sceneRow, null, null)).not.toBe(presetRow.id);
    // The scene's own preset beats the character's pin.
    expect(presetIdFor(t.ctx.db, { ...sceneRow, preset_id: 1 } as typeof sceneRow, null, charRow.id)).toBe(1);
  });
});
