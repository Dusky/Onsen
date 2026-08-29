import { afterEach, describe, expect, test } from "bun:test";
import {
  ScriptedAdapter,
  completeSetup,
  createHarness,
  until,
  type TestHarness,
} from "./helpers.ts";
import { V1_CARD, V2_CARD, charxCard, jsonBytes, pngCard } from "./card-fixtures.ts";
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
 * Beats (SPEC §3.5, §20 phase 9): one generation in which the author writes
 * several characters interacting, and the three things you can then do to one —
 * read its parts, recast one of them, or split it into separate messages.
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

/** An author and a three-character cast, as phase 8 leaves it. */
async function groupScene(t: TestHarness) {
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
  await json<SceneDto>(t, "PATCH", `/api/scenes/${created.id}`, { authorId: author.id });
  for (const character of [bell, aldan, mira]) {
    await json<SceneDto>(t, "PUT", `/api/scenes/${created.id}/cast/${character.id}`);
  }
  return { author, bell, aldan, mira, sceneId: created.id };
}

/** Run one generation to completion with a scripted body. */
async function generate(
  t: TestHarness,
  sceneId: string,
  body: Record<string, unknown>,
  output: string,
) {
  const started = await json<{ id: string }>(t, "POST", `/api/scenes/${sceneId}/generate`, body);
  await adapter.started;
  adapter.push(output);
  adapter.end();
  await until(() => t.generation.get(started.id)?.status === "complete");
  const messages = await json<MessageDto[]>(t, "GET", `/api/scenes/${sceneId}/messages`);
  return messages.at(-1)!;
}

const THREE_HANDED = [
  "**Aldan Roe:** He set the lamp on the counter, wick still smoking.",
  "",
  '**Mira Vance:** "You said an hour."',
  "",
  "**Sister Bell:** She did not look up from the ledger.",
].join("\n");

/* ------------------------------------------------------------------ */
/* The prompt                                                          */
/* ------------------------------------------------------------------ */

describe("what a beat asks the model for", () => {
  async function beatPrompt(t: TestHarness, sceneId: string) {
    const scene = findScene(t.ctx.db, sceneId)!;
    return buildPrompt(
      buildPromptContext({
        db: t.ctx.db,
        scene,
        capabilities: OPENAI_COMPATIBLE_CAPABILITIES,
        turn: { kind: "beat", bound: { kind: "exchanges", count: 2 } },
        now: Date.now(),
        seed: 1,
      }),
    );
  }

  test("names every participant and the one who opens", async () => {
    const t = await signedIn();
    const { sceneId } = await groupScene(t);
    const prompt = await beatPrompt(t, sceneId);
    const instruction = prompt.debug.blocks.find((b) => b.id === "spotlight_instruction")!;

    expect(instruction.label).toBe("Beat instruction");
    for (const name of ["Sister Bell", "Aldan Roe", "Mira Vance"]) {
      expect(instruction.content).toContain(name);
    }
    expect(instruction.content).toContain("opens it");
  });

  test("carries every mitigation SPEC §3.5 requires", async () => {
    const t = await signedIn();
    const { sceneId } = await groupScene(t);
    const instruction = (await beatPrompt(t, sceneId)).debug.blocks.find(
      (b) => b.id === "spotlight_instruction",
    )!.content;

    // Equal initiative; the bound; the anti-echo rule; the prohibition on
    // ending by asking the reader something; the user-lock; the label format.
    expect(instruction).toContain("Do not funnel");
    expect(instruction).toContain("2 exchanges");
    expect(instruction).toContain("Do not have them restate");
    expect(instruction).toContain("Do not end the beat by asking");
    expect(instruction).toContain("do not decide what they do next");
    expect(instruction).toContain("**Sister Bell:**");
  });

  test("gives every participant a full definition, voice notes included", async () => {
    const t = await signedIn();
    const { sceneId } = await groupScene(t);
    const prompt = await beatPrompt(t, sceneId);
    const participants = prompt.debug.blocks.find((b) => b.id === "spotlight_character")!;
    expect(participants.label).toBe("Beat participants");
    // One heading per character, not one in full and the rest compactly:
    // homogenised voices are the failure mode a beat has to defend against.
    for (const name of ["Sister Bell", "Aldan Roe", "Mira Vance"]) {
      expect(participants.content).toContain(`## ${name}`);
    }
    // Nobody is left over to be listed as merely present.
    expect(prompt.debug.blocks.find((b) => b.id === "cast")).toBeUndefined();
  });

  test("a spotlight is unchanged by any of it", async () => {
    const t = await signedIn();
    const { sceneId } = await groupScene(t);
    const scene = findScene(t.ctx.db, sceneId)!;
    const prompt = buildPrompt(
      buildPromptContext({
        db: t.ctx.db,
        scene,
        capabilities: OPENAI_COMPATIBLE_CAPABILITIES,
        now: Date.now(),
        seed: 1,
      }),
    );
    const instruction = prompt.debug.blocks.find((b) => b.id === "spotlight_instruction")!;
    expect(instruction.label).toBe("Spotlight instruction");
    expect(instruction.content).toContain("and only as");
  });

  test("a beat needs somebody to talk to, so a solo cast degrades to a spotlight", async () => {
    const t = await signedIn();
    const { bell, aldan, mira, sceneId } = await groupScene(t);
    for (const character of [aldan, mira]) {
      await json(t, "PATCH", `/api/scenes/${sceneId}/cast/${character.id}`, { isActive: false });
    }

    const instruction = (await beatPrompt(t, sceneId)).debug.blocks.find(
      (b) => b.id === "spotlight_instruction",
    )!;
    expect(instruction.label).toBe("Spotlight instruction");
    expect(instruction.content).toContain(bell.name);
  });
});

/* ------------------------------------------------------------------ */
/* Generating one                                                      */
/* ------------------------------------------------------------------ */

describe("generating a beat", () => {
  test("stores it as one message, parsed into segments", async () => {
    const t = await signedIn();
    const { sceneId } = await groupScene(t);
    const message = await generate(t, sceneId, { scope: "beat" }, THREE_HANDED);

    // The request really did ask for a beat, rather than the label being
    // decided after the fact by what came back.
    expect(adapter.lastPrompt.debug.blocks.find((b) => b.id === "spotlight_instruction")!.label).toBe(
      "Beat instruction",
    );
    expect(message.kind).toBe("beat");
    expect(message.content).toBe(THREE_HANDED);
    expect(message.parseDegraded).toBe(false);
    expect(message.segments!.map((segment) => segment.speakerName)).toEqual([
      "Aldan Roe",
      "Mira Vance",
      "Sister Bell",
    ]);
  });

  test("resolves each speaker to the cast member it names", async () => {
    const t = await signedIn();
    const { bell, aldan, mira, sceneId } = await groupScene(t);
    const message = await generate(t, sceneId, { scope: "beat" }, THREE_HANDED);
    expect(message.segments!.map((segment) => segment.characterId)).toEqual([
      aldan.id,
      mira.id,
      bell.id,
    ]);
  });

  test("keeps an unlabelled beat whole and says the parse failed", async () => {
    const t = await signedIn();
    const { sceneId } = await groupScene(t);
    const prose = "They argued about the lamp until neither of them cared about the lamp.";
    const message = await generate(t, sceneId, { scope: "beat" }, prose);

    // Never discard content because it did not parse (SPEC §3.5).
    expect(message.content).toBe(prose);
    expect(message.parseDegraded).toBe(true);
    expect(message.segments).toHaveLength(1);
    expect(message.segments![0]!.speakerType).toBe("narration");
  });

  test("a spotlight carries no parsed view, because it is its own", async () => {
    const t = await signedIn();
    const { sceneId } = await groupScene(t);
    const message = await generate(t, sceneId, {}, "One line.");
    expect(message.kind).toBe("spotlight");
    expect(message.segments).toBeNull();
  });

  test("the next turn does not repeat whoever the beat ended on", async () => {
    const t = await signedIn();
    const { bell, sceneId } = await groupScene(t);
    await generate(t, sceneId, { scope: "beat" }, THREE_HANDED);

    // The beat is filed under Sister Bell, who opened the cast, but it *ends*
    // on Sister Bell too — and it is the ending that the rule is about.
    const read = await json<SceneWithHistoryDto>(t, "GET", `/api/scenes/${sceneId}`);
    expect(read.nextSpeaker!.characterId).not.toBe(bell.id);
  });

  test("history renders a beat without prefixing it with one speaker", async () => {
    const t = await signedIn();
    const { sceneId } = await groupScene(t);
    await generate(t, sceneId, { scope: "beat" }, THREE_HANDED);
    await generate(t, sceneId, {}, "After.");

    const turns = adapter.lastPrompt.messages.filter((m) => m.role === "assistant");
    const beatTurn = turns.find((turn) => turn.content.includes("Mira Vance"))!;
    // The labels inside the beat are the attribution; a name in front of the
    // whole thing would credit the exchange to whoever opened it.
    expect(beatTurn.content.startsWith("**Aldan Roe:**")).toBe(true);
  });

  test("rejects a bound that is not one", async () => {
    const t = await signedIn();
    const { sceneId } = await groupScene(t);
    expect(
      await statusOf(t, "POST", `/api/scenes/${sceneId}/generate`, {
        scope: "beat",
        beatBound: { kind: "exchanges", count: 900 },
      }),
    ).toBe(400);
  });
});

/* ------------------------------------------------------------------ */
/* Recast                                                              */
/* ------------------------------------------------------------------ */

describe("recasting one part of a beat", () => {
  async function beat(t: TestHarness) {
    const scene = await groupScene(t);
    const message = await generate(t, scene.sceneId, { scope: "beat" }, THREE_HANDED);
    return { ...scene, message };
  }

  async function recast(t: TestHarness, sceneId: string, messageId: string, ordinal: number, text: string) {
    const started = await json<{ id: string }>(
      t,
      "POST",
      `/api/scenes/${sceneId}/messages/${messageId}/recast`,
      { ordinal },
    );
    adapter.push(text);
    adapter.end();
    await until(() => t.generation.get(started.id)?.status === "complete");
    const messages = await json<MessageDto[]>(t, "GET", `/api/scenes/${sceneId}/messages`);
    return messages.at(-1)!;
  }

  test("hands the model the beat as it stands and asks for one part", async () => {
    const t = await signedIn();
    const { sceneId, message } = await beat(t);
    await recast(t, sceneId, message.id, 1, '"You said an hour, and it has been three."');

    const instruction = adapter.lastPrompt.debug.blocks.find(
      (b) => b.id === "spotlight_instruction",
    )!;
    expect(instruction.label).toBe("Recast instruction");
    expect(instruction.content).toContain(THREE_HANDED);
    expect(instruction.content).toContain("Mira Vance's part of it");
    expect(instruction.content).toContain("with no name label");
  });

  test("splices the result in and leaves the rest of the beat alone", async () => {
    const t = await signedIn();
    const { sceneId, message } = await beat(t);
    const updated = await recast(t, sceneId, message.id, 1, '"You said an hour."\n\nShe waited.');

    // Same message, corrected — not a sibling. Swiping is what makes a sibling.
    expect(updated.id).toBe(message.id);
    expect(updated.siblingCount).toBe(1);
    expect(updated.content).toBe(
      [
        "**Aldan Roe:** He set the lamp on the counter, wick still smoking.",
        "",
        '**Mira Vance:** "You said an hour."',
        "",
        "She waited.",
        "",
        "**Sister Bell:** She did not look up from the ledger.",
      ].join("\n"),
    );
    expect(updated.segments!.map((segment) => segment.speakerName)).toEqual([
      "Aldan Roe",
      "Mira Vance",
      "Sister Bell",
    ]);
  });

  test("generates from the beat's own parent, not from the beat", async () => {
    const t = await signedIn();
    const { sceneId, message } = await beat(t);
    await recast(t, sceneId, message.id, 0, "He put the lamp down hard.");

    // The beat is in the instruction, not in the history: it has not happened
    // yet as far as the turn is concerned.
    const assistantTurns = adapter.lastPrompt.messages.filter((m) => m.role === "assistant");
    expect(assistantTurns.some((turn) => turn.content.includes("wick still smoking"))).toBe(false);
  });

  test("refuses to recast narration, and anything that is not a beat", async () => {
    const t = await signedIn();
    const { sceneId } = await groupScene(t);
    const degraded = await generate(t, sceneId, { scope: "beat" }, "Nobody said anything.");
    expect(
      await statusOf(t, "POST", `/api/scenes/${sceneId}/messages/${degraded.id}/recast`, {
        ordinal: 0,
      }),
    ).toBe(422);

    const spotlight = await generate(t, sceneId, {}, "One line.");
    expect(
      await statusOf(t, "POST", `/api/scenes/${sceneId}/messages/${spotlight.id}/recast`, {
        ordinal: 0,
      }),
    ).toBe(400);
  });

  test("rejects a request that does not say which part", async () => {
    const t = await signedIn();
    const { sceneId, message } = await beat(t);
    expect(
      await statusOf(t, "POST", `/api/scenes/${sceneId}/messages/${message.id}/recast`, {}),
    ).toBe(400);
  });
});

/* ------------------------------------------------------------------ */
/* Split                                                               */
/* ------------------------------------------------------------------ */

describe("splitting a beat", () => {
  test("makes one message per part, as a branch beside the beat", async () => {
    const t = await signedIn();
    const { bell, aldan, mira, sceneId } = await groupScene(t);
    const message = await generate(t, sceneId, { scope: "beat" }, THREE_HANDED);

    const after = await json<SceneWithHistoryDto>(
      t,
      "POST",
      `/api/scenes/${sceneId}/messages/${message.id}/split`,
    );

    const tail = after.messages.slice(-3);
    expect(tail.map((m) => m.characterId)).toEqual([aldan.id, mira.id, bell.id]);
    expect(tail.map((m) => m.kind)).toEqual(["spotlight", "spotlight", "spotlight"]);
    expect(tail[0]!.content).toBe("He set the lamp on the counter, wick still smoking.");
    // The beat itself survives — as a sibling of the first split message, which
    // is what makes this a branch rather than a conversion.
    expect(tail[0]!.siblingCount).toBe(2);
    expect(after.messages.some((m) => m.id === message.id)).toBe(false);
  });

  test("the beat is still there to swipe back to", async () => {
    const t = await signedIn();
    const { sceneId } = await groupScene(t);
    const message = await generate(t, sceneId, { scope: "beat" }, THREE_HANDED);
    const after = await json<SceneWithHistoryDto>(
      t,
      "POST",
      `/api/scenes/${sceneId}/messages/${message.id}/split`,
    );

    const first = after.messages.at(-3)!;
    const siblings = await json<MessageDto[]>(
      t,
      "GET",
      `/api/scenes/${sceneId}/messages/${first.id}/siblings`,
    );
    expect(siblings.map((sibling) => sibling.id)).toContain(message.id);
  });

  test("narration in a beat becomes a narrator message", async () => {
    const t = await signedIn();
    const { sceneId } = await groupScene(t);
    const message = await generate(
      t,
      sceneId,
      { scope: "beat" },
      "The lamp guttered.\n\n**Mira Vance:** \"Fix it.\"",
    );
    const after = await json<SceneWithHistoryDto>(
      t,
      "POST",
      `/api/scenes/${sceneId}/messages/${message.id}/split`,
    );

    const tail = after.messages.slice(-2);
    expect(tail.map((m) => m.kind)).toEqual(["narrator", "spotlight"]);
    expect(tail[0]!.characterId).toBeNull();
  });

  test("refuses to split what has nothing to split", async () => {
    const t = await signedIn();
    const { sceneId } = await groupScene(t);
    const spotlight = await generate(t, sceneId, {}, "One line.");
    expect(
      await statusOf(t, "POST", `/api/scenes/${sceneId}/messages/${spotlight.id}/split`),
    ).toBe(400);

    const single = await generate(t, sceneId, { scope: "beat" }, "**Mira Vance:** Alone.");
    expect(await statusOf(t, "POST", `/api/scenes/${sceneId}/messages/${single.id}/split`)).toBe(
      400,
    );
  });
});

/* ------------------------------------------------------------------ */
/* Editing                                                             */
/* ------------------------------------------------------------------ */

describe("editing a beat", () => {
  test("re-parses, so the segments can never describe text that is gone", async () => {
    const t = await signedIn();
    const { sceneId } = await groupScene(t);
    const message = await generate(t, sceneId, { scope: "beat" }, THREE_HANDED);

    const edited = await json<MessageDto>(
      t,
      "PATCH",
      `/api/scenes/${sceneId}/messages/${message.id}`,
      { content: "**Mira Vance:** Only her now.\n\n**Aldan Roe:** And him." },
    );
    expect(edited.segments!.map((segment) => segment.speakerName)).toEqual([
      "Mira Vance",
      "Aldan Roe",
    ]);
  });
});
