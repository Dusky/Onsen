import { afterEach, describe, expect, test } from "bun:test";
import { createHarness, completeSetup, type TestHarness } from "./helpers.ts";
import { buildPromptContext } from "../server/generation/context.ts";
import { buildPrompt } from "../server/prompt/index.ts";
import { OPENAI_COMPATIBLE_CAPABILITIES } from "../server/adapters/index.ts";
import { findScene } from "../server/db/queries/history.ts";
import type { MessageDto, SceneDto, SceneWithHistoryDto } from "../shared/types.ts";

/**
 * The reader's window on a long roleplay (SPEC §5, §20 phase 62).
 *
 * Phase 59 paged the roleplay *list* and left a note saying the message log was
 * a different problem: the log is already virtualised, so this was never render
 * cost — it was a four-hundred-turn roleplay sending four hundred turns of
 * prose, their segments, their annotations and their media on every open.
 *
 * The one thing that must not change is what the author sees. The window is
 * bytes on the wire; everything that builds a prompt walks the whole active
 * path, and the test that matters here is the one that proves those two have
 * not been confused.
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

async function send<T>(
  t: TestHarness,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const response = await t.fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const parsed = response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  return { status: response.status, body: parsed };
}

/** A scene with `count` turns on one straight path. */
async function longScene(t: TestHarness, count: number): Promise<SceneDto> {
  const scene = (await send<SceneDto>(t, "POST", "/api/scenes", { title: "Long" })).body;
  for (let index = 0; index < count; index++) {
    await send(t, "POST", `/api/scenes/${scene.id}/messages`, {
      kind: "user",
      authorType: "user",
      content: `Turn ${index}.`,
    });
  }
  return scene;
}

describe("the window", () => {
  test("sends the newest turns and says how many are behind them", async () => {
    const t = await signedIn();
    const scene = await longScene(t, 30);

    const windowed = await send<SceneWithHistoryDto>(t, "GET", `/api/scenes/${scene.id}?limit=20`);
    expect(windowed.body.messages).toHaveLength(20);
    expect(windowed.body.historyTotal).toBe(30);
    // The *newest* twenty, in order, ending on the last thing said.
    expect(windowed.body.messages[0]!.content).toBe("Turn 10.");
    expect(windowed.body.messages.at(-1)!.content).toBe("Turn 29.");
  });

  test("a window wider than the roleplay is the whole roleplay", async () => {
    const t = await signedIn();
    const scene = await longScene(t, 5);
    const all = await send<SceneWithHistoryDto>(t, "GET", `/api/scenes/${scene.id}?limit=500`);
    expect(all.body.messages).toHaveLength(5);
    expect(all.body.historyTotal).toBe(5);
  });

  test("the first turn of a window keeps its parent", async () => {
    const t = await signedIn();
    const scene = await longScene(t, 30);
    const whole = await send<SceneWithHistoryDto>(t, "GET", `/api/scenes/${scene.id}?limit=100`);
    const windowed = await send<SceneWithHistoryDto>(t, "GET", `/api/scenes/${scene.id}?limit=20`);

    // Reading the parent off the previous row would say this turn is the root
    // of the roleplay, which is a different claim from "its parent is not in
    // this window" and would break every tree operation that trusts it.
    const first = windowed.body.messages[0]!;
    const sameTurn = whole.body.messages.find((message) => message.id === first.id)!;
    expect(first.parentId).toBe(sameTurn.parentId);
    expect(first.parentId).not.toBe(null);

    // And the genuine root still reports none.
    expect(whole.body.messages[0]!.parentId).toBe(null);
  });

  test("an absent limit falls back to the reading preference", async () => {
    const t = await signedIn();
    const scene = await longScene(t, 30);
    // 100 by default, which would send the lot; 20 is the floor the bounds set.
    await send(t, "PATCH", "/api/system/preferences", {
      reading: { scale: 1, measure: 720, leading: 1.5, window: 20 },
    });

    const defaulted = await send<SceneWithHistoryDto>(t, "GET", `/api/scenes/${scene.id}`);
    expect(defaulted.body.messages).toHaveLength(20);
    expect(defaulted.body.historyTotal).toBe(30);
  });

  test("a limit outside the bounds is clamped rather than obeyed", async () => {
    const t = await signedIn();
    const scene = await longScene(t, 25);
    // Below the floor: a window of one turn is not a log, so it becomes 20.
    const tiny = await send<SceneWithHistoryDto>(t, "GET", `/api/scenes/${scene.id}?limit=1`);
    expect(tiny.body.messages).toHaveLength(20);
    // Not a number at all falls back to the preference rather than to zero.
    const junk = await send<SceneWithHistoryDto>(t, "GET", `/api/scenes/${scene.id}?limit=banana`);
    expect(junk.body.messages).toHaveLength(25);
  });
});

describe("what the author sees is not windowed", () => {
  test("the prompt carries the whole path however narrow the window is", async () => {
    const t = await signedIn();
    const character = (await send<{ id: string }>(t, "POST", "/api/characters", { name: "Bell" }))
      .body;
    const scene = await longScene(t, 25);
    await send(t, "PUT", `/api/scenes/${scene.id}/cast/${character.id}`);

    // The reader is looking at five turns.
    const windowed = await send<SceneWithHistoryDto>(t, "GET", `/api/scenes/${scene.id}?limit=20`);
    expect(windowed.body.messages.length).toBeLessThan(windowed.body.historyTotal);

    // The author is given all of them. This is the assertion the phase exists
    // for: a window that reached the prompt builder would silently truncate
    // every long roleplay's memory, and nothing on screen would say so.
    const built = buildPrompt(
      buildPromptContext({
        db: t.ctx.db,
        scene: findScene(t.ctx.db, scene.id)!,
        capabilities: OPENAI_COMPATIBLE_CAPABILITIES,
        now: 0,
        seed: 0,
      }),
    );
    expect(built.debug.historyIncluded.length).toBe(25);
    const transcript = built.messages.map((message) => message.content).join("\n");
    expect(transcript).toContain("Turn 0.");
    expect(transcript).toContain("Turn 24.");
  });
});

describe("the count", () => {
  test("follows the active path rather than the whole tree", async () => {
    const t = await signedIn();
    const scene = await longScene(t, 4);
    const whole = await send<SceneWithHistoryDto>(t, "GET", `/api/scenes/${scene.id}`);
    const second = whole.body.messages[1]!;

    // A branch off the second turn: two more messages exist in the tree, and
    // neither is on the path the reader is on.
    await send<MessageDto>(t, "POST", `/api/scenes/${scene.id}/messages`, {
      kind: "user",
      authorType: "user",
      content: "A different road.",
      parentId: second.id,
    });

    const branched = await send<SceneWithHistoryDto>(t, "GET", `/api/scenes/${scene.id}`);
    expect(branched.body.historyTotal).toBe(branched.body.messages.length);
    expect(branched.body.messages.at(-1)!.content).toBe("A different road.");
  });
});
