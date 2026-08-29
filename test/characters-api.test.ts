import { afterEach, describe, expect, test } from "bun:test";
import { completeSetup, createHarness, type TestHarness } from "./helpers.ts";
import { V1_CARD, V2_CARD, V3_CARD, charxCard, jsonBytes, pngCard } from "./card-fixtures.ts";
import { importCard } from "../server/cards/index.ts";
import { readTextChunks } from "../server/cards/png.ts";
import type { CharacterDto, ImportCharacterResponse } from "../shared/types.ts";

/**
 * The character library over HTTP (SPEC §9). The point of these is the same as
 * the unit tests': nothing is lost between the file the user had and the file
 * they get back.
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

async function upload(
  t: TestHarness,
  bytes: Uint8Array,
  filename: string,
): Promise<{ status: number; body: ImportCharacterResponse }> {
  const form = new FormData();
  form.append("file", new File([bytes as unknown as BlobPart], filename));
  const response = await t.fetch("/api/characters/import", { method: "POST", body: form });
  return { status: response.status, body: (await response.json()) as ImportCharacterResponse };
}

describe("importing", () => {
  test("accepts a PNG card and reports what it preserved", async () => {
    const t = await signedIn();
    const { status, body } = await upload(t, pngCard({ ccv3: V3_CARD }), "bell.png");

    expect(status).toBe(201);
    expect(body.character.name).toBe("Sister Bell");
    expect(body.character.format).toBe("png_v3");
    expect(body.character.hasAvatar).toBe(true);
    expect(body.character.alternateGreetings).toHaveLength(2);
    expect(body.character.depthPrompt).toBe("Bell has not slept in two days.");

    // Naming what is preserved but hidden is the difference between an import
    // being partial and being silently partial (SPEC §18).
    expect(body.warnings.join(" ")).toContain("lorebook");
    expect(body.warnings.join(" ")).toContain("future_top_level_field");
    expect(body.character.unmodelledFields).toContain("extensions.risuai");
  });

  test("accepts CharX and raw JSON too", async () => {
    const t = await signedIn();
    expect((await upload(t, charxCard(V2_CARD), "bell.charx")).body.character.format).toBe("charx");
    expect((await upload(t, jsonBytes(V1_CARD), "aldan.json")).body.character.format).toBe("json");
  });

  test("recognises a re-import instead of duplicating the character", async () => {
    const t = await signedIn();
    const bytes = pngCard({ chara: V2_CARD });

    const first = await upload(t, bytes, "bell.png");
    const second = await upload(t, bytes, "bell-copy.png");

    expect(second.status).toBe(200);
    expect(second.body.duplicateOf).toBe(first.body.character.id);
    expect(second.body.character.id).toBe(first.body.character.id);

    const list = (await (await t.fetch("/api/characters")).json()) as CharacterDto[];
    expect(list).toHaveLength(1);
  });

  test("stores the card verbatim, not just the fields it understood", async () => {
    const t = await signedIn();
    const { body } = await upload(t, pngCard({ ccv3: V3_CARD }), "bell.png");

    const stored = t.ctx.db
      .query("SELECT raw_card FROM characters WHERE ulid = $ulid")
      .get({ ulid: body.character.id }) as { raw_card: string };
    const parsed = JSON.parse(stored.raw_card);

    expect(parsed.data.character_book.entries[0].content).toBe("The road closed in the spring.");
    expect(parsed.data.extensions.risuai).toEqual({ customScriptV2: ["never", "touched"] });
    expect(parsed.data.future_top_level_field).toEqual({ anything: "at all" });
  });

  test("computes per-field token costs for the editor", async () => {
    const t = await signedIn();
    const { body } = await upload(t, pngCard({ chara: V2_CARD }), "bell.png");
    const tokens = body.character.tokens;

    expect(tokens.description).toBeGreaterThan(0);
    expect(tokens.personality).toBeGreaterThan(0);
    expect(tokens.total).toBeGreaterThanOrEqual(tokens.description + tokens.personality);
    // Only the estimator ships, so the number must say so (§3).
    expect(tokens.estimated).toBe(true);
  });

  test("refuses a plain image and a file that is not a card", async () => {
    const t = await signedIn();
    const notACard = await upload(t, new TextEncoder().encode("hello"), "notes.txt");
    expect(notACard.status).toBe(400);

    const noFile = await t.fetch("/api/characters/import", { method: "POST", body: new FormData() });
    expect(noFile.status).toBe(400);
  });

  test("needs a session", async () => {
    const t = await signedIn();
    t.cookie = null;
    expect((await t.fetch("/api/characters")).status).toBe(401);
  });
});

describe("editing", () => {
  test("an edit changes the field and recomputes its cost", async () => {
    const t = await signedIn();
    const { body } = await upload(t, pngCard({ chara: V2_CARD }), "bell.png");
    const before = body.character.tokens.description;

    const response = await t.fetch(`/api/characters/${body.character.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "A much longer description ".repeat(20) }),
    });
    const updated = (await response.json()) as CharacterDto;

    expect(updated.description).toContain("much longer");
    expect(updated.tokens.description).toBeGreaterThan(before);
  });

  test("voice notes are ours to add, not something a card carries", async () => {
    const t = await signedIn();
    const { body } = await upload(t, pngCard({ chara: V2_CARD }), "bell.png");
    expect(body.character.voiceNotes).toBeNull();

    const response = await t.fetch(`/api/characters/${body.character.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voiceNotes: "Short sentences. Never says goodbye." }),
    });
    expect(((await response.json()) as CharacterDto).voiceNotes).toContain("Never says goodbye");
  });

  test("rejects an empty name, an unknown role, and a non-numeric depth", async () => {
    const t = await signedIn();
    const { body } = await upload(t, pngCard({ chara: V2_CARD }), "bell.png");

    for (const patch of [
      { name: "  " },
      { depthPromptRole: "narrator" },
      { depthPromptDepth: "deep" },
    ]) {
      const response = await t.fetch(`/api/characters/${body.character.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      expect(response.status).toBe(400);
    }
  });

  test("creates an empty card to fill in by hand", async () => {
    const t = await signedIn();
    const response = await t.fetch("/api/characters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Tess" }),
    });
    const created = (await response.json()) as CharacterDto;

    expect(response.status).toBe(201);
    expect(created.name).toBe("Tess");
    expect(created.format).toBe("native");

    // Even a hand-authored card has an original: the document it exports as.
    const stored = t.ctx.db
      .query("SELECT raw_card FROM characters WHERE ulid = $ulid")
      .get({ ulid: created.id }) as { raw_card: string };
    expect(JSON.parse(stored.raw_card).data.name).toBe("Tess");
  });

  test("deletes, and 404s afterwards", async () => {
    const t = await signedIn();
    const { body } = await upload(t, pngCard({ chara: V2_CARD }), "bell.png");

    expect((await t.fetch(`/api/characters/${body.character.id}`, { method: "DELETE" })).status).toBe(
      204,
    );
    expect((await t.fetch(`/api/characters/${body.character.id}`)).status).toBe(404);
  });
});

describe("exporting", () => {
  test("round-trips through the API with the edit applied and the rest intact", async () => {
    const t = await signedIn();
    const { body } = await upload(t, pngCard({ ccv3: V3_CARD }), "bell.png");

    await t.fetch(`/api/characters/${body.character.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "Rewritten by the user." }),
    });

    const exported = await t.fetch(`/api/characters/${body.character.id}/export?format=png`);
    expect(exported.headers.get("content-type")).toBe("image/png");
    expect(exported.headers.get("content-disposition")).toContain("Sister Bell.png");

    const bytes = new Uint8Array(await exported.arrayBuffer());
    const reimported = importCard(bytes);

    expect(reimported.card.description).toBe("Rewritten by the user.");
    // Everything the app never modelled came back with it.
    const data = JSON.parse(reimported.rawCard).data;
    expect(data.extensions.risuai).toEqual({ customScriptV2: ["never", "touched"] });
    expect(data.character_book.name).toBe("Ridge lore");
    expect(data.future_top_level_field).toEqual({ anything: "at all" });
  });

  test("a PNG export carries both chunks", async () => {
    const t = await signedIn();
    const { body } = await upload(t, pngCard({ ccv3: V3_CARD }), "bell.png");
    const exported = await t.fetch(`/api/characters/${body.character.id}/export?format=png`);
    const chunks = readTextChunks(new Uint8Array(await exported.arrayBuffer()));
    expect(chunks.has("ccv3")).toBe(true);
    expect(chunks.has("chara")).toBe(true);
  });

  test("offers CharX and JSON as well, and refuses anything else", async () => {
    const t = await signedIn();
    const { body } = await upload(t, pngCard({ chara: V2_CARD }), "bell.png");

    const charx = await t.fetch(`/api/characters/${body.character.id}/export?format=charx`);
    expect(charx.headers.get("content-type")).toBe("application/zip");
    expect(importCard(new Uint8Array(await charx.arrayBuffer())).format).toBe("charx");

    const json = await t.fetch(`/api/characters/${body.character.id}/export?format=json`);
    expect(json.headers.get("content-type")).toBe("application/json");

    expect(
      (await t.fetch(`/api/characters/${body.character.id}/export?format=exe`)).status,
    ).toBe(400);
  });

  test("serves the avatar the card carried", async () => {
    const t = await signedIn();
    const { body } = await upload(t, pngCard({ chara: V2_CARD }), "bell.png");

    const avatar = await t.fetch(`/api/characters/${body.character.id}/avatar`);
    expect(avatar.status).toBe(200);
    expect(avatar.headers.get("content-type")).toContain("image/png");
    // Content-addressed, so it can be cached indefinitely.
    expect(avatar.headers.get("cache-control")).toContain("immutable");
  });

  test("404s for a character with no avatar", async () => {
    const t = await signedIn();
    const { body } = await upload(t, jsonBytes(V1_CARD), "aldan.json");
    expect(body.character.hasAvatar).toBe(false);
    expect((await t.fetch(`/api/characters/${body.character.id}/avatar`)).status).toBe(404);
  });
});
