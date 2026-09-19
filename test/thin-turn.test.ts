import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ScriptedAdapter, completeSetup, createHarness, until, type TestHarness } from "./helpers.ts";
import { V2_CARD, pngCard } from "./card-fixtures.ts";
import type {
  GenerationEvent,
  GenerationSnapshot,
} from "../server/generation/service.ts";
import type { FinishReason } from "../server/adapters/index.ts";
import type {
  CharacterDto as Card,
  ConnectionProfileDto,
  SceneDto,
  SceneWithHistoryDto,
} from "../shared/types.ts";

/**
 * A turn that produces nothing says so (§20 phase 224).
 *
 * Found by driving the app against a reasoning model. `deepseek-flash` bills
 * its thinking against the same `max_tokens` the prompt builder reserved for
 * the reply — which phase 196 correctly started sending — so a turn can spend
 * its whole budget thinking. Twice, with a fixed wait so nothing was cut short,
 * that produced: the reader's own message sitting there, Stop gone, **no
 * assistant message, no error, and nothing in any log**. The only move left was
 * to send again and pay for it.
 *
 * `finish()` was right not to write an empty message and wrong to say nothing.
 * It had every number needed to explain itself — the buffer, the reasoning, the
 * finish reason and the reserve — and passed none of them on.
 *
 * Scripted rather than live, because a scripted stream is exactly what hid this
 * for so long: every existing generation test pushes prose, so none of them
 * ever produced the shape that breaks.
 */

let harness: TestHarness | null = null;
let adapter: ScriptedAdapter;

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

async function signedIn(): Promise<TestHarness> {
  if (harness === null) {
    adapter = new ScriptedAdapter();
    harness = createHarness({ adapter });
    await completeSetup(harness);
  }
  return harness;
}

async function json<T>(t: TestHarness, method: string, path: string, body?: unknown): Promise<T> {
  const response = await t.fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  return (await response.json()) as T;
}

async function scene(t: TestHarness) {
  const form = new FormData();
  form.append("file", new File([pngCard({ chara: V2_CARD }) as unknown as BlobPart], "bell.png"));
  const { character } = (await (
    await t.fetch("/api/characters/import", { method: "POST", body: form })
  ).json()) as { character: Card };

  const profiles = await json<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
  const created = await json<SceneDto>(t, "POST", "/api/scenes", {
    title: "The lamp oil",
    connectionProfileId: profiles[0]!.id,
  });
  await json<SceneDto>(t, "PUT", `/api/scenes/${created.id}/cast/${character.id}`);
  await json(t, "POST", `/api/scenes/${created.id}/messages`, {
    kind: "user",
    authorType: "user",
    content: "Anyone counted the lamp oil?",
  });
  return created.id;
}

/** Run one turn from a script of prose and reasoning, and hand back its id. */
async function generate(
  t: TestHarness,
  sceneId: string,
  pieces: (string | { think: string } | { finish: FinishReason })[],
): Promise<string> {
  const started = await json<GenerationSnapshot>(t, "POST", `/api/scenes/${sceneId}/generate`, {});
  await adapter.started;
  for (const piece of pieces) {
    if (typeof piece === "string") adapter.push(piece);
    else if ("think" in piece) adapter.pushReasoning(piece.think);
    else adapter.pushFinish(piece.finish);
  }
  adapter.end();
  await until(() => t.generation.get(started.id)?.status === "complete");
  return started.id;
}

/**
 * The `done` event a client would receive, read the way one reads it.
 *
 * `subscribe` replays the terminal event to anyone who joins after the end,
 * which is what a reconnecting client relies on — so this is the same path the
 * app takes, not a private field reached into.
 */
function terminalOf(t: TestHarness, id: string) {
  let seen: GenerationEvent | null = null;
  const stop = t.generation.subscribe(id, Number.MAX_SAFE_INTEGER, (event) => {
    if (event.type === "done" || event.type === "cancelled" || event.type === "error") {
      seen = event;
    }
  });
  stop?.();
  return seen as GenerationEvent | null;
}

/** The turns actually on the scene's path. */
async function turns(t: TestHarness, sceneId: string): Promise<number> {
  const read = await json<SceneWithHistoryDto>(t, "GET", `/api/scenes/${sceneId}`);
  return read.messages.length;
}

describe("a turn that lands nothing", () => {
  test("lands nothing, and the done event says why", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    const before = await turns(t, sceneId);

    // The shape the live model produced: thinking, and not one word of story.
    const id = await generate(t, sceneId, [{ think: "Let me consider what she would say." }]);

    // Still right not to write an empty message.
    expect(await turns(t, sceneId)).toBe(before);

    const snapshot = t.generation.get(id)!;
    expect(snapshot.status).toBe("complete");
    expect(snapshot.messageId).toBeNull();

    // And now it explains itself, on the turn's own terminal event.
    const event = terminalOf(t, id);
    expect(event).toMatchObject({ type: "done", messageId: "" });
    expect(event?.type === "done" ? event.thin : null).toMatchObject({
      kind: "empty",
      proseChars: 0,
    });
  });

  test("the explanation carries the numbers a reader can act on", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    const id = await generate(t, sceneId, [{ think: "a long deliberation, and no prose at all" }]);

    const event = terminalOf(t, id);
    const thin = event?.type === "done" ? event.thin : null;
    // Without the numbers this is the app guessing. "It spent N characters
    // thinking and wrote none" is a diagnosis; "the reply was short" is not.
    expect(thin!.reasoningChars).toBeGreaterThan(0);
    expect(thin!.reserved).toBeGreaterThan(0);
  });
});

describe("a turn that lands a fragment", () => {
  test("a few words after a wall of reasoning is called a stub", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    // The live measurement was 77 characters of prose after 4075 of reasoning,
    // cut off by the cap — which is the mechanism, so the script says so.
    const id = await generate(t, sceneId, [
      { think: "x".repeat(4000) },
      "She set it down.",
      { finish: "length" as const },
    ]);

    const event = terminalOf(t, id);
    const thin = event?.type === "done" ? event.thin : null;
    expect(thin).toMatchObject({ kind: "stub" });
    expect(thin!.proseChars).toBe("She set it down.".length);
    // The turn still landed — a fragment is the reader's text and is kept.
    expect(await turns(t, sceneId)).toBeGreaterThan(1);
  });

  test("a short turn that stopped on its own is left alone", async () => {
    // The distinction the mechanism draws: a model that chose to write one
    // line chose to write one line, and the app has no business second-guessing
    // it. Only a turn the cap cut off is diagnosed.
    const t = await signedIn();
    const sceneId = await scene(t);
    const id = await generate(t, sceneId, [
      { think: "x".repeat(4000) },
      "She set it down.",
    ]);
    const event = terminalOf(t, id);
    expect(event?.type === "done" ? event.thin : "missing").toBeNull();
  });

  test("an ordinary turn is not diagnosed", async () => {
    // The guard that keeps this from crying wolf. A model that wrote a normal
    // reply, with or without thinking, must produce no explanation at all.
    const t = await signedIn();
    const sceneId = await scene(t);
    const prose =
      "Elira looked up from the ledger and counted along the shelf, twice, before she answered. " +
      "The lamps had been filled on the day the road closed and not since.";
    const plain = await generate(t, sceneId, [prose]);
    const thought = await generate(t, sceneId, [{ think: "briefly" }, prose]);

    for (const id of [plain, thought]) {
      const event = terminalOf(t, id);
      expect(event?.type === "done" ? event.thin : "missing").toBeNull();
    }
  });
});

describe("the reader is told, in words, with the setting to change", () => {
  test("both sentences name the response cap", () => {
    // The only actionable half. A reader who is told a turn was empty and not
    // told what to change has been informed, not helped.
    const { strings } = require("../client/strings.ts") as typeof import("../client/strings.ts");
    const empty = strings.chat.thinTurnEmpty(4075, 1024);
    const stub = strings.chat.thinTurnStub(77, 4075);
    for (const line of [empty, stub]) {
      expect(line).toContain("response cap");
    }
    expect(empty).toContain("1024");
    expect(empty).toContain("4075");
    expect(stub).toContain("77");
  });

  test("the client posts a notice off the done event, not a second request", () => {
    // Carried on the terminal event precisely so the explanation costs nothing
    // — the reader has already waited once.
    const source = readFileSync("client/lib/generation.ts", "utf8");
    expect(source).toContain("event.thin");
    expect(source).toContain("thinTurnEmpty");
    expect(source).toContain("thinTurnStub");
  });
});
