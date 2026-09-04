import { afterEach, describe, expect, test } from "bun:test";
import { completeSetup, createHarness, type TestHarness } from "./helpers.ts";
import { V2_CARD, V2_CARD_SILENT, V3_CARD, charxCard, pngCard } from "./card-fixtures.ts";
import type {
  CharacterDto,
  ConnectionProfileDto,
  SceneDto,
  SceneWithHistoryDto,
} from "../shared/types.ts";

/**
 * A scene's opening message (SPEC §2, §9, §20 phase 43).
 *
 * Until this phase nothing but the demo seed ever turned a card's greeting into
 * a message, so every scene opened on an empty room and `group_greetings` was
 * parsed, stored, editable, exported and read by nothing.
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

async function importCharacter(t: TestHarness, bytes: Uint8Array, filename: string) {
  const form = new FormData();
  form.append("file", new File([bytes as unknown as BlobPart], filename));
  const body = (await (
    await t.fetch("/api/characters/import", { method: "POST", body: form })
  ).json()) as { character: CharacterDto };
  return body.character;
}

async function emptyScene(t: TestHarness): Promise<string> {
  const profiles = await json<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
  const created = await json<SceneDto>(t, "POST", "/api/scenes", {
    title: "Ridge station",
    connectionProfileId: profiles[0]!.id,
  });
  return created.id;
}

const history = (t: TestHarness, sceneId: string) =>
  json<SceneWithHistoryDto>(t, "GET", `/api/scenes/${sceneId}`);

describe("a scene opens on its first cast member's greeting", () => {
  test("casting one character writes the card's first message", async () => {
    const t = await signedIn();
    const bell = await importCharacter(t, pngCard({ chara: V2_CARD }), "bell.png");
    const sceneId = await emptyScene(t);

    const before = await history(t, sceneId);
    expect(before.messages).toEqual([]);

    await json<SceneDto>(t, "PUT", `/api/scenes/${sceneId}/cast/${bell.id}`);

    const after = await history(t, sceneId);
    expect(after.messages).toHaveLength(1);
    expect(after.messages[0]!.content).toBe(V2_CARD.data.first_mes);
    expect(after.messages[0]!.speakerName).toBe("Sister Bell");
    expect(after.messages[0]!.parentId).toBeNull();
  });

  test("the alternates arrive as root siblings, a swipe away", async () => {
    // SPEC §2: "alternate greetings are root siblings, parent_id IS NULL",
    // which is why sibling queries treat a null parent as a group. The reader
    // gets the alternates on the control they already know, and this needs no
    // UI of its own.
    const t = await signedIn();
    const bell = await importCharacter(t, pngCard({ chara: V2_CARD }), "bell.png");
    const sceneId = await emptyScene(t);
    await json<SceneDto>(t, "PUT", `/api/scenes/${sceneId}/cast/${bell.id}`);

    const opening = (await history(t, sceneId)).messages[0]!;
    // One first message plus the card's two alternates.
    expect(opening.siblingCount).toBe(3);
    expect(opening.siblingIndex).toBe(0);

    const siblings = await json<{ content: string }[]>(
      t,
      "GET",
      `/api/scenes/${sceneId}/messages/${opening.id}/siblings`,
    );
    expect(siblings.map((sibling) => sibling.content)).toEqual([
      V2_CARD.data.first_mes,
      ...V2_CARD.data.alternate_greetings,
    ]);
  });

  test("a character with nothing to say leaves the scene empty", async () => {
    const t = await signedIn();
    const bell = await importCharacter(t, pngCard({ chara: V2_CARD_SILENT }), "silent.png");
    const sceneId = await emptyScene(t);
    await json<SceneDto>(t, "PUT", `/api/scenes/${sceneId}/cast/${bell.id}`);

    expect((await history(t, sceneId)).messages).toEqual([]);
  });

  test("a second character added later does not inject another opening", async () => {
    const t = await signedIn();
    const bell = await importCharacter(t, pngCard({ chara: V2_CARD }), "bell.png");
    const mira = await importCharacter(
      t,
      charxCard({ ...V2_CARD, data: { ...V2_CARD.data, name: "Mira Vance" } }),
      "mira.charx",
    );
    const sceneId = await emptyScene(t);

    await json<SceneDto>(t, "PUT", `/api/scenes/${sceneId}/cast/${bell.id}`);
    const opened = (await history(t, sceneId)).messages;
    await json<SceneDto>(t, "PUT", `/api/scenes/${sceneId}/cast/${mira.id}`);

    expect((await history(t, sceneId)).messages).toEqual(opened);
  });

  test("only the first cast member opens, even when they have no greeting", async () => {
    // Otherwise "who opens" would depend on which cards happen to carry a
    // greeting, which is not something the cast list tells the reader.
    const t = await signedIn();
    const silent = await importCharacter(t, pngCard({ chara: V2_CARD_SILENT }), "silent.png");
    const bell = await importCharacter(
      t,
      charxCard({ ...V2_CARD, data: { ...V2_CARD.data, name: "Mira Vance" } }),
      "mira.charx",
    );
    const sceneId = await emptyScene(t);

    await json<SceneDto>(t, "PUT", `/api/scenes/${sceneId}/cast/${silent.id}`);
    await json<SceneDto>(t, "PUT", `/api/scenes/${sceneId}/cast/${bell.id}`);

    expect((await history(t, sceneId)).messages).toEqual([]);
  });
});

describe("group greetings (SPEC §2)", () => {
  test("a group scene opens on the group greeting", async () => {
    const t = await signedIn();
    const bell = await importCharacter(t, charxCard(V3_CARD), "bell.charx");
    const mira = await importCharacter(
      t,
      charxCard({ ...V3_CARD, data: { ...V3_CARD.data, name: "Mira Vance" } }),
      "mira.charx",
    );
    const sceneId = await emptyScene(t);

    // Both at once, so the scene is a group at the moment it opens.
    await json<SceneDto>(t, "POST", `/api/scenes/${sceneId}/cast`, {
      characterIds: [bell.id, mira.id],
    });

    const messages = (await history(t, sceneId)).messages;
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toBe(V3_CARD.data.group_only_greetings[0]!);
  });

  test("the same character alone opens on their own first message", async () => {
    const t = await signedIn();
    const bell = await importCharacter(t, charxCard(V3_CARD), "bell.charx");
    const sceneId = await emptyScene(t);
    await json<SceneDto>(t, "PUT", `/api/scenes/${sceneId}/cast/${bell.id}`);

    expect((await history(t, sceneId)).messages[0]!.content).toBe(V3_CARD.data.first_mes);
  });
});
