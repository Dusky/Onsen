import { afterEach, describe, expect, test } from "bun:test";
import { ScriptedAdapter, completeSetup, createHarness, until, type TestHarness } from "./helpers.ts";
import { pngCard, V2_CARD } from "./card-fixtures.ts";
import type {
  CharacterDto,
  ConnectionProfileDto,
  LorebookDto,
  LoreEntryDto,
  MessageDto,
  PresetDto,
  PromptInspectorDto,
  SceneDto,
  SceneWithHistoryDto,
} from "../shared/types.ts";

/**
 * The prompt inspector through the real system (SPEC §16, §20 phase 25).
 *
 * What is tested is the promise §3 makes and §16 repeats: the debug record is
 * not optional, and it records what was *trimmed* as faithfully as what was
 * included. So the tests read the inspector the way a user with a complaint
 * would — "what did the model actually see" — against a scene whose budget,
 * lore and history were arranged to make the answer interesting.
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

/** A one-character scene with a greeting on the active path. */
async function makeScene(t: TestHarness): Promise<{ sceneId: string; first: MessageDto }> {
  const form = new FormData();
  form.append("file", new File([pngCard({ chara: V2_CARD }) as unknown as BlobPart], "bell.png"));
  const { character } = (await (
    await t.fetch("/api/characters/import", { method: "POST", body: form })
  ).json()) as { character: CharacterDto };
  const profiles = await json<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
  const created = await json<SceneDto>(t, "POST", "/api/scenes", {
    title: "Ridge station",
    connectionProfileId: profiles[0]!.id,
  });
  await json<SceneDto>(t, "PUT", `/api/scenes/${created.id}/cast/${character.id}`);
  // The scene opens on Bell's greeting (phase 43), so the path already has a
  // turn on it; every test that needs a reader's message adds this one.
  const first = await json<MessageDto>(t, "POST", `/api/scenes/${created.id}/messages`, {
    kind: "user",
    authorType: "user",
    content: "Bell, are you there?",
  });
  return { sceneId: created.id, first };
}

/** The reader says something and the scene answers; both messages come back. */
async function exchange(t: TestHarness, sceneId: string, reply: string): Promise<{
  user: MessageDto;
  assistant: MessageDto;
  generationId: string;
}> {
  const user = await json<MessageDto>(t, "POST", `/api/scenes/${sceneId}/messages`, {
    kind: "user",
    authorType: "user",
    content: "Bell, tell me about the lamp oil.",
  });
  adapter.push(reply);
  adapter.end();
  const generation = await json<{ id: string }>(t, "POST", `/api/scenes/${sceneId}/generate`, {});
  await until(async () => {
    const snapshot = await json<{ status: string }>(t, "GET", `/api/generations/${generation.id}`);
    return snapshot.status === "complete";
  });
  const history = await json<SceneWithHistoryDto>(t, "GET", `/api/scenes/${sceneId}`);
  const assistant = history.messages.at(-1)!;
  return { user, assistant, generationId: generation.id };
}

async function inspectorOf(
  t: TestHarness,
  sceneId: string,
  messageId: string,
): Promise<{ status: number; body: PromptInspectorDto }> {
  const response = await t.fetch(`/api/scenes/${sceneId}/inspector/${messageId}`);
  return { status: response.status, body: (await response.json()) as PromptInspectorDto };
}

describe("the prompt inspector (SPEC §16)", () => {
  test("requires a session", async () => {
    const t = createHarness();
    expect(await statusOf(t, "GET", "/api/scenes/x/inspector/y")).toBe(401);
  });

  test("shows the exact prompt that wrote the message", async () => {
    const t = await signedIn();
    const { sceneId } = await makeScene(t);
    const { assistant, generationId } = await exchange(t, sceneId, "The oil is low.");

    const { status, body } = await inspectorOf(t, sceneId, assistant.id);
    expect(status).toBe(200);
    expect(body.generationId).toBe(generationId);
    expect(body.messageId).toBe(assistant.id);
    // §3's assembly, present and costed — in single-character mode the
    // spotlight leads, and there is no author block to come before it.
    const ids = body.debug.blocks.map((block) => block.id);
    expect(ids).toContain("spotlight_character");
    expect(ids).toContain("history");
    expect(ids.indexOf("spotlight_character")).toBeLessThan(ids.indexOf("history"));
    expect(body.debug.blocks.every((block) => block.tokens >= 0)).toBe(true);
    expect(body.debug.totalTokens).toBeGreaterThan(0);
    // The reader's message is on the path the prompt carried.
    expect(body.debug.historyIncluded.length).toBeGreaterThan(1);
  });

  test("the scene reports the same total to the status bar (§16)", async () => {
    // The number has been stored since phase 25 and shown only here. The status
    // bar reads the same row, so the two can never disagree.
    const t = await signedIn();
    const { sceneId } = await makeScene(t);

    const before = await json<SceneWithHistoryDto>(t, "GET", `/api/scenes/${sceneId}`);
    expect(before.scene.lastPromptTokens).toBeNull();

    const { assistant } = await exchange(t, sceneId, "The oil is low.");
    const { body } = await inspectorOf(t, sceneId, assistant.id);
    const after = await json<SceneWithHistoryDto>(t, "GET", `/api/scenes/${sceneId}`);

    expect(after.scene.lastPromptTokens).toBe(body.debug.totalTokens);
  });

  test("a reader's message reaches the prompt of the reply it prompted", async () => {
    const t = await signedIn();
    const { sceneId } = await makeScene(t);
    const { user, generationId } = await exchange(t, sceneId, "The oil is low.");

    const { status, body } = await inspectorOf(t, sceneId, user.id);
    expect(status).toBe(200);
    expect(body.generationId).toBe(generationId);
  });

  test("names which lore fired, on what, and why the rest did not", async () => {
    const t = await signedIn();
    const { sceneId } = await makeScene(t);

    const book = await json<LorebookDto>(t, "POST", "/api/lorebooks", { name: "The ridge" });
    // Created with content, then shaped by patch — the create route takes the
    // words, the patch takes the matching rules.
    const fired = await json<LoreEntryDto>(t, "POST", `/api/lorebooks/${book.id}/entries`, {
      title: "Lamp oil",
      content: "The station's lamps burn cedar oil, and it is running out.",
    });
    await json<LoreEntryDto>(t, "PATCH", `/api/lorebooks/${book.id}/entries/${fired.id}`, {
      keys: ["lamp oil"],
    });
    const missed = await json<LoreEntryDto>(t, "POST", `/api/lorebooks/${book.id}/entries`, {
      title: "The sealed tunnel",
      content: "Nobody has opened the tunnel since the flood.",
    });
    await json<LoreEntryDto>(t, "PATCH", `/api/lorebooks/${book.id}/entries/${missed.id}`, {
      keys: ["sealed tunnel"],
    });
    await json(t, "POST", `/api/lorebooks/${book.id}/bindings`, {
      scope: "scene",
      targetId: sceneId,
    });

    // The reader's message contains "lamp oil", so the first entry fires and
    // the second has no match anywhere on the path.
    const { assistant } = await exchange(t, sceneId, "Bell, tell me about the lamp oil.");
    const { body } = await inspectorOf(t, sceneId, assistant.id);

    const trace = body.debug.loreTrace;
    const oil = trace.find((row) => row.entryId === fired.id);
    const tunnel = trace.find((row) => row.entryId === missed.id);
    expect(oil?.skipped).toBe(null);
    expect(oil?.matchedKey).toBe("lamp oil");
    expect(tunnel?.skipped).toBe("no_match");
    // And the fired entry is in the prompt as a block, not only in the trace —
    // wherever its position puts it, which is the block's business, not the
    // verdict's.
    expect(
      body.debug.blocks.some(
        (block) =>
          (block.id === "matched_lore" || block.id === "constant_lore") &&
          block.content.includes("cedar oil"),
      ),
    ).toBe(true);
  });

  test("records what a tight window could not carry", async () => {
    const t = await signedIn();
    const { sceneId } = await makeScene(t);

    // A window sized to trim: the fixed blocks cost around five hundred
    // tokens on this card, so 1800 leaves history a few hundred — less than
    // the long messages below add up to.
    const presets = await json<PresetDto[]>(t, "GET", "/api/connections/presets");
    await json<PresetDto>(t, "PATCH", `/api/connections/presets/${presets[0]!.id}`, {
      contextSize: 1800,
    });
    await json<SceneDto>(t, "PATCH", `/api/scenes/${sceneId}`, { presetId: presets[0]!.id });

    const long =
      "The walk up the ridge took the whole of the afternoon, past the closed " +
      "gate and the flooded culvert and the row of dead lamps, and by the time " +
      "the station came into view the light had gone out of the sky entirely, " +
      "which is when the cold finally made itself felt through the coat.";
    await json(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: long,
    });
    await json(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: long,
    });
    await json(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: long,
    });
    await json(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: long,
    });

    await exchange(t, sceneId, "And another, to be sure it overflows.");
    const { assistant } = await exchange(t, sceneId, "Once more, for the trace.");
    const { body } = await inspectorOf(t, sceneId, assistant.id);

    expect(body.debug.evicted.length).toBeGreaterThan(0);
    expect(body.debug.evicted.some((item) => item.reason === "history_budget")).toBe(true);
    // What was carried is consistent with what was trimmed: neither list
    // claims a message the other also claims.
    const carried = new Set(body.debug.historyIncluded);
    for (const item of body.debug.evicted) {
      if (item.itemId !== null) expect(carried.has(item.itemId)).toBe(false);
    }
  });

  test("a cancelled generation is as inspectable as a finished one", async () => {
    const t = await signedIn();
    const { sceneId, first } = await makeScene(t);

    // Nothing queued: the turn is streaming and waiting when it is cancelled,
    // but the prompt was built the moment it started.
    const generation = await json<{ id: string }>(t, "POST", `/api/scenes/${sceneId}/generate`, {});
    await until(async () => {
      const snapshot = await json<{ status: string }>(t, "GET", `/api/generations/${generation.id}`);
      return snapshot.status === "streaming" || snapshot.status === "pending";
    });
    await json(t, "POST", `/api/generations/${generation.id}/cancel`);
    await until(async () => {
      const snapshot = await json<{ status: string }>(t, "GET", `/api/generations/${generation.id}`);
      return snapshot.status === "cancelled";
    });

    // Reaching it through the first message — which no generation targeted
    // and none is parented on once the cancelled one's parent is checked —
    // exercises the "last built prompt" path.
    const { status, body } = await inspectorOf(t, sceneId, first.id);
    expect(status).toBe(200);
    expect(body.generationId).toBe(generation.id);
    expect(body.debug.blocks.length).toBeGreaterThan(0);
  });

  test("a scene with no built prompt says so", async () => {
    const t = await signedIn();
    const { sceneId, first } = await makeScene(t);
    const { status } = await inspectorOf(t, sceneId, first.id);
    expect(status).toBe(404);
  });
});
