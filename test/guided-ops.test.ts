import { afterEach, describe, expect, test } from "bun:test";
import { ScriptedAdapter, completeSetup, createHarness, until, type TestHarness } from "./helpers.ts";
import { V1_CARD, V2_CARD, charxCard, jsonBytes, pngCard } from "./card-fixtures.ts";
import { impersonateQuestion, cleanImpersonation } from "../server/generation/impersonate.ts";
import type {
  AuthorDto,
  CharacterDto,
  ConnectionProfileDto,
  ImpersonateResponse,
  MessageDto,
  PersonaDto,
  SceneDto,
  SceneWithHistoryDto,
} from "../shared/types.ts";
import type { GenerationSnapshot } from "../server/generation/service.ts";

/**
 * Guided ops (SPEC §7, §20 phase 12).
 *
 * Two rules run through all of them. Ephemeral instructions inject at depth 0
 * and are **never persisted as messages** — a scene that fills up with the
 * user's stage directions reads wrong on the next pass. And every op that
 * produces a new version of a turn produces it as a **sibling**, so disliking
 * the result costs a swipe and nothing else.
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

async function scene(t: TestHarness) {
  const author = await json<AuthorDto>(t, "POST", "/api/authors", { name: "Kestrel" });
  const persona = await json<PersonaDto>(t, "POST", "/api/personas", {
    name: "Wren",
    description: "A surveyor waiting out the weather.",
  });
  const characters = [
    await importCharacter(t, pngCard({ chara: V2_CARD }), "bell.png"),
    await importCharacter(t, jsonBytes(V1_CARD), "aldan.json"),
    await importCharacter(
      t,
      charxCard({ ...V2_CARD, data: { ...V2_CARD.data, name: "Mira Vance" } }),
      "mira.charx",
    ),
  ];
  const profiles = await json<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
  const created = await json<SceneDto>(t, "POST", "/api/scenes", {
    title: "Ridge station",
    connectionProfileId: profiles[0]!.id,
  });
  await json<SceneDto>(t, "PATCH", `/api/scenes/${created.id}`, {
    authorId: author.id,
    personaId: persona.id,
  });
  for (const character of characters) {
    await json<SceneDto>(t, "PUT", `/api/scenes/${created.id}/cast/${character.id}`);
  }
  await json(t, "POST", `/api/scenes/${created.id}/messages`, {
    kind: "user",
    authorType: "user",
    content: "Has anyone counted the lamp oil?",
  });
  return { sceneId: created.id, persona, characters };
}

async function run(t: TestHarness, path: string, body: unknown, output: string) {
  const started = await json<GenerationSnapshot>(t, "POST", path, body);
  await adapter.started;
  adapter.push(output);
  adapter.end();
  await until(() => t.generation.get(started.id)?.status === "complete");
  return started;
}

async function messages(t: TestHarness, sceneId: string) {
  return json<MessageDto[]>(t, "GET", `/api/scenes/${sceneId}/messages`);
}

/** The last prompt that was a turn rather than a side call. */
function lastTurnPrompt() {
  return adapter.prompts.filter((prompt) => prompt.debug.blocks.length > 2).at(-1)!;
}

function nearTurn(label: string) {
  return lastTurnPrompt().debug.blocks.find((block) => block.label === label);
}

/* ------------------------------------------------------------------ */
/* Nudge and steer                                                     */
/* ------------------------------------------------------------------ */

describe("nudge — one turn only", () => {
  test("reaches the model near the turn", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await run(t, `/api/scenes/${sceneId}/generate`, { nudge: "Slow the pacing right down." }, "Ok.");

    const block = nearTurn("Nudge")!;
    expect(block.content).toBe("Slow the pacing right down.");
    // Depth 0 is nearest the response, which is where §7 puts every ephemeral
    // instruction.
    expect(block.placement).toEqual({ kind: "depth", depth: 0 });
  });

  test("is never persisted as a message", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    const before = await messages(t, sceneId);
    await run(t, `/api/scenes/${sceneId}/generate`, { nudge: "Make her angrier." }, "Ok.");

    const after = await messages(t, sceneId);
    // One new message: the turn. The direction is not something the reader said.
    expect(after).toHaveLength(before.length + 1);
    expect(after.some((message) => message.content.includes("angrier"))).toBe(false);
  });

  test("is spent — the next turn does not carry it", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await run(t, `/api/scenes/${sceneId}/generate`, { nudge: "Cut it short." }, "Fine.");
    await run(t, `/api/scenes/${sceneId}/generate`, {}, "And again.");
    expect(nearTurn("Nudge")).toBeUndefined();
  });

  test("an empty nudge is no nudge, and a nudge that is not text is refused", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await run(t, `/api/scenes/${sceneId}/generate`, { nudge: "   " }, "Ok.");
    expect(nearTurn("Nudge")).toBeUndefined();
    expect(await statusOf(t, "POST", `/api/scenes/${sceneId}/generate`, { nudge: 7 })).toBe(400);
  });
});

describe("steer — until cleared", () => {
  test("applies to every turn, not just the next one", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await json<SceneDto>(t, "PATCH", `/api/scenes/${sceneId}`, {
      directorNote: "Keep everyone cold and hungry.",
    });

    await run(t, `/api/scenes/${sceneId}/generate`, {}, "One.");
    expect(nearTurn("Steer")!.content).toBe("Keep everyone cold and hungry.");
    await run(t, `/api/scenes/${sceneId}/generate`, {}, "Two.");
    expect(nearTurn("Steer")!.content).toBe("Keep everyone cold and hungry.");
  });

  test("clearing it stops it, and an empty string is a clear", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await json<SceneDto>(t, "PATCH", `/api/scenes/${sceneId}`, { directorNote: "Be brief." });
    const cleared = await json<SceneDto>(t, "PATCH", `/api/scenes/${sceneId}`, {
      directorNote: "  ",
    });
    expect(cleared.directorNote).toBeNull();

    await run(t, `/api/scenes/${sceneId}/generate`, {}, "Ok.");
    expect(nearTurn("Steer")).toBeUndefined();
  });

  test("travels with the scene so the composer can show it", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await json<SceneDto>(t, "PATCH", `/api/scenes/${sceneId}`, { directorNote: "Rain, always." });
    const read = await json<SceneWithHistoryDto>(t, "GET", `/api/scenes/${sceneId}`);
    expect(read.scene.directorNote).toBe("Rain, always.");
  });

  test("rejects a steer that is not text", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    expect(await statusOf(t, "PATCH", `/api/scenes/${sceneId}`, { directorNote: 3 })).toBe(400);
  });
});

describe("guided swipe — a reroll with direction", () => {
  test("makes a sibling of the last turn, carrying the guidance", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await run(t, `/api/scenes/${sceneId}/generate`, {}, "A flat first attempt.");
    const first = (await messages(t, sceneId)).at(-1)!;

    await run(
      t,
      `/api/scenes/${sceneId}/generate`,
      { parentId: first.parentId, nudge: "Less agreeable." },
      "A sharper second attempt.",
    );

    expect(nearTurn("Nudge")!.content).toBe("Less agreeable.");
    const after = (await messages(t, sceneId)).at(-1)!;
    expect(after.siblingCount).toBe(2);
    expect(after.content).toBe("A sharper second attempt.");
  });
});

/* ------------------------------------------------------------------ */
/* Revise: expand, correct, continue                                   */
/* ------------------------------------------------------------------ */

describe("expand", () => {
  test("hands the model what it wrote and asks for more that happens", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await run(t, `/api/scenes/${sceneId}/generate`, {}, "She shrugged.");
    const target = (await messages(t, sceneId)).at(-1)!;

    await run(
      t,
      `/api/scenes/${sceneId}/messages/${target.id}/revise`,
      { mode: "expand" },
      "She shrugged, and did not put the ledger down.",
    );

    const instruction = nearTurn("Expand instruction")!;
    expect(instruction.content).toContain("She shrugged.");
    // "Longer" alone produces padding; the instruction says what to spend it on.
    expect(instruction.content).toContain("Not more words for the same content");
    expect(instruction.content).toContain("keep the same ending");
  });

  test("lands as a sibling, so the original is one swipe away", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await run(t, `/api/scenes/${sceneId}/generate`, {}, "Short.");
    const target = (await messages(t, sceneId)).at(-1)!;
    await run(t, `/api/scenes/${sceneId}/messages/${target.id}/revise`, { mode: "expand" }, "Longer.");

    const after = (await messages(t, sceneId)).at(-1)!;
    expect(after.content).toBe("Longer.");
    expect(after.siblingCount).toBe(2);
    const siblings = await json<MessageDto[]>(
      t,
      "GET",
      `/api/scenes/${sceneId}/messages/${after.id}/siblings`,
    );
    expect(siblings.map((sibling) => sibling.content)).toContain("Short.");
  });

  test("keeps the speaker it was voiced as", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await run(t, `/api/scenes/${sceneId}/generate`, {}, "Hers.");
    const target = (await messages(t, sceneId)).at(-1)!;
    await run(t, `/api/scenes/${sceneId}/messages/${target.id}/revise`, { mode: "expand" }, "Hers, longer.");

    const after = (await messages(t, sceneId)).at(-1)!;
    // A correction that quietly changes who is speaking is not a correction.
    expect(after.characterId).toBe(target.characterId);
  });
});

describe("correct", () => {
  test("names what to change and says to keep the rest", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await run(t, `/api/scenes/${sceneId}/generate`, {}, "She agreed immediately.");
    const target = (await messages(t, sceneId)).at(-1)!;

    await run(
      t,
      `/api/scenes/${sceneId}/messages/${target.id}/revise`,
      { mode: "correct", instructions: "she should refuse" },
      "She did not agree.",
    );

    const instruction = nearTurn("Correction instruction")!;
    expect(instruction.content).toContain("she should refuse");
    expect(instruction.content).toContain("Keep everything that was already working");
    expect(instruction.content).toContain("a correction, not a fresh attempt");
  });

  test("without instructions it is still a correction, not a reroll", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await run(t, `/api/scenes/${sceneId}/generate`, {}, "Flat.");
    const target = (await messages(t, sceneId)).at(-1)!;
    await run(t, `/api/scenes/${sceneId}/messages/${target.id}/revise`, { mode: "correct" }, "Better.");

    const instruction = nearTurn("Correction instruction")!;
    expect(instruction.content).toContain("Write it again, better.");
    expect(instruction.content).toContain("Flat.");
  });
});

describe("continue", () => {
  test("is refused where the provider cannot do it", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await run(t, `/api/scenes/${sceneId}/generate`, {}, "She began to say something");
    const target = (await messages(t, sceneId)).at(-1)!;

    // SPEC §7: disable where unsupported. The OpenAI-compatible adapter cannot
    // accept a partial assistant turn, and a fresh turn dressed as a
    // continuation would be worse than saying no.
    const response = await t.fetch(`/api/scenes/${sceneId}/messages/${target.id}/revise`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "continue" }),
    });
    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toContain("cannot continue");
  });
});

describe("what cannot be revised", () => {
  test("the reader's own message", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    const own = (await messages(t, sceneId))[0]!;
    expect(
      await statusOf(t, "POST", `/api/scenes/${sceneId}/messages/${own.id}/revise`, {
        mode: "expand",
      }),
    ).toBe(422);
  });

  test("a request that does not say which way", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await run(t, `/api/scenes/${sceneId}/generate`, {}, "Something.");
    const target = (await messages(t, sceneId)).at(-1)!;
    expect(
      await statusOf(t, "POST", `/api/scenes/${sceneId}/messages/${target.id}/revise`, {}),
    ).toBe(400);
    expect(
      await statusOf(t, "POST", `/api/scenes/${sceneId}/messages/${target.id}/revise`, {
        mode: "improve",
      }),
    ).toBe(400);
  });
});

/* ------------------------------------------------------------------ */
/* Impersonate                                                         */
/* ------------------------------------------------------------------ */

describe("impersonate — the one op that writes the reader", () => {
  test("expands an outline and never posts it", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    const before = await messages(t, sceneId);
    adapter.taskReply = "I count the barrels twice and say nothing about the second number.";

    const result = await json<ImpersonateResponse>(t, "POST", `/api/scenes/${sceneId}/impersonate`, {
      outline: "count the barrels, keep quiet",
    });
    expect(result.text).toBe(
      "I count the barrels twice and say nothing about the second number.",
    );
    // Never auto-sends. That is what makes writing the reader safe at all.
    expect(await messages(t, sceneId)).toHaveLength(before.length);
  });

  test("the three persons are three different instructions", async () => {
    const question = (person: "first" | "second" | "third") =>
      impersonateQuestion({
        persona: { name: "Wren", description: null },
        outline: "count the barrels",
        person,
        history: [],
        author: "Kestrel",
      });
    expect(question("first")).toContain('"I said"');
    expect(question("second")).toContain('"you said"');
    expect(question("third")).toContain('"Wren said"');
  });

  test("an empty outline is a real ask", async () => {
    const text = impersonateQuestion({
      persona: { name: "Wren", description: null },
      outline: "",
      person: "first",
      history: [],
      author: null,
    });
    expect(text).toContain("has not said what they want to do");
    expect(text).toContain("answers what just happened");
  });

  test("strips the wrapping a model puts around a draft", () => {
    expect(cleanImpersonation("Here is a possible turn:\n\nI put the ledger down.")).toBe(
      "I put the ledger down.",
    );
    expect(cleanImpersonation('"I put the ledger down."')).toBe("I put the ledger down.");
    // Dialogue inside the turn is not a wrapper and must survive.
    expect(cleanImpersonation('I said, "count them again," and waited.')).toBe(
      'I said, "count them again," and waited.',
    );
  });

  test("a failure says what happened rather than posting nothing", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    adapter.taskFails = true;
    const response = await t.fetch(`/api/scenes/${sceneId}/impersonate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outline: "say nothing" }),
    });
    adapter.taskFails = false;

    expect(response.status).toBe(502);
    const body = (await response.json()) as ImpersonateResponse;
    expect(body.text).toBeNull();
    expect(body.detail).toContain("unreachable");
  });
});
