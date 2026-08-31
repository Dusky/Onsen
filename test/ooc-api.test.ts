import { afterEach, describe, expect, test } from "bun:test";
import { ScriptedAdapter, completeSetup, createHarness, until, type TestHarness } from "./helpers.ts";
import { V2_CARD, pngCard } from "./card-fixtures.ts";
import type {
  CharacterDto,
  ConnectionProfileDto,
  MessageDto,
  SceneDto,
  SceneWithHistoryDto,
} from "../shared/types.ts";

/**
 * The OOC channel through the real system (SPEC §12, §20 phase 23).
 *
 * Two directions, and they are not symmetric. The author's asides are *split
 * out of prose it is already writing*, so the risk is a marker the parser
 * misses landing in the middle of a scene. The reader's questions are their own
 * messages, so the risk is the opposite: an answer that quietly advances the
 * story instead of answering.
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

async function scene(t: TestHarness, settings: Record<string, unknown> = {}) {
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
  if (Object.keys(settings).length > 0) {
    expect(await statusOf(t, "PATCH", `/api/scenes/${created.id}`, settings)).toBe(200);
  }
  await json(t, "POST", `/api/scenes/${created.id}/messages`, {
    kind: "user",
    authorType: "user",
    content: "Has anyone counted the lamp oil?",
  });
  return created.id;
}

async function messages(t: TestHarness, sceneId: string): Promise<MessageDto[]> {
  return (await json<SceneWithHistoryDto>(t, "GET", `/api/scenes/${sceneId}`)).messages;
}

/**
 * Run a generation, feeding it `reply` in pieces the way a stream would, and
 * hand back **the turn's own prompt**.
 *
 * The first new one, not the last: the post-generation pipeline runs guides and
 * summaries through the same adapter afterwards, so `prompts.at(-1)` is
 * whichever side call finished most recently rather than the turn.
 */
async function run(t: TestHarness, path: string, body: unknown, reply: string[]) {
  const before = adapter.prompts.length;
  void t.fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  await adapter.started;
  await until(() => adapter.prompts.length > before);
  const prompt = adapter.prompts[before]!;
  for (const piece of reply) adapter.push(piece);
  adapter.end();
  const sceneId = path.split("/")[3]!;
  await until(async () => (await messages(t, sceneId)).some((m) => m.authorType !== "user"));
  return prompt;
}

describe("the author stepping out", () => {
  test("an aside is split off the turn instead of landing in the scene", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    await run(t, `/api/scenes/${sceneId}/generate`, {}, [
      "She set the ledger down. ",
      "((Do you want her angrier here?))",
    ]);

    const history = await messages(t, sceneId);
    const prose = history.find((m) => m.kind === "spotlight")!;
    const aside = history.find((m) => m.kind === "ooc");
    expect(prose.content).toBe("She set the ledger down.");
    expect(prose.content).not.toContain("angrier");
    expect(aside).toBeDefined();
    expect(aside!.content).toBe("Do you want her angrier here?");
    expect(aside!.authorType).toBe("ooc");
  });

  test("the aside is a child of the turn, so a reroll takes it away", async () => {
    // §1 says history is a tree. The aside belongs to *that* telling of the
    // turn: rerolling makes a sibling, which is a path the aside is not on.
    const t = await signedIn();
    const sceneId = await scene(t);
    await run(t, `/api/scenes/${sceneId}/generate`, {}, ["Prose. ((An aside.))"]);
    const before = await messages(t, sceneId);
    const prose = before.find((m) => m.kind === "spotlight")!;
    expect(before.some((m) => m.kind === "ooc")).toBe(true);

    // Reroll: a sibling of the prose turn, generated from its parent.
    await run(t, `/api/scenes/${sceneId}/generate`, { parentId: prose.parentId }, [
      "A different turn entirely.",
    ]);
    const after = await messages(t, sceneId);
    expect(after.some((m) => m.kind === "ooc")).toBe(false);
    expect(after.at(-1)!.content).toBe("A different turn entirely.");
  });

  test("a marker split across chunks is still caught", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    await run(t, `/api/scenes/${sceneId}/generate`, {}, ["Prose. (", "(hidden", "))", " More."]);
    const history = await messages(t, sceneId);
    expect(history.find((m) => m.kind === "spotlight")!.content).toBe("Prose. More.");
    expect(history.find((m) => m.kind === "ooc")!.content).toBe("hidden");
  });

  test("ordinary parenthetical prose is left alone", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    const text = "She paused (only for a moment) and went on.";
    await run(t, `/api/scenes/${sceneId}/generate`, {}, [text]);
    const history = await messages(t, sceneId);
    expect(history.find((m) => m.kind === "spotlight")!.content).toBe(text);
    expect(history.some((m) => m.kind === "ooc")).toBe(false);
  });

  test("asides are split even when the scene never invited one", async () => {
    // The invitation is opt-in; the splitting is not. A model that volunteers
    // `((…))` unprompted must still not have it land in the middle of a scene.
    const t = await signedIn();
    const sceneId = await scene(t, { oocEnabled: false });
    await run(t, `/api/scenes/${sceneId}/generate`, {}, ["Prose. ((Unasked for.))"]);
    const history = await messages(t, sceneId);
    expect(history.find((m) => m.kind === "spotlight")!.content).toBe("Prose.");
    expect(history.find((m) => m.kind === "ooc")!.content).toBe("Unasked for.");
  });
});

describe("the invitation", () => {
  test("absent unless the scene asked for it", async () => {
    const t = await signedIn();
    const sceneId = await scene(t, { oocEnabled: false });
    const prompt = await run(t, `/api/scenes/${sceneId}/generate`, {}, ["Prose."]);
    expect(prompt.debug.blocks.some((b) => b.id === "ooc_invitation")).toBe(false);
  });

  test("present when it is, and names the marker the parser looks for", async () => {
    // "Mark it clearly" leaves the model to invent one, and an aside the
    // splitter cannot find is an aside printed into the scene.
    const t = await signedIn();
    const sceneId = await scene(t, { oocEnabled: true });
    const prompt = await run(t, `/api/scenes/${sceneId}/generate`, {}, ["Prose."]);
    const block = prompt.debug.blocks.find((b) => b.id === "ooc_invitation");
    expect(block).toBeDefined();
    expect(block!.content).toContain("((this))");
  });

  test("suppressed until the interval has passed", async () => {
    const t = await signedIn();
    const sceneId = await scene(t, { oocEnabled: true, oocInterval: 3 });
    // The first turn produces an aside, which starts the count.
    await run(t, `/api/scenes/${sceneId}/generate`, {}, ["One. ((First aside.))"]);
    const second = await run(t, `/api/scenes/${sceneId}/generate`, {}, ["Two."]);
    expect(second.debug.blocks.some((b) => b.id === "ooc_invitation")).toBe(false);
  });
});

describe("the reader asking", () => {
  test("the question and the answer are both kept, and told apart by who spoke", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    const prompt = await run(t, `/api/scenes/${sceneId}/ooc`, { question: "How long has it been?" }, [
      "About three days, in story time.",
    ]);

    const history = await messages(t, sceneId);
    const asked = history.find((m) => m.kind === "ooc" && m.authorType === "user");
    const answered = history.find((m) => m.kind === "ooc" && m.authorType === "ooc");
    expect(asked!.content).toBe("How long has it been?");
    expect(answered!.content).toBe("About three days, in story time.");

    // The instruction spends most of its words on the boundary, because a model
    // asked a question mid-roleplay will answer it *and* write the next turn.
    const instruction = prompt.debug.blocks.find((b) => b.label === "Out-of-character question");
    expect(instruction).toBeDefined();
    expect(instruction!.content).toContain("How long has it been?");
    expect(instruction!.content).toContain("Do not write the next turn");
  });

  test("the answer is not a turn: no character is attributed", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    await run(t, `/api/scenes/${sceneId}/ooc`, { question: "Anything?" }, ["Nothing yet."]);
    const answered = (await messages(t, sceneId)).find(
      (m) => m.kind === "ooc" && m.authorType === "ooc",
    )!;
    expect(answered.characterId).toBeNull();
  });

  test("markers inside an answer are the author's words, not another aside", async () => {
    // The whole answer is already out of character; splitting it again would
    // eat text the author meant to say.
    const t = await signedIn();
    const sceneId = await scene(t);
    await run(t, `/api/scenes/${sceneId}/ooc`, { question: "How do I steer?" }, [
      "Type ((steer: slower)) to set a note.",
    ]);
    const answered = (await messages(t, sceneId)).find(
      (m) => m.kind === "ooc" && m.authorType === "ooc",
    )!;
    expect(answered.content).toBe("Type ((steer: slower)) to set a note.");
  });

  test("an empty question is refused before anything is written", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    expect(await statusOf(t, "POST", `/api/scenes/${sceneId}/ooc`, { question: "   " })).toBe(400);
    expect((await messages(t, sceneId)).some((m) => m.kind === "ooc")).toBe(false);
  });

  test("the exchange is in the transcript the next turn reads", async () => {
    // An answer the author cannot see would leave it contradicting itself one
    // turn later.
    const t = await signedIn();
    const sceneId = await scene(t);
    await run(t, `/api/scenes/${sceneId}/ooc`, { question: "Is she lying?" }, ["She is."]);
    const next = await run(t, `/api/scenes/${sceneId}/generate`, {}, ["She looked away."]);
    const transcript = next.messages.map((m) => m.content).join("\n");
    expect(transcript).toContain("Is she lying?");
    expect(transcript).toContain("She is.");
  });
});
