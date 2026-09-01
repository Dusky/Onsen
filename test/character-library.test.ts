import { afterEach, describe, expect, test } from "bun:test";
import { ScriptedAdapter, completeSetup, createHarness, type TestHarness } from "./helpers.ts";
import { charxCard, jsonBytes, pngCard, V1_CARD, V2_CARD } from "./card-fixtures.ts";
import type {
  CharacterDto,
  CharacterSnapshotDto,
  CharacterVersionDto,
  SavedFilterDto,
} from "../shared/types.ts";

/**
 * The character library at scale (SPEC §9, §20 phase 26).
 *
 * Each test arranges a small library and reads it back the way a user with a
 * large one would: by search, by tag, by folder, by saved filter — and, where
 * the history matters, by the version a save left behind.
 */

let harness: TestHarness | null = null;
let adapter: ScriptedAdapter;

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

async function statusOf(t: TestHarness, method: string, path: string, body?: unknown) {
  const response = await t.fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  return response.status;
}

async function signedIn(): Promise<TestHarness> {
  harness = createHarness({ adapter: (adapter = new ScriptedAdapter()) });
  await completeSetup(harness);
  return harness;
}

/** Import a card from its bytes. */
async function importCard(t: TestHarness, bytes: Uint8Array, filename: string): Promise<CharacterDto> {
  const form = new FormData();
  form.append("file", new File([bytes as unknown as BlobPart], filename));
  const body = (await (
    await t.fetch("/api/characters/import", { method: "POST", body: form })
  ).json()) as { character: CharacterDto };
  return body.character;
}

/** Bell (ridge station) and Aldan (the black water), as a two-card library. */
async function library(t: TestHarness) {
  const bell = await importCard(t, pngCard({ chara: V2_CARD }), "bell.png");
  const aldan = await importCard(
    t,
    charxCard({
      ...V2_CARD,
      data: {
        ...V2_CARD.data,
        name: "Aldan Marsh",
        description: "Aldan ferries the black water between the lighthouses.",
        personality: "Taciturn, patient, kind with the drowned.",
        creator_notes: "A ferryman who never sleeps.",
      },
    }),
    "aldan.charx",
  );
  return { bell, aldan };
}

describe("the library at scale (SPEC §9)", () => {
  test("searches across name, description and creator notes", async () => {
    const t = await signedIn();
    await library(t);

    // A word only in Aldan's description.
    const byDescription = await json<CharacterDto[]>(t, "GET", "/api/characters?q=ferries");
    expect(byDescription.map((c) => c.name)).toEqual(["Aldan Marsh"]);

    // A word only in Aldan's creator notes.
    const byNotes = await json<CharacterDto[]>(t, "GET", "/api/characters?q=ferryman");
    expect(byNotes.map((c) => c.name)).toEqual(["Aldan Marsh"]);

    // A word in Bell's description matches Bell.
    const byStation = await json<CharacterDto[]>(t, "GET", "/api/characters?q=ridge");
    expect(byStation.map((c) => c.name)).toEqual(["Sister Bell"]);

    // A name fragment.
    const byName = await json<CharacterDto[]>(t, "GET", "/api/characters?q=aldan");
    expect(byName.map((c) => c.name)).toEqual(["Aldan Marsh"]);
  });

  test("filters by tag and folder, and exposes the vocabulary", async () => {
    const t = await signedIn();
    const { bell, aldan } = await library(t);

    await json(t, "POST", "/api/characters/bulk", {
      ids: [bell.id],
      op: "tag",
      tag: "station",
    });
    await json(t, "POST", "/api/characters/bulk", {
      ids: [aldan.id],
      op: "tag",
      tag: "water",
    });
    await json(t, "POST", "/api/characters/bulk", { ids: [aldan.id], op: "move", folder: "Side cast" });

    const tagged = await json<CharacterDto[]>(t, "GET", "/api/characters?tag=water");
    expect(tagged.map((c) => c.name)).toEqual(["Aldan Marsh"]);

    const foldered = await json<CharacterDto[]>(t, "GET", "/api/characters?folder=Side%20cast");
    expect(foldered.map((c) => c.name)).toEqual(["Aldan Marsh"]);

    const tags = await json<string[]>(t, "GET", "/api/characters/tags");
    expect(tags).toContain("station");
    expect(tags).toContain("water");

    const folders = await json<string[]>(t, "GET", "/api/characters/folders");
    expect(folders).toEqual(["Side cast"]);
  });

  test("bulk untag and delete touch the whole selection", async () => {
    const t = await signedIn();
    const { bell, aldan } = await library(t);
    await json(t, "POST", "/api/characters/bulk", {
      ids: [bell.id, aldan.id],
      op: "tag",
      tag: "keep",
    });
    await json(t, "POST", "/api/characters/bulk", {
      ids: [bell.id],
      op: "untag",
      tag: "keep",
    });

    const stillTagged = await json<CharacterDto[]>(t, "GET", "/api/characters?tag=keep");
    expect(stillTagged.map((c) => c.name)).toEqual(["Aldan Marsh"]);

    const result = await json<{ deleted: number }>(t, "POST", "/api/characters/bulk", {
      ids: [bell.id],
      op: "delete",
    });
    expect(result.deleted).toBe(1);
    const remaining = await json<CharacterDto[]>(t, "GET", "/api/characters");
    expect(remaining.map((c) => c.name)).toEqual(["Aldan Marsh"]);
  });

  test("a save leaves a version, and restore takes it back", async () => {
    const t = await signedIn();
    const { bell } = await library(t);

    // The baseline snapshot exists from import.
    const before = await json<CharacterVersionDto[]>(t, "GET", `/api/characters/${bell.id}/versions`);
    expect(before.length).toBe(1);
    expect(before[0]!.name).toBe("Sister Bell");

    await json(t, "PATCH", `/api/characters/${bell.id}`, { description: "Rewritten completely." });

    const after = await json<CharacterVersionDto[]>(t, "GET", `/api/characters/${bell.id}/versions`);
    expect(after.length).toBe(2);
    // Newest first: the pre-edit snapshot still carries the old description.
    const snapshot = await json<CharacterSnapshotDto>(
      t,
      "GET",
      `/api/characters/${bell.id}/versions/${after[0]!.id}`,
    );
    expect(snapshot.character.description).toBe("Bell keeps the ridge station running.");

    const restored = await json<CharacterDto>(
      t,
      "POST",
      `/api/characters/${bell.id}/versions/${before[0]!.id}/restore`,
    );
    expect(restored.description).toBe("Bell keeps the ridge station running.");
    // Restoring is itself a save, so it leaves the rewritten state behind it.
    const now = await json<CharacterVersionDto[]>(t, "GET", `/api/characters/${bell.id}/versions`);
    expect(now.length).toBe(3);
  });

  test("deriving a variant links back and edits independently", async () => {
    const t = await signedIn();
    const { bell } = await library(t);

    const variant = await json<CharacterDto>(t, "POST", `/api/characters/${bell.id}/derive`, {
      name: "Sister Bell, AU",
    });
    expect(variant.parentId).toBe(bell.id);
    expect(variant.name).toBe("Sister Bell, AU");

    await json(t, "PATCH", `/api/characters/${variant.id}`, { description: "A different Bell." });
    const original = await json<CharacterDto>(t, "GET", `/api/characters/${bell.id}`);
    expect(original.description).toBe("Bell keeps the ridge station running.");
  });

  test("saved filters round-trip and delete", async () => {
    const t = await signedIn();
    await library(t);

    const created = await json<SavedFilterDto>(t, "POST", "/api/filters", {
      name: "my sci-fi cast",
      query: { tag: "water" },
    });
    expect(created.query.tag).toBe("water");

    const listed = await json<SavedFilterDto[]>(t, "GET", "/api/filters");
    expect(listed.map((f) => f.name)).toContain("my sci-fi cast");

    expect(await statusOf(t, "DELETE", `/api/filters/${created.id}`)).toBe(204);
    const after = await json<SavedFilterDto[]>(t, "GET", "/api/filters");
    expect(after).toEqual([]);
  });

  test("a scene takes several cast members at once", async () => {
    const t = await signedIn();
    const { bell, aldan } = await library(t);
    const scene = await json<CharacterDto>(t, "POST", "/api/scenes", { title: "Two of them" });

    const patched = await json<{ cast: { characterId: string }[] }>(
      t,
      "POST",
      `/api/scenes/${scene.id}/cast`,
      { characterIds: [bell.id, aldan.id] },
    );
    expect(patched.cast.map((member) => member.characterId).sort()).toEqual(
      [bell.id, aldan.id].sort(),
    );
  });

  test("tag suggestions come from the library's own vocabulary", async () => {
    const t = await signedIn();
    const { bell, aldan } = await library(t);
    await json(t, "POST", "/api/characters/bulk", {
      ids: [bell.id, aldan.id],
      op: "tag",
      tag: "station",
    });

    // The model offers a mix of on- and off-vocabulary tags; only the former
    // survive, because a library that speaks many vocabularies is the problem.
    adapter.taskReplyFor = (prompt) =>
      prompt.debug.blocks[0]?.label === "Suggest tags" ? "station, ghost, NEW-COINED" : null;

    const { tags } = await json<{ tags: string[] }>(
      t,
      "POST",
      `/api/characters/${bell.id}/suggest-tags`,
    );
    expect(tags).toContain("station");
    expect(tags).not.toContain("NEW-COINED");
  });

  test("a failing tag suggestion is a failed request, not a wrong answer", async () => {
    const t = await signedIn();
    const { bell } = await library(t);
    adapter.taskFails = true;
    expect(await statusOf(t, "POST", `/api/characters/${bell.id}/suggest-tags`)).toBe(502);
  });
});
