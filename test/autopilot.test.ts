import { afterEach, describe, expect, test } from "bun:test";
import { ScriptedAdapter, completeSetup, createHarness, until, type TestHarness } from "./helpers.ts";
import { pngCard, V2_CARD_SILENT } from "./card-fixtures.ts";
import { addressedQuestion, parseAddressedReply } from "../server/generation/autopilot.ts";
import type {
  AutopilotStateDto,
  CharacterDto,
  ConnectionProfileDto,
  SceneDto,
  SceneWithHistoryDto,
} from "../shared/types.ts";

/**
 * Autopilot through the real system (SPEC §6, §20 phase 24).
 *
 * Every stop §6 names is exercised as the reader would hit it: the cap, the
 * reader's own message, the stop control, the scene switching it off, and the
 * moment a character turns to face the reader. The loop is driven by the same
 * scripted adapter as the turns it writes, and the addressed check is answered
 * through the side-call channel so the loop's only model dependency is read
 * exactly as production reads it.
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

/** A single-character scene, autopilot on, with the cap the test wants. */
async function autopilotScene(t: TestHarness, maxTurns: number): Promise<string> {
  const form = new FormData();
  form.append("file", new File([pngCard({ chara: V2_CARD_SILENT }) as unknown as BlobPart], "bell.png"));
  const { character } = (await (
    await t.fetch("/api/characters/import", { method: "POST", body: form })
  ).json()) as { character: CharacterDto };

  const profiles = await json<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
  const created = await json<SceneDto>(t, "POST", "/api/scenes", {
    title: "Ridge station",
    connectionProfileId: profiles[0]!.id,
  });
  await json<SceneDto>(t, "PUT", `/api/scenes/${created.id}/cast/${character.id}`);
  await json<SceneDto>(t, "PATCH", `/api/scenes/${created.id}`, {
    autopilotEnabled: true,
    autopilotMaxTurns: maxTurns,
  });
  return created.id;
}

async function state(t: TestHarness, sceneId: string): Promise<AutopilotStateDto> {
  return json<AutopilotStateDto>(t, "GET", `/api/scenes/${sceneId}/autopilot`);
}

async function history(t: TestHarness, sceneId: string): Promise<SceneWithHistoryDto> {
  return json<SceneWithHistoryDto>(t, "GET", `/api/scenes/${sceneId}`);
}

/** The reader sends a message, and the scene answers it. */
async function sendAndReply(t: TestHarness, sceneId: string): Promise<void> {
  await json(t, "POST", `/api/scenes/${sceneId}/messages`, {
    kind: "user",
    authorType: "user",
    content: "Bell, what happened here?",
  });
  const generation = await json<{ id: string }>(t, "POST", `/api/scenes/${sceneId}/generate`, {});
  await until(async () => {
    const snapshot = await json<{ status: string }>(
      t,
      "GET",
      `/api/generations/${generation.id}`,
    );
    return snapshot.status === "complete";
  });
}

/** What the addressed check answers, for tests that care. */
function checkAnswers(answer: string): void {
  adapter.taskReplyFor = (prompt) =>
    prompt.debug.blocks[0]?.label === "Addressed check" ? answer : null;
}

describe("the addressed check (pure)", () => {
  test("reads a leading word, a decorated word, and nothing else", () => {
    expect(parseAddressedReply("YES")).toBe(true);
    expect(parseAddressedReply("no")).toBe(false);
    expect(parseAddressedReply("Yes.")).toBe(true);
    expect(parseAddressedReply("**No**")).toBe(false);
    expect(parseAddressedReply("I think yes, they did")).toBe(true);
    expect(parseAddressedReply("I would say no")).toBe(false);
    expect(parseAddressedReply("Certainly not")).toBe(null);
    expect(parseAddressedReply("")).toBe(null);
    expect(parseAddressedReply("Maybe they looked over")).toBe(null);
  });

  test("the question names the reader and bounds the excerpt", () => {
    const question = addressedQuestion({
      persona: "Vess",
      speaker: "Bell",
      content: `${"The kettle boiled. ".repeat(200)}Then she looked at you.`,
    });
    expect(question).toContain("Vess");
    expect(question).toContain("Bell");
    expect(question).toContain("YES or NO");
    expect(question.length).toBeLessThan(1_400);
  });
});

describe("autopilot (SPEC §6)", () => {
  test("requires a session", async () => {
    const t = createHarness();
    expect(await statusOf(t, "GET", "/api/scenes/whatever/autopilot")).toBe(401);
  });

  test("writes to the cap, then hands the scene back", async () => {
    harness = createHarness({ adapter: (adapter = new ScriptedAdapter()) });
    const t = await completeSetup(harness).then(() => harness!);
    checkAnswers("NO");
    const sceneId = await autopilotScene(t, 2);

    // The reply, then the two turns the loop writes. One shared queue, served
    // in order: each `end` closes the generation that consumed the text before it.
    adapter.push("The station hums. Bell looks up.");
    adapter.end();
    adapter.push("Turn one: Bell checks the board.");
    adapter.end();
    adapter.push("Turn two: Bell finds the log.");
    adapter.end();

    await sendAndReply(t, sceneId);
    await until(async () => (await state(t, sceneId)).stopReason === "cap");

    const row = await state(t, sceneId);
    expect(row.active).toBe(false);
    expect(row.turns).toBe(2);
    expect(row.stopReason).toBe("cap");

    // The scene actually moved: the reader's message, the reply, and two
    // turns the loop wrote.
    const messages = (await history(t, sceneId)).messages;
    expect(messages.filter((m) => m.authorType === "character").length).toBe(3);
    expect(messages.at(-1)?.content).toBe("Turn two: Bell finds the log.");
  });

  test("stops the moment a character turns to the reader", async () => {
    harness = createHarness({ adapter: (adapter = new ScriptedAdapter()) });
    const t = await completeSetup(harness).then(() => harness!);
    checkAnswers("YES");
    const sceneId = await autopilotScene(t, 5);

    adapter.push("Bell looks up.");
    adapter.end();
    adapter.push("Bell turns to you. \"What do you want to do?\"");
    adapter.end();

    await sendAndReply(t, sceneId);
    await until(async () => (await state(t, sceneId)).stopReason === "addressed");

    const row = await state(t, sceneId);
    expect(row.turns).toBe(1);
    // The check ran once per autopilot turn, and the first one said yes.
    expect(adapter.callsLabelled("Addressed check")).toBe(1);
  });

  test("a broken check never stops the loop — the cap still bounds it", async () => {
    harness = createHarness({ adapter: (adapter = new ScriptedAdapter()) });
    const t = await completeSetup(harness).then(() => harness!);
    adapter.taskFails = true; // the checker is unreachable; so is every guide
    const sceneId = await autopilotScene(t, 2);

    adapter.push("Reply.");
    adapter.end();
    adapter.push("Turn one.");
    adapter.end();
    adapter.push("Turn two.");
    adapter.end();

    await sendAndReply(t, sceneId);
    await until(async () => (await state(t, sceneId)).stopReason === "cap");
    expect((await state(t, sceneId)).turns).toBe(2);
  });

  test("the reader's message stops it, and clears the way for their turn", async () => {
    harness = createHarness({ adapter: (adapter = new ScriptedAdapter()) });
    const t = await completeSetup(harness).then(() => harness!);
    checkAnswers("NO");
    const sceneId = await autopilotScene(t, 5);

    adapter.push("Reply.");
    adapter.end();
    await sendAndReply(t, sceneId);

    // The loop's turn is in flight — the queue is empty, so it is streaming
    // and waiting. The reader sends into it.
    await until(async () => {
      const row = await state(t, sceneId);
      return row.active && row.generationId !== null;
    });

    await json(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "Stop — I want to try something.",
    });

    await until(async () => {
      const row = await state(t, sceneId);
      return !row.active;
    });
    const row = await state(t, sceneId);
    expect(row.stopReason).toBe("user");

    // The reader is not left fighting a generation: their next send starts.
    adapter.push("The scene answers on your terms.");
    adapter.end();
    const status = await statusOf(t, "POST", `/api/scenes/${sceneId}/generate`, {});
    expect(status).toBe(201);
  });

  test("the stop control ends the loop and cancels the turn in flight", async () => {
    harness = createHarness({ adapter: (adapter = new ScriptedAdapter()) });
    const t = await completeSetup(harness).then(() => harness!);
    checkAnswers("NO");
    const sceneId = await autopilotScene(t, 5);

    adapter.push("Reply.");
    adapter.end();
    await sendAndReply(t, sceneId);
    await until(async () => {
      const row = await state(t, sceneId);
      return row.active && row.generationId !== null;
    });

    await json(t, "POST", `/api/scenes/${sceneId}/autopilot/stop`);
    const row = await state(t, sceneId);
    expect(row.active).toBe(false);
    expect(row.stopReason).toBe("stopped");
    expect(adapter.aborted).toBe(true);
  });

  test("switching it off mid-run is itself a stop", async () => {
    harness = createHarness({ adapter: (adapter = new ScriptedAdapter()) });
    const t = await completeSetup(harness).then(() => harness!);
    checkAnswers("NO");
    const sceneId = await autopilotScene(t, 5);

    adapter.push("Reply.");
    adapter.end();
    await sendAndReply(t, sceneId);
    await until(async () => {
      const row = await state(t, sceneId);
      return row.active;
    });

    await json(t, "PATCH", `/api/scenes/${sceneId}`, { autopilotEnabled: false });
    expect((await state(t, sceneId)).stopReason).toBe("off");
  });

  test("a failed turn ends the loop rather than retrying into the same wall", async () => {
    harness = createHarness({ adapter: (adapter = new ScriptedAdapter()) });
    const t = await completeSetup(harness).then(() => harness!);
    checkAnswers("NO");
    const sceneId = await autopilotScene(t, 5);

    adapter.push("Reply.");
    adapter.end();
    await sendAndReply(t, sceneId);
    await until(async () => {
      const row = await state(t, sceneId);
      return row.active && row.generationId !== null;
    });
    // The loop's turn dies with a provider error.
    adapter.fail(new Error("the provider went away"));

    await until(async () => (await state(t, sceneId)).stopReason === "error");
    expect((await state(t, sceneId)).active).toBe(false);
  });

  test("a scene that never asked for it never loops", async () => {
    harness = createHarness({ adapter: (adapter = new ScriptedAdapter()) });
    const t = await completeSetup(harness).then(() => harness!);
    const sceneId = await autopilotScene(t, 3);
    await json(t, "PATCH", `/api/scenes/${sceneId}`, { autopilotEnabled: false });

    adapter.push("A plain reply.");
    adapter.end();
    await sendAndReply(t, sceneId);

    // Nothing arms, nothing writes. Give the loop its chance to misfire and
    // then assert it did not take it.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const row = await state(t, sceneId);
    expect(row.active).toBe(false);
    expect(row.stopReason).toBe(null);
    expect((await history(t, sceneId)).messages.length).toBe(2);
  });
});
