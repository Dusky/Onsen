import { afterEach, describe, expect, test } from "bun:test";
import {
  ScriptedAdapter,
  completeSetup,
  createHarness,
  until,
  type TestHarness,
} from "./helpers.ts";
import type {
  ConnectionProfileDto,
  MessageDto,
  PresetDto,
  SceneDto,
  SceneWithHistoryDto,
} from "../shared/types.ts";

/**
 * The two automatic retries (SPEC §7, §20 phase 63).
 *
 * Both are the same shape — a turn came back wrong, run an op that already
 * exists — so neither is a second inference path, and what is tested here is
 * the *deciding*, not the generating:
 *
 *  * auto-continue fires on a reported `length` finish and on nothing else;
 *  * auto-swipe fires on a turn shorter than a floor;
 *  * the budget travels with the chain, so neither can loop.
 *
 * The finish reason is what makes the first honest. A provider that says
 * nothing about why it stopped must not trigger a continue, and the only way
 * to test that is to script a stream that ends without one.
 */

let harness: TestHarness | null = null;
let adapter: ScriptedAdapter;

async function setup(): Promise<{ t: TestHarness; scene: SceneDto; preset: PresetDto }> {
  adapter = new ScriptedAdapter();
  harness = createHarness({ adapter });
  await completeSetup(harness);

  const profiles = (await (
    await harness.fetch("/api/connections/profiles")
  ).json()) as ConnectionProfileDto[];
  const presets = (await (
    await harness.fetch("/api/connections/presets")
  ).json()) as PresetDto[];

  const response = await harness.fetch("/api/scenes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Ridge station",
      connectionProfileId: profiles[0]!.id,
      presetId: presets[0]!.id,
    }),
  });
  return { t: harness, scene: (await response.json()) as SceneDto, preset: presets[0]! };
}

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

async function patchPreset(t: TestHarness, id: string, body: unknown): Promise<PresetDto> {
  const response = await t.fetch(`/api/connections/presets/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response.json()) as PresetDto;
}

async function say(t: TestHarness, scene: SceneDto, content: string): Promise<MessageDto> {
  const response = await t.fetch(`/api/scenes/${scene.id}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "user", authorType: "user", content }),
  });
  return (await response.json()) as MessageDto;
}

async function generate(t: TestHarness, scene: SceneDto): Promise<void> {
  await t.fetch(`/api/scenes/${scene.id}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

async function history(t: TestHarness, scene: SceneDto): Promise<SceneWithHistoryDto> {
  return (await (await t.fetch(`/api/scenes/${scene.id}`)).json()) as SceneWithHistoryDto;
}

/** Every generation this adapter has been asked for a *turn*, not a side call. */
function turnCount(): number {
  return adapter.prompts.filter((prompt) => prompt.debug.blocks.length > 2).length;
}

describe("the setting", () => {
  test("round-trips, and clamps rather than refusing", async () => {
    const { t, preset } = await setup();
    const saved = await patchPreset(t, preset.id, {
      autoContinue: 2,
      autoSwipe: { minChars: 120, attempts: 3 },
    });
    expect(saved.autoContinue).toBe(2);
    expect(saved.autoSwipe).toEqual({ minChars: 120, attempts: 3, onBanned: false });

    // A slider that pins beats a request that fails, as the reading bounds do.
    const clamped = await patchPreset(t, preset.id, {
      autoContinue: 99,
      autoSwipe: { minChars: -5 },
    });
    expect(clamped.autoContinue).toBe(5);
    expect(clamped.autoSwipe.minChars).toBe(0);
  });

  test("ships off", async () => {
    const { preset } = await setup();
    expect(preset.autoContinue).toBe(0);
    expect(preset.autoSwipe.minChars).toBe(0);
  });
});

describe("auto-continue", () => {
  test("carries on when the provider says it ran out of room", async () => {
    const { t, scene, preset } = await setup();
    await patchPreset(t, preset.id, { autoContinue: 1 });
    await say(t, scene, "How short are we?");

    await generate(t, scene);
    await adapter.started;
    adapter.push("The lamp had burned down to a stub and");
    adapter.pushFinish("length");
    adapter.end();

    // The second turn is the continue, and it is the same message carried on
    // rather than a new one beside it.
    await until(() => turnCount() >= 2, { timeoutMs: 4000 });
    adapter.push(" nobody had said anything about it.");
    adapter.end();

    await until(async () => {
      const log = await history(t, scene);
      return log.messages.some((message) => message.content.includes("nobody had said anything"));
    }, { timeoutMs: 4000 });
  });

  test("does not fire when the provider said nothing about why it stopped", async () => {
    const { t, scene, preset } = await setup();
    await patchPreset(t, preset.id, { autoContinue: 2 });
    await say(t, scene, "How short are we?");

    await generate(t, scene);
    await adapter.started;
    // No finish reason at all — the honest reading of silence is "stop".
    adapter.push("The lamp had burned down to a stub");
    adapter.end();

    await until(async () => (await history(t, scene)).messages.length >= 2, { timeoutMs: 4000 });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(turnCount()).toBe(1);
  });

  test("stops at the budget rather than looping", async () => {
    const { t, scene, preset } = await setup();
    await patchPreset(t, preset.id, { autoContinue: 1 });
    await say(t, scene, "How short are we?");

    await generate(t, scene);
    await adapter.started;
    adapter.push("One.");
    adapter.pushFinish("length");
    adapter.end();

    await until(() => turnCount() >= 2, { timeoutMs: 4000 });
    // The continue is cut off too. With a budget of one, that is where it ends.
    adapter.push(" Two.");
    adapter.pushFinish("length");
    adapter.end();

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(turnCount()).toBe(2);
  });

  test("off by default, however the turn ends", async () => {
    const { t, scene } = await setup();
    await say(t, scene, "How short are we?");
    await generate(t, scene);
    await adapter.started;
    adapter.push("Cut off mid-");
    adapter.pushFinish("length");
    adapter.end();

    await until(async () => (await history(t, scene)).messages.length >= 2, { timeoutMs: 4000 });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(turnCount()).toBe(1);
  });
});

describe("auto-swipe", () => {
  test("rerolls a turn that came back too short", async () => {
    const { t, scene, preset } = await setup();
    await patchPreset(t, preset.id, { autoSwipe: { minChars: 40, attempts: 2 } });
    await say(t, scene, "How short are we?");

    await generate(t, scene);
    await adapter.started;
    adapter.push("Short.");
    adapter.end();

    await until(() => turnCount() >= 2, { timeoutMs: 4000 });
    adapter.push("She said it the way you say a word you intend somebody to regret.");
    adapter.end();

    await until(async () => {
      const log = await history(t, scene);
      return log.messages.some((message) => message.content.includes("intend somebody to regret"));
    }, { timeoutMs: 4000 });

    // The rejected turn is still there, as a sibling. A swipe is not a delete:
    // a reader who wanted the short one is one tap away from it.
    const log = await history(t, scene);
    const kept = log.messages.at(-1)!;
    expect(kept.siblingCount).toBeGreaterThan(1);
  });

  test("leaves a long enough turn alone", async () => {
    const { t, scene, preset } = await setup();
    await patchPreset(t, preset.id, { autoSwipe: { minChars: 10, attempts: 2 } });
    await say(t, scene, "How short are we?");

    await generate(t, scene);
    await adapter.started;
    adapter.push("Long enough to be left alone.");
    adapter.end();

    await until(async () => (await history(t, scene)).messages.length >= 2, { timeoutMs: 4000 });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(turnCount()).toBe(1);
  });

  test("gives up at the attempt limit rather than rerolling forever", async () => {
    const { t, scene, preset } = await setup();
    await patchPreset(t, preset.id, { autoSwipe: { minChars: 40, attempts: 1 } });
    await say(t, scene, "How short are we?");

    await generate(t, scene);
    await adapter.started;
    adapter.push("Short.");
    adapter.end();

    await until(() => turnCount() >= 2, { timeoutMs: 4000 });
    adapter.push("Also short.");
    adapter.end();

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(turnCount()).toBe(2);
  });
});

/**
 * The third trigger (§13.6, §20 phase 169).
 *
 * The incumbent rerolls on a blacklisted word; this rerolls on §13.6's own
 * list, which already exists and already excludes proposals — a suggestion
 * nobody accepted must not silently cost a generation.
 *
 * It spends the same `attempts` budget as the length trigger, because two
 * independent budgets is two ways for a scene to spend money in a loop.
 */
async function ban(t: TestHarness, scene: SceneDto, phrase: string): Promise<void> {
  await t.fetch(`/api/scenes/${scene.id}/bans`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phrase, scoped: true }),
  });
}

describe("auto-swipe on a banned phrase", () => {
  test("off by default, however offensive the turn", async () => {
    const { t, scene } = await setup();
    await ban(t, scene, "a mixture of");
    await say(t, scene, "Say the thing.");

    await generate(t, scene);
    await adapter.started;
    adapter.push("Her face was a mixture of emotions she could not name.");
    adapter.end();

    await until(async () => (await history(t, scene)).messages.length >= 2, { timeoutMs: 4000 });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(turnCount()).toBe(1);
  });

  test("rerolls exactly once, and the rejected turn survives as a sibling", async () => {
    const { t, scene, preset } = await setup();
    await patchPreset(t, preset.id, { autoSwipe: { onBanned: true, attempts: 2 } });
    await ban(t, scene, "a mixture of");
    await say(t, scene, "Say the thing.");

    await generate(t, scene);
    await adapter.started;
    adapter.push("Her face was a mixture of emotions she could not name.");
    adapter.end();

    await until(() => turnCount() >= 2, { timeoutMs: 4000 });
    adapter.push("She looked at the door and did not say anything at all.");
    adapter.end();

    await until(async () => {
      const log = await history(t, scene);
      return log.messages.some((message) => message.content.includes("did not say anything"));
    }, { timeoutMs: 4000 });

    // Exactly once: the replacement is clean, so nothing else fires.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(turnCount()).toBe(2);

    // A swipe is not a delete. A reader who wanted the first one is one tap
    // away from it, and they paid for it.
    const log = await history(t, scene);
    expect(log.messages.at(-1)!.siblingCount).toBeGreaterThan(1);
  });

  test("the rejected turn says which phrase did it", async () => {
    /*
     * The whole point of §8 and §13.6 both: a reroll with no stated reason is
     * an arbitrary dice roll. The reason goes on the *rejected* turn, because
     * that is the one a reader swipes back to when they wonder what happened.
     */
    const { t, scene, preset } = await setup();
    await patchPreset(t, preset.id, { autoSwipe: { onBanned: true, attempts: 2 } });
    await ban(t, scene, "a mixture of");
    await say(t, scene, "Say the thing.");

    await generate(t, scene);
    await adapter.started;
    adapter.push("Her face was a mixture of emotions.");
    adapter.end();

    await until(() => turnCount() >= 2, { timeoutMs: 4000 });
    adapter.push("She looked at the door instead.");
    adapter.end();
    await until(async () => {
      const log = await history(t, scene);
      return log.messages.some((message) => message.content.includes("looked at the door"));
    }, { timeoutMs: 4000 });

    // Swipe back to the rejected sibling and read its meta.
    const log = await history(t, scene);
    const leaf = log.messages.at(-1)!;
    const siblings = (await (
      await t.fetch(`/api/scenes/${scene.id}/messages/${leaf.id}/siblings`)
    ).json()) as MessageDto[];
    const rejected = siblings.find((message) => message.content.includes("a mixture of"));
    expect(rejected?.generation?.autoSwipedFor).toBe("a mixture of");
    // And the turn that replaced it carries no such mark.
    expect(leaf.generation?.autoSwipedFor ?? null).toBeNull();
  });

  test("a clean turn is left alone", async () => {
    const { t, scene, preset } = await setup();
    await patchPreset(t, preset.id, { autoSwipe: { onBanned: true, attempts: 2 } });
    await ban(t, scene, "a mixture of");
    await say(t, scene, "Say the thing.");

    await generate(t, scene);
    await adapter.started;
    adapter.push("She looked at the door and said nothing at all.");
    adapter.end();

    await until(async () => (await history(t, scene)).messages.length >= 2, { timeoutMs: 4000 });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(turnCount()).toBe(1);
  });

  test("matches however the phrase is cased, because a ban is a construction", async () => {
    // §13.6's list is phrases a reader put there on purpose — "a mixture of",
    // "a mix of emotions" — not tokens. A list that only matched the exact
    // casing would miss the same sentence at the start of a line.
    const { t, scene, preset } = await setup();
    await patchPreset(t, preset.id, { autoSwipe: { onBanned: true, attempts: 2 } });
    await ban(t, scene, "A Mixture Of");
    await say(t, scene, "Say the thing.");

    await generate(t, scene);
    await adapter.started;
    adapter.push("a mixture of things, honestly, and none of them good.");
    adapter.end();

    await until(() => turnCount() >= 2, { timeoutMs: 4000 });
    adapter.push("Nothing at all, in fact.");
    adapter.end();
    await until(async () => {
      const log = await history(t, scene);
      return log.messages.some((message) => message.content.includes("Nothing at all"));
    }, { timeoutMs: 4000 });
    expect(turnCount()).toBe(2);
  });

  test("shares the length trigger's budget rather than getting its own", async () => {
    // Two independent budgets is two ways for a scene to spend money in a loop.
    const { t, scene, preset } = await setup();
    await patchPreset(t, preset.id, { autoSwipe: { onBanned: true, attempts: 1 } });
    await ban(t, scene, "a mixture of");
    await say(t, scene, "Say the thing.");

    await generate(t, scene);
    await adapter.started;
    adapter.push("Her face was a mixture of emotions.");
    adapter.end();

    await until(() => turnCount() >= 2, { timeoutMs: 4000 });
    // The reroll uses the phrase too. With a budget of one, that is the end.
    adapter.push("Still a mixture of emotions, sorry.");
    adapter.end();

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(turnCount()).toBe(2);
  });

  test("length wins when a turn is both short and banned", async () => {
    // The cheap check first: a string length, where the phrase check reads the
    // ban list out of the database. And "too short" is the more basic
    // complaint, so it is the one recorded.
    const { t, scene, preset } = await setup();
    await patchPreset(t, preset.id, {
      autoSwipe: { minChars: 200, onBanned: true, attempts: 2 },
    });
    await ban(t, scene, "a mixture of");
    await say(t, scene, "Say the thing.");

    await generate(t, scene);
    await adapter.started;
    adapter.push("A mixture of.");
    adapter.end();

    await until(() => turnCount() >= 2, { timeoutMs: 4000 });
    adapter.push("A".repeat(300));
    adapter.end();
    await until(async () => {
      const log = await history(t, scene);
      return log.messages.some((message) => message.content.length > 250);
    }, { timeoutMs: 4000 });

    const log = await history(t, scene);
    const leaf = log.messages.at(-1)!;
    const siblings = (await (
      await t.fetch(`/api/scenes/${scene.id}/messages/${leaf.id}/siblings`)
    ).json()) as MessageDto[];
    const rejected = siblings.find((message) => message.content.includes("A mixture of"));
    // No phrase recorded: it was rerolled for being short, which is legible
    // from the turn itself and from the token count beside it.
    expect(rejected?.generation?.autoSwipedFor ?? null).toBeNull();
  });
});
