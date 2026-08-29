import { afterEach, describe, expect, test } from "bun:test";
import {
  ScriptedAdapter,
  completeSetup,
  createHarness,
  until,
  type TestHarness,
} from "./helpers.ts";
import { V1_CARD, V2_CARD, charxCard, jsonBytes, pngCard } from "./card-fixtures.ts";
import type {
  AuthorDto,
  CharacterDto,
  ConnectionProfileDto,
  MessageDto,
  SceneDto,
  SceneWithHistoryDto,
} from "../shared/types.ts";
import type { GenerationSnapshot } from "../server/generation/service.ts";

/**
 * The classifier turn director over HTTP (SPEC §6, §20 phase 10).
 *
 * The feature is not "a model picks the speaker" — it is that the pick is
 * *visible and never costs you the turn*. So the suite is mostly about what
 * happens when the classifier misbehaves: names nobody, fails, times out, picks
 * whoever just spoke. Every one of those has to end with a turn generated and a
 * reason a person can read.
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

async function importCharacter(t: TestHarness, bytes: Uint8Array, filename: string) {
  const form = new FormData();
  form.append("file", new File([bytes as unknown as BlobPart], filename));
  const body = (await (
    await t.fetch("/api/characters/import", { method: "POST", body: form })
  ).json()) as { character: CharacterDto };
  return body.character;
}

async function classifierScene(t: TestHarness) {
  const author = await json<AuthorDto>(t, "POST", "/api/authors", { name: "Kestrel" });
  const bell = await importCharacter(t, pngCard({ chara: V2_CARD }), "bell.png");
  const aldan = await importCharacter(t, jsonBytes(V1_CARD), "aldan.json");
  const mira = await importCharacter(
    t,
    charxCard({ ...V2_CARD, data: { ...V2_CARD.data, name: "Mira Vance" } }),
    "mira.charx",
  );

  const profiles = await json<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
  const created = await json<SceneDto>(t, "POST", "/api/scenes", {
    title: "Ridge station",
    connectionProfileId: profiles[0]!.id,
  });
  await json<SceneDto>(t, "PATCH", `/api/scenes/${created.id}`, {
    authorId: author.id,
    turnStrategy: "classifier",
  });
  for (const character of [bell, aldan, mira]) {
    await json<SceneDto>(t, "PUT", `/api/scenes/${created.id}/cast/${character.id}`);
  }
  await json<MessageDto>(t, "POST", `/api/scenes/${created.id}/messages`, {
    kind: "user",
    authorType: "user",
    content: "Has anyone counted the lamp oil?",
  });
  return { author, bell, aldan, mira, sceneId: created.id, profiles };
}

/** Generate one turn and return the snapshot once it has finished. */
async function generate(
  t: TestHarness,
  sceneId: string,
  body: Record<string, unknown> = {},
): Promise<GenerationSnapshot> {
  const started = await json<GenerationSnapshot>(t, "POST", `/api/scenes/${sceneId}/generate`, body);
  await adapter.started;
  adapter.push("A line of prose.");
  adapter.end();
  await until(() => t.generation.get(started.id)?.status === "complete");
  return t.generation.get(started.id)!;
}

describe("the decision reaches the client", () => {
  test("the scene says the classifier has not decided yet", async () => {
    const t = await signedIn();
    const { sceneId } = await classifierScene(t);

    // The composer still needs a name before the user presses send, but it must
    // not claim the classifier already chose one.
    const read = await json<SceneWithHistoryDto>(t, "GET", `/api/scenes/${sceneId}`);
    expect(read.nextSpeaker!.reason).toBe("The classifier decides when you send");
  });

  test("the generation carries who was chosen and why", async () => {
    const t = await signedIn();
    const { aldan, sceneId } = await classifierScene(t);
    adapter.classifierReply = "SPEAKER: Aldan Roe\nWHY: He keeps the ledger and was asked.";

    const snapshot = await generate(t, sceneId);
    expect(snapshot.director).toMatchObject({
      characterId: aldan.id,
      name: "Aldan Roe",
      source: "director",
      reason: "He keeps the ledger and was asked.",
      scope: "spotlight",
    });
  });

  test("the message is attributed to whoever the classifier picked", async () => {
    const t = await signedIn();
    const { mira, sceneId } = await classifierScene(t);
    adapter.classifierReply = "SPEAKER: Mira Vance\nWHY: She was already halfway out the door.";

    await generate(t, sceneId);
    const messages = await json<MessageDto[]>(t, "GET", `/api/scenes/${sceneId}/messages`);
    expect(messages.at(-1)!.characterId).toBe(mira.id);
  });

  test("a non-classifier scene still announces its decision", async () => {
    const t = await signedIn();
    const { sceneId } = await classifierScene(t);
    await json<SceneDto>(t, "PATCH", `/api/scenes/${sceneId}`, { turnStrategy: "round_robin" });

    const snapshot = await generate(t, sceneId);
    // SPEC §6 asks for the decision to be exposed; that is not a classifier
    // feature, so every turn says who and why on the same channel.
    expect(snapshot.director!.reason).toContain("Round robin");
    expect(adapter.classifierCalls).toBe(0);
  });
});

describe("what the classifier is allowed to decide", () => {
  test("it is never offered whoever just spoke", async () => {
    const t = await signedIn();
    const { sceneId } = await classifierScene(t);
    adapter.classifierReply = "SPEAKER: Sister Bell\nWHY: She has not spoken.";
    await generate(t, sceneId);

    // Bell spoke; the next question must not list her, so "never twice
    // consecutively" is structural rather than a plea in the prompt.
    adapter.classifierReply = "SPEAKER: Mira Vance\nWHY: She answers Bell.";
    await generate(t, sceneId);

    // The transcript still shows what Bell said — she is only kept off the list
    // of people who may be chosen.
    const question = adapter.prompts.at(-2)!.messages[0]!.content;
    const roster = question.slice(
      question.indexOf("Who is available:"),
      question.indexOf("What has just happened"),
    );
    expect(roster).not.toContain("Sister Bell");
    expect(roster).toContain("Mira Vance");
    expect(question).toContain("Sister Bell: A line of prose.");
  });

  test("a cued character is not put to a vote", async () => {
    const t = await signedIn();
    const { aldan, sceneId } = await classifierScene(t);
    adapter.classifierReply = "SPEAKER: Mira Vance\nWHY: I prefer her.";

    const snapshot = await generate(t, sceneId, { characterId: aldan.id });
    expect(snapshot.director).toMatchObject({ characterId: aldan.id, source: "user" });
    // Nothing left to ask, so nothing was asked.
    expect(adapter.classifierCalls).toBe(0);
  });

  test("the reader is named in the question and put out of reach", async () => {
    const t = await signedIn();
    const { sceneId } = await classifierScene(t);
    const persona = await json<{ id: string }>(t, "POST", "/api/personas", { name: "Wren" });
    await json<SceneDto>(t, "PATCH", `/api/scenes/${sceneId}`, { personaId: persona.id });

    adapter.classifierReply = "SPEAKER: Mira Vance\nWHY: She was addressed.";
    await generate(t, sceneId);
    expect(adapter.lastPrompt.messages[0]!.content).not.toContain("Wren is the reader");
    const question = adapter.prompts.find(
      (prompt) => prompt.debug.blocks[0]?.source === "turn director",
    )!;
    expect(question.messages[0]!.content).toContain("Wren is the reader");
  });
});

describe("scope: one voice or the room", () => {
  test("auto lets the classifier ask for a beat", async () => {
    const t = await signedIn();
    const { sceneId } = await classifierScene(t);
    adapter.classifierReply =
      "SPEAKER: Mira Vance\nSCOPE: room\nWHY: All three of them have a stake in the oil.";

    const snapshot = await generate(t, sceneId, { scope: "auto" });
    expect(snapshot.director!.scope).toBe("beat");

    const messages = await json<MessageDto[]>(t, "GET", `/api/scenes/${sceneId}/messages`);
    expect(messages.at(-1)!.kind).toBe("beat");
  });

  test("auto with one voice produces a spotlight", async () => {
    const t = await signedIn();
    const { sceneId } = await classifierScene(t);
    adapter.classifierReply = "SPEAKER: Mira Vance\nSCOPE: one\nWHY: Only she cares.";

    const snapshot = await generate(t, sceneId, { scope: "auto" });
    expect(snapshot.director!.scope).toBe("spotlight");
    const messages = await json<MessageDto[]>(t, "GET", `/api/scenes/${sceneId}/messages`);
    expect(messages.at(-1)!.kind).toBe("spotlight");
  });

  test("scope is only asked about when it is still open", async () => {
    const t = await signedIn();
    const { sceneId } = await classifierScene(t);
    adapter.classifierReply = "SPEAKER: Mira Vance\nWHY: Because.";

    await generate(t, sceneId, { scope: "beat" });
    const question = adapter.prompts.find(
      (prompt) => prompt.debug.blocks[0]?.source === "turn director",
    )!;
    // The user already chose; inviting the model to disagree would be rude.
    expect(question.messages[0]!.content).not.toContain("SCOPE:");
  });

  test("an explicit beat stays a beat whatever the classifier says", async () => {
    const t = await signedIn();
    const { sceneId } = await classifierScene(t);
    adapter.classifierReply = "SPEAKER: Mira Vance\nSCOPE: one\nWHY: Just her.";

    const snapshot = await generate(t, sceneId, { scope: "beat" });
    expect(snapshot.director!.scope).toBe("beat");
  });
});

describe("when the classifier does not answer", () => {
  test("a failing director model costs a decision, never the turn", async () => {
    const t = await signedIn();
    const { sceneId } = await classifierScene(t);
    adapter.classifierFails = true;

    const snapshot = await generate(t, sceneId);
    adapter.classifierFails = false;

    expect(snapshot.status).toBe("complete");
    expect(snapshot.buffer).toBe("A line of prose.");
    // The fallback stands, and says what it is rather than pretending.
    expect(snapshot.director!.reason).toBe("The classifier decides when you send");
  });

  test("a reply naming nobody falls back rather than guessing", async () => {
    const t = await signedIn();
    const { sceneId } = await classifierScene(t);
    adapter.classifierReply = "I'm sorry, I can't help with that.";

    const snapshot = await generate(t, sceneId);
    expect(snapshot.status).toBe("complete");
    expect(snapshot.director!.characterId).not.toBeNull();
    expect(snapshot.director!.reason).toBe("The classifier decides when you send");
  });

  test("a reply with a name but no reason still says something readable", async () => {
    const t = await signedIn();
    const { sceneId } = await classifierScene(t);
    adapter.classifierReply = "SPEAKER: Sister Bell";

    const snapshot = await generate(t, sceneId);
    expect(snapshot.director!.name).toBe("Sister Bell");
    expect(snapshot.director!.reason).toBe("Chosen by the classifier");
  });
});

describe("where the classifier runs", () => {
  test("a scene can send its director somewhere cheaper", async () => {
    const t = await signedIn();
    const { sceneId, profiles } = await classifierScene(t);

    const updated = await json<SceneDto>(t, "PATCH", `/api/scenes/${sceneId}`, {
      directorProfileId: profiles[0]!.id,
    });
    expect(updated.directorProfileId).toBe(profiles[0]!.id);

    const cleared = await json<SceneDto>(t, "PATCH", `/api/scenes/${sceneId}`, {
      directorProfileId: null,
    });
    expect(cleared.directorProfileId).toBeNull();
  });

  test("rejects a profile that does not exist", async () => {
    const t = await signedIn();
    const { sceneId } = await classifierScene(t);
    const response = await t.fetch(`/api/scenes/${sceneId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ directorProfileId: "NOPE" }),
    });
    expect(response.status).toBe(400);
  });
});
