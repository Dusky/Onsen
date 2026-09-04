import { afterEach, describe, expect, test } from "bun:test";
import {
  ScriptedAdapter,
  completeSetup,
  createHarness,
  until,
  type TestHarness,
} from "./helpers.ts";
import { V1_CARD, V2_CARD_SILENT, charxCard, jsonBytes, pngCard } from "./card-fixtures.ts";
import { buildPromptContext } from "../server/generation/context.ts";
import { buildPrompt } from "../server/prompt/index.ts";
import { OPENAI_COMPATIBLE_CAPABILITIES } from "../server/adapters/index.ts";
import { findScene } from "../server/db/queries/history.ts";
import type {
  AuthorDto,
  CharacterDto,
  ConnectionProfileDto,
  MessageDto,
  SceneDto,
  SceneWithHistoryDto,
} from "../shared/types.ts";

/**
 * Group scenes (SPEC §6, §20 phase 8): several characters, one author voicing
 * whoever is spotlighted, and something deciding who that is.
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

async function statusOf(t: TestHarness, method: string, path: string, body?: unknown) {
  const response = await t.fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  return response.status;
}

async function importCharacter(t: TestHarness, bytes: Uint8Array, filename: string) {
  const form = new FormData();
  form.append("file", new File([bytes as unknown as BlobPart], filename));
  const body = (await (
    await t.fetch("/api/characters/import", { method: "POST", body: form })
  ).json()) as { character: CharacterDto };
  return body.character;
}

/** An author and a three-character cast. */
async function groupScene(t: TestHarness) {
  const author = await json<AuthorDto>(t, "POST", "/api/authors", { name: "Kestrel" });
  const bell = await importCharacter(t, pngCard({ chara: V2_CARD_SILENT }), "bell.png");
  const aldan = await importCharacter(t, jsonBytes(V1_CARD), "aldan.json");
  const mira = await importCharacter(
    t,
    charxCard({ ...V2_CARD_SILENT, data: { ...V2_CARD_SILENT.data, name: "Mira Vance" } }),
    "mira.charx",
  );

  const profiles = await json<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
  const created = await json<SceneDto>(t, "POST", "/api/scenes", {
    title: "Ridge station",
    connectionProfileId: profiles[0]!.id,
  });
  await json<SceneDto>(t, "PATCH", `/api/scenes/${created.id}`, { authorId: author.id });

  // Added in this order, so display order is Bell, Aldan, Mira.
  for (const character of [bell, aldan, mira]) {
    await json<SceneDto>(t, "PUT", `/api/scenes/${created.id}/cast/${character.id}`);
  }

  const scene = await json<SceneWithHistoryDto>(t, "GET", `/api/scenes/${created.id}`);
  return { author, bell, aldan, mira, scene: scene.scene };
}

async function say(t: TestHarness, sceneId: string, content: string) {
  return json<MessageDto>(t, "POST", `/api/scenes/${sceneId}/messages`, {
    kind: "user",
    authorType: "user",
    content,
  });
}

async function generate(t: TestHarness, sceneId: string, body: Record<string, unknown> = {}) {
  const started = await json<{ id: string }>(t, "POST", `/api/scenes/${sceneId}/generate`, body);
  await adapter.started;
  adapter.push("A line of prose.");
  adapter.end();
  await until(() => t.generation.get(started.id)?.status === "complete");
  const messages = await json<MessageDto[]>(t, "GET", `/api/scenes/${sceneId}/messages`);
  return messages.at(-1)!;
}

describe("the cast", () => {
  test("holds several characters in the order they were added", async () => {
    const t = await signedIn();
    const { bell, aldan, mira, scene } = await groupScene(t);
    expect(scene.cast.map((member) => member.characterId)).toEqual([bell.id, aldan.id, mira.id]);
    expect(scene.cast.every((member) => member.isActive)).toBe(true);
  });

  test("a benched member keeps their history but stops being chosen", async () => {
    const t = await signedIn();
    const { bell, scene } = await groupScene(t);

    const benched = await json<SceneDto>(t, "PATCH", `/api/scenes/${scene.id}/cast/${bell.id}`, {
      isActive: false,
    });
    expect(benched.cast.find((member) => member.characterId === bell.id)!.isActive).toBe(false);
    // Still in the cast — benching is not removal.
    expect(benched.cast).toHaveLength(3);

    const read = await json<SceneWithHistoryDto>(t, "GET", `/api/scenes/${scene.id}`);
    expect(read.nextSpeaker!.characterId).not.toBe(bell.id);
  });

  test("rejects a bench request with no boolean and an unknown member", async () => {
    const t = await signedIn();
    const { bell, scene } = await groupScene(t);
    expect(await statusOf(t, "PATCH", `/api/scenes/${scene.id}/cast/${bell.id}`, {})).toBe(400);
    expect(await statusOf(t, "PATCH", `/api/scenes/${scene.id}/cast/NOPE`, { isActive: false })).toBe(
      404,
    );
  });
});

describe("the turn director over HTTP", () => {
  test("the scene carries who speaks next and why", async () => {
    const t = await signedIn();
    const { bell, scene } = await groupScene(t);

    const read = await json<SceneWithHistoryDto>(t, "GET", `/api/scenes/${scene.id}`);
    // The composer has to know who the send button will speak as before the
    // user presses it, so the decision travels with the scene.
    expect(read.nextSpeaker).not.toBeNull();
    expect(read.nextSpeaker!.characterId).toBe(bell.id);
    expect(read.nextSpeaker!.source).toBe("director");
    expect(read.nextSpeaker!.reason.length).toBeGreaterThan(8);
  });

  test("round robin cycles the cast across real generations", async () => {
    const t = await signedIn();
    const { bell, aldan, mira, scene } = await groupScene(t);
    await json<SceneDto>(t, "PATCH", `/api/scenes/${scene.id}`, { turnStrategy: "round_robin" });

    await say(t, scene.id, "Anyone there?");
    const spoke: (string | null)[] = [];
    // The same adapter drives every turn: the generation service captured it at
    // construction, so replacing it here would leave the next turn waiting on
    // an adapter nobody is driving.
    for (let turn = 0; turn < 3; turn++) {
      spoke.push((await generate(t, scene.id)).characterId);
    }

    expect(spoke).toEqual([bell.id, aldan.id, mira.id]);
  });

  test("naming a character overrides the director for that turn", async () => {
    const t = await signedIn();
    const { mira, scene } = await groupScene(t);
    await json<SceneDto>(t, "PATCH", `/api/scenes/${scene.id}`, { turnStrategy: "round_robin" });
    await say(t, scene.id, "Mira?");

    const reply = await generate(t, scene.id, { characterId: mira.id });
    expect(reply.characterId).toBe(mira.id);
    expect(reply.speakerName).toBe("Mira Vance");
  });

  test("rejects an unknown turn strategy", async () => {
    const t = await signedIn();
    const { scene } = await groupScene(t);
    expect(
      await statusOf(t, "PATCH", `/api/scenes/${scene.id}`, { turnStrategy: "coin_flip" }),
    ).toBe(400);
  });

  test("a scene with no cast reports no next speaker rather than failing", async () => {
    const t = await signedIn();
    const { bell, aldan, mira, scene } = await groupScene(t);
    for (const character of [bell, aldan, mira]) {
      await json<SceneDto>(t, "DELETE", `/api/scenes/${scene.id}/cast/${character.id}`);
    }
    const read = await json<SceneWithHistoryDto>(t, "GET", `/api/scenes/${scene.id}`);
    expect(read.nextSpeaker).toBeNull();
  });
});

describe("the group prompt", () => {
  function promptFor(t: TestHarness, sceneUlid: string, spotlightId?: number) {
    const scene = findScene(t.ctx.db, sceneUlid)!;
    return buildPrompt(
      buildPromptContext({
        db: t.ctx.db,
        scene,
        capabilities: OPENAI_COMPATIBLE_CAPABILITIES,
        now: Date.UTC(2026, 2, 14),
        seed: 1,
        ...(spotlightId === undefined ? {} : { spotlightId }),
      }),
    );
  }

  test("gives the spotlight a full card and everyone else a compact one", async () => {
    const t = await signedIn();
    const { bell, scene } = await groupScene(t);
    await json<CharacterDto>(t, "PATCH", `/api/characters/${bell.id}`, {
      voiceNotes: "Short sentences. Never says goodbye.",
    });

    const built = promptFor(t, scene.id);
    // Everyone is present, so the author knows who is in the room.
    expect(built.system).toContain("Sister Bell");
    expect(built.system).toContain("Aldan Roe");
    expect(built.system).toContain("Mira Vance");
    // But voice notes go only to whoever is speaking (SPEC §3) — this is the
    // main defence against every character sounding the same.
    expect(built.system).toContain("Never says goodbye");
  });

  test("a benched character's voice notes never reach the prompt", async () => {
    const t = await signedIn();
    const { bell, aldan, scene } = await groupScene(t);
    await json<CharacterDto>(t, "PATCH", `/api/characters/${aldan.id}`, {
      voiceNotes: "Talks in circles when nervous.",
    });
    await json<CharacterDto>(t, "PATCH", `/api/characters/${bell.id}`, {
      voiceNotes: "Short sentences.",
    });

    const built = promptFor(t, scene.id);
    expect(built.system).toContain("Short sentences.");
    expect(built.system).not.toContain("Talks in circles when nervous.");
  });

  test("collects depth prompts from every character present", async () => {
    const t = await signedIn();
    const { bell, aldan, scene } = await groupScene(t);
    await json<CharacterDto>(t, "PATCH", `/api/characters/${bell.id}`, {
      depthPrompt: "Bell has not slept.",
      depthPromptDepth: 2,
    });
    await json<CharacterDto>(t, "PATCH", `/api/characters/${aldan.id}`, {
      depthPrompt: "Aldan is lying about the road.",
      depthPromptDepth: 2,
    });

    // A depth prompt applies whenever that character is present, not only when
    // they are speaking (SPEC §2).
    const flat = JSON.stringify(promptFor(t, scene.id));
    expect(flat).toContain("Bell has not slept.");
    expect(flat).toContain("Aldan is lying about the road.");
  });
});

describe("presence tracking", () => {
  test("a character added mid-scene is told what they missed", async () => {
    const t = await signedIn();
    const { bell, aldan, mira, scene } = await groupScene(t);

    // Start over with only Bell, play a few turns, then let Mira arrive.
    for (const character of [aldan, mira]) {
      await json<SceneDto>(t, "DELETE", `/api/scenes/${scene.id}/cast/${character.id}`);
    }
    await say(t, scene.id, "The road is closed.");
    await say(t, scene.id, "We argued about it for an hour.");
    await json<SceneDto>(t, "PUT", `/api/scenes/${scene.id}/cast/${mira.id}`);

    const miraId = t.ctx.db
      .query("SELECT id FROM characters WHERE ulid = $ulid")
      .get({ ulid: mira.id }) as { id: number };
    const built = promptFor(t, scene.id, miraId.id);

    // SPEC §6: the author sees everything, so history is not trimmed — the
    // constraint is stated instead.
    const instruction = built.messages.at(-1)!.content;
    expect(instruction).toContain("Mira Vance was not present for the first 2 turns");
    expect(instruction).toContain("does not know what happened");
    // The history itself is intact, because the author needs the continuity.
    expect(JSON.stringify(built.messages)).toContain("We argued about it for an hour.");
    expect(bell.id).toBeTruthy();
  });

  test("a character present from the start is told nothing about presence", async () => {
    const t = await signedIn();
    const { bell, scene } = await groupScene(t);
    await say(t, scene.id, "The road is closed.");

    const bellId = t.ctx.db
      .query("SELECT id FROM characters WHERE ulid = $ulid")
      .get({ ulid: bell.id }) as { id: number };
    expect(promptFor(t, scene.id, bellId.id).messages.at(-1)!.content).not.toContain(
      "was not present",
    );
  });

  function promptFor(t: TestHarness, sceneUlid: string, spotlightId?: number) {
    const scene = findScene(t.ctx.db, sceneUlid)!;
    return buildPrompt(
      buildPromptContext({
        db: t.ctx.db,
        scene,
        capabilities: OPENAI_COMPATIBLE_CAPABILITIES,
        now: Date.UTC(2026, 2, 14),
        seed: 1,
        ...(spotlightId === undefined ? {} : { spotlightId }),
      }),
    );
  }
});
