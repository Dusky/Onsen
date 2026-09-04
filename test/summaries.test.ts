import { afterEach, describe, expect, test } from "bun:test";
import {
  ScriptedAdapter,
  completeSetup,
  createHarness,
  until,
  type TestHarness,
} from "./helpers.ts";
import { V2_CARD_SILENT, pngCard } from "./card-fixtures.ts";
import { cleanSummary, summaryQuestion } from "../server/summaries/runner.ts";
import { defaultTemplateOf } from "../server/prompt/index.ts";
import {
  GUIDE_KINDS,
  RESUMMARISE,
  SUMMARISE,
  guideOpKey,
  opKind,
} from "../server/tasks/registry.ts";
import { buildPromptContext } from "../server/generation/context.ts";
import { buildPrompt } from "../server/prompt/index.ts";
import { OPENAI_COMPATIBLE_CAPABILITIES } from "../server/adapters/index.ts";
import { findScene } from "../server/db/queries/history.ts";
import {
  injectedSummaries,
  pendingForSummary,
  summaryIsDue,
} from "../server/db/queries/summaries.ts";
import type {
  CharacterDto,
  ConnectionProfileDto,
  MessageDto,
  SceneDto,
  SummaryStateDto,
  TaskDto,
} from "../shared/types.ts";

/**
 * Rolling summarisation (SPEC §11 layer 1, §20 phase 16).
 *
 * Three of §11's knobs interact and the order they are applied in is the whole
 * behaviour — freeze, then threshold, then eviction — so most of what is worth
 * testing here is which summaries reach the prompt and which turns they replace.
 */

let harness: TestHarness | null = null;
let adapter: ScriptedAdapter;

async function signedIn(): Promise<TestHarness> {
  if (harness === null) {
    adapter = new ScriptedAdapter();
    harness = createHarness({ adapter });
    await completeSetup(harness);
    // The guides run behind every turn by default and would answer the
    // summariser's calls; this file is not about them.
    for (const kind of GUIDE_KINDS) {
      await json<TaskDto>(harness, "PATCH", `/api/tasks/${guideOpKey(kind)}`, {
        autoTrigger: false,
      });
    }
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

/** A scene with `turns` messages already in it, alternating reader and reply. */
async function sceneWith(t: TestHarness, turns: number, settings: Record<string, unknown> = {}) {
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
  if (Object.keys(settings).length > 0) {
    // Asserted rather than fired and forgotten: a setting outside its bounds
    // comes back 400, and a test that ignored that would quietly be measuring
    // the defaults.
    const status = await statusOf(t, "PATCH", `/api/scenes/${created.id}`, settings);
    expect(status, JSON.stringify(settings)).toBe(200);
  }

  const messages: MessageDto[] = [];
  for (let at = 0; at < turns; at += 1) {
    messages.push(
      await json<MessageDto>(t, "POST", `/api/scenes/${created.id}/messages`, {
        kind: at % 2 === 0 ? "user" : "spotlight",
        authorType: at % 2 === 0 ? "user" : "character",
        content:
          at % 2 === 0
            ? `Reader turn ${at}: has anyone counted the lamp oil?`
            : `Reply turn ${at}: she did not look up from the ledger.`,
      }),
    );
  }
  return { sceneId: created.id, messages };
}

/**
 * Answer only the summariser, so a test pays for nothing else.
 *
 * Summarising and condensing reach the same adapter, and a test about one of
 * them needs to be able to say nothing about the other — so the fold gets its
 * own reply, told apart by the words its own template uses.
 */
function scriptSummaries(reply: string, fold?: string) {
  adapter.taskReplyFor = (prompt) => {
    if (prompt.debug.blocks[0]?.label !== "Summary") return null;
    const question = prompt.messages[0]?.content ?? "";
    const isFold = question.includes("several summaries of consecutive stretches");
    return isFold ? (fold ?? null) : reply;
  };
}

function sceneRow(t: TestHarness, sceneId: string) {
  const row = findScene(t.ctx.db, sceneId);
  if (row === null) throw new Error("no scene");
  return row;
}

function promptFor(t: TestHarness, sceneId: string) {
  const scene = sceneRow(t, sceneId);
  return buildPrompt(
    buildPromptContext({
      db: t.ctx.db,
      scene,
      capabilities: OPENAI_COMPATIBLE_CAPABILITIES,
      now: Date.now(),
      seed: 1,
    }),
  );
}

describe("the ops", () => {
  test("summarising and condensing are both side calls with words of their own", async () => {
    const t = await signedIn();
    const tasks = await json<TaskDto[]>(t, "GET", "/api/tasks");
    for (const key of [SUMMARISE, RESUMMARISE]) {
      const task = tasks.find((row) => row.key === key);
      expect(task, key).toBeDefined();
      expect(task!.runs).toBe("side_call");
      // §11: a cheap model is fine here, which only means anything if it can be
      // routed somewhere of its own.
      expect(task!.defaultTemplate.length).toBeGreaterThan(0);
      expect(opKind(key)?.stage).toBe("post_generation");
    }
  });

  test("the summariser is shown the earlier record and told not to repeat it", () => {
    const template = defaultTemplateOf(SUMMARISE);
    expect(template).toContain("{{transcript}}");
    expect(template).toContain("{{previous}}");
    // The failure mode this guards: a summariser handed its own last output
    // restates it, and the block grows without bound.
    expect(template.toLowerCase()).toContain("do not repeat");
  });

  test("the summariser is told to keep specifics, not to write a blurb", () => {
    const template = defaultTemplateOf(SUMMARISE).toLowerCase();
    expect(template).toContain("names");
    expect(template).toContain("no headings");
    // A record of a story still going must not be rounded off.
    expect(template).toContain("conclusion");
  });

  test("a model's preamble is trimmed off the record", () => {
    expect(cleanSummary("Here is a summary of the stretch:\n\nThey argued.")).toBe("They argued.");
    expect(cleanSummary("Summary: they argued.")).toBe("they argued.");
    expect(cleanSummary("  They argued.  ")).toBe("They argued.");
  });

  test("the question carries the transcript and the previous record", () => {
    const question = summaryQuestion(defaultTemplateOf(SUMMARISE), {
      transcript: "Bell: two thirds of a barrel.",
      previous: "Earlier: they started counting.",
    });
    expect(question).toContain("two thirds of a barrel");
    expect(question).toContain("they started counting");
    expect(question).not.toContain("{{");
  });
});

describe("when it runs", () => {
  test("neither threshold reached, nothing is due", async () => {
    const t = await signedIn();
    const { sceneId } = await sceneWith(t, 6);
    const scene = sceneRow(t, sceneId);
    const pending = pendingForSummary(t.ctx.db, scene);
    // Six messages, and the threshold protects the last twenty: nothing is even
    // old enough to be pending.
    expect(pending.length).toBe(0);
    expect(summaryIsDue(pending, scene)).toBe(false);
  });

  test("the message threshold fires", async () => {
    const t = await signedIn();
    const { sceneId } = await sceneWith(t, 30, {
      summariseEveryMessages: 4,
      summariseThreshold: 20,
      summariseEveryWords: 100000,
    });
    const scene = sceneRow(t, sceneId);
    const pending = pendingForSummary(t.ctx.db, scene);
    expect(pending.length).toBe(10);
    expect(summaryIsDue(pending, scene)).toBe(true);
  });

  test("the word threshold fires on its own, with too few messages to count", async () => {
    const t = await signedIn();
    const { sceneId } = await sceneWith(t, 34, {
      // Never on message count: fourteen is nowhere near five hundred.
      summariseEveryMessages: 500,
      summariseEveryWords: 100,
      summariseThreshold: 20,
    });
    const scene = sceneRow(t, sceneId);
    const pending = pendingForSummary(t.ctx.db, scene);
    expect(pending.length).toBe(14);
    // §11: whichever comes first, and volume is the one that came first here.
    expect(summaryIsDue(pending, scene)).toBe(true);
  });

  test("the threshold's tail is never summarised", async () => {
    const t = await signedIn();
    const { sceneId, messages } = await sceneWith(t, 30, { summariseThreshold: 20 });
    const scene = sceneRow(t, sceneId);
    const pending = pendingForSummary(t.ctx.db, scene);
    // Ten summarisable, twenty protected — and the protected ones are the last
    // twenty, not any twenty.
    expect(pending.length).toBe(10);
    expect(pending.at(-1)!.ulid).toBe(messages[9]!.id);
  });
});

describe("writing one", () => {
  test("a manual run summarises what is waiting and reports it", async () => {
    const t = await signedIn();
    const { sceneId } = await sceneWith(t, 30, { summariseThreshold: 20 });
    scriptSummaries("They counted the oil and came up short. Mira suspects Aldan.");

    const state = await json<SummaryStateDto>(t, "POST", `/api/scenes/${sceneId}/summaries`);
    expect(state.summaries.length).toBe(1);
    expect(state.summaries[0]!.content).toContain("came up short");
    expect(state.summaries[0]!.messageCount).toBe(10);
    // Written, but not yet used: it covers messages inside the last twenty.
    expect(state.injectedIds).toEqual([]);
    expect(state.pendingMessages).toBe(0);
  });

  test("an empty reply does not mark the range summarised", async () => {
    const t = await signedIn();
    const { sceneId } = await sceneWith(t, 30, { summariseThreshold: 20 });
    scriptSummaries("   ");

    const state = await json<SummaryStateDto>(t, "POST", `/api/scenes/${sceneId}/summaries`);
    expect(state.summaries.length).toBe(0);
    // The turns are still waiting, rather than hidden behind a paragraph that
    // says nothing.
    expect(state.pendingMessages).toBe(10);
  });

  test("a failing model costs nothing but the log", async () => {
    const t = await signedIn();
    const { sceneId } = await sceneWith(t, 30, { summariseThreshold: 20 });
    adapter.taskFails = true;

    const state = await json<SummaryStateDto>(t, "POST", `/api/scenes/${sceneId}/summaries`);
    expect(state.summaries.length).toBe(0);
    expect(state.pendingMessages).toBe(10);
    adapter.taskFails = false;
  });

  test("the second run is shown the first one and covers only what is new", async () => {
    const t = await signedIn();
    const { sceneId } = await sceneWith(t, 30, { summariseThreshold: 20 });
    scriptSummaries("First stretch: they started counting.");
    await json<SummaryStateDto>(t, "POST", `/api/scenes/${sceneId}/summaries`);

    // Ten more turns arrive, so ten more become summarisable.
    for (let at = 0; at < 10; at += 1) {
      await json<MessageDto>(t, "POST", `/api/scenes/${sceneId}/messages`, {
        kind: "user",
        authorType: "user",
        content: `Later turn ${at}.`,
      });
    }

    let shownPrevious = "";
    adapter.taskReplyFor = (prompt) => {
      if (prompt.debug.blocks[0]?.label !== "Summary") return null;
      shownPrevious = prompt.messages[0]?.content ?? "";
      return "Second stretch: the shortfall was confirmed.";
    };
    const state = await json<SummaryStateDto>(t, "POST", `/api/scenes/${sceneId}/summaries`);

    expect(state.summaries.length).toBe(2);
    expect(shownPrevious).toContain("they started counting");
    // Ten new messages, not the whole scene again.
    expect(state.summaries[1]!.messageCount).toBe(10);
  });
});

describe("what reaches the prompt", () => {
  /** A scene with one summary covering its first ten of thirty-plus messages. */
  async function summarised(t: TestHarness, turns: number, settings: Record<string, unknown>) {
    const made = await sceneWith(t, turns, { summariseThreshold: 20, ...settings });
    scriptSummaries("They counted the oil and came up short.");
    await json<SummaryStateDto>(t, "POST", `/api/scenes/${made.sceneId}/summaries`);
    return made;
  }

  test("a summary inside the threshold is written but not injected", async () => {
    const t = await signedIn();
    const { sceneId } = await summarised(t, 30, {});
    const built = promptFor(t, sceneId);
    expect(built.debug.blocks.find((b) => b.id === "summaries")).toBeUndefined();
  });

  test("once it is old enough, the prompt carries it", async () => {
    const t = await signedIn();
    // Threshold of two: the summary's range ends well before the frozen end.
    const { sceneId } = await summarised(t, 30, { summariseFreeze: 1 });
    await json<SceneDto>(t, "PATCH", `/api/scenes/${sceneId}`, { summariseThreshold: 2 });

    const built = promptFor(t, sceneId);
    const block = built.debug.blocks.find((b) => b.id === "summaries");
    expect(block).toBeDefined();
    expect(block!.content).toContain("came up short");
    expect(block!.tokens).toBeGreaterThan(0);
  });

  test("summarise off means nothing is injected, whatever is stored", async () => {
    const t = await signedIn();
    const { sceneId } = await summarised(t, 30, { summariseFreeze: 1 });
    await json<SceneDto>(t, "PATCH", `/api/scenes/${sceneId}`, {
      summariseThreshold: 2,
      summarise: false,
    });
    const built = promptFor(t, sceneId);
    expect(built.debug.blocks.find((b) => b.id === "summaries")).toBeUndefined();
  });

  test("by default the turns are shown as well as summarised", async () => {
    const t = await signedIn();
    const { sceneId, messages } = await summarised(t, 30, { summariseFreeze: 1 });
    await json<SceneDto>(t, "PATCH", `/api/scenes/${sceneId}`, { summariseThreshold: 2 });

    const built = promptFor(t, sceneId);
    // Nothing was dropped: raw eviction is off, which costs the most and loses
    // the least.
    expect(built.debug.historyIncluded).toContain(messages[0]!.id);
    expect(built.debug.evicted.filter((item) => item.reason === "summarized")).toEqual([]);
  });

  test("raw eviction drops the covered turns and says so", async () => {
    const t = await signedIn();
    const { sceneId, messages } = await summarised(t, 30, { summariseFreeze: 1 });
    await json<SceneDto>(t, "PATCH", `/api/scenes/${sceneId}`, {
      summariseThreshold: 2,
      summariseEvict: true,
    });

    const built = promptFor(t, sceneId);
    const dropped = built.debug.evicted.filter((item) => item.reason === "summarized");
    expect(dropped.length).toBeGreaterThan(0);
    expect(built.debug.historyIncluded).not.toContain(messages[1]!.id);
    // §3: what was trimmed is reported, with its cost, or the user cannot
    // discover why the character forgot.
    expect(dropped[0]!.tokens).toBeGreaterThan(0);
  });

  test("eviction always keeps the last thing the reader said", async () => {
    const t = await signedIn();
    const { sceneId } = await summarised(t, 30, { summariseFreeze: 1 });
    // A threshold of zero puts every message inside a covered range, which is
    // the case that would otherwise leave the turn with nothing to answer.
    await json<SceneDto>(t, "PATCH", `/api/scenes/${sceneId}`, {
      summariseThreshold: 0,
      summariseEvict: true,
    });
    scriptSummaries("Everything so far.");
    await json<SummaryStateDto>(t, "POST", `/api/scenes/${sceneId}/summaries`);

    const read = await json<{ messages: MessageDto[] }>(t, "GET", `/api/scenes/${sceneId}`);
    const lastUser = read.messages.filter((m) => m.authorType === "user").at(-1)!;
    const built = promptFor(t, sceneId);
    expect(built.debug.historyIncluded).toContain(lastUser.id);
  });
});

describe("the cache freeze", () => {
  test("the injection point holds still between windows", async () => {
    const t = await signedIn();
    const { sceneId } = await sceneWith(t, 30, {
      summariseThreshold: 8,
      summariseFreeze: 5,
    });
    scriptSummaries("They counted the oil.");
    await json<SummaryStateDto>(t, "POST", `/api/scenes/${sceneId}/summaries`);

    const before = injectedSummaries(t.ctx.db, sceneRow(t, sceneId)).summaries.length;
    // One more message: without a freeze this could change what is injected.
    await json<MessageDto>(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "One more.",
    });
    const after = injectedSummaries(t.ctx.db, sceneRow(t, sceneId)).summaries.length;
    expect(after).toBe(before);
  });

  test("a freeze holds the injection point a window behind a freeze of one", async () => {
    const t = await signedIn();
    // Thirty messages, a summary covering the first ten, and the last twenty
    // protected by the threshold — so the summary becomes usable at exactly
    // thirty messages, and the only question is whether the freeze has caught
    // up to that yet.
    const { sceneId } = await sceneWith(t, 30, { summariseThreshold: 20, summariseFreeze: 4 });
    scriptSummaries("They counted the oil.");
    await json<SummaryStateDto>(t, "POST", `/api/scenes/${sceneId}/summaries`);

    // Frozen at twenty-eight, so the prompt is still one window behind.
    expect(injectedSummaries(t.ctx.db, sceneRow(t, sceneId)).summaries.length).toBe(0);

    // Unfrozen, the same scene injects it immediately. That is the trade §11
    // describes: a little staleness, bought with a stable prefix.
    await json<SceneDto>(t, "PATCH", `/api/scenes/${sceneId}`, { summariseFreeze: 1 });
    expect(injectedSummaries(t.ctx.db, sceneRow(t, sceneId)).summaries.length).toBe(1);
  });
});

describe("the tree", () => {
  test("rewinding past a range un-injects its summary", async () => {
    const t = await signedIn();
    const { sceneId, messages } = await sceneWith(t, 30, {
      summariseThreshold: 2,
      summariseFreeze: 1,
    });
    scriptSummaries("They counted the oil.");
    await json<SummaryStateDto>(t, "POST", `/api/scenes/${sceneId}/summaries`);
    expect(injectedSummaries(t.ctx.db, sceneRow(t, sceneId)).summaries.length).toBe(1);

    // Rewind to before the summarised range ends.
    await json(t, "PUT", `/api/scenes/${sceneId}/leaf`, {
      messageId: messages[3]!.id,
      descend: false,
    });
    expect(injectedSummaries(t.ctx.db, sceneRow(t, sceneId)).summaries.length).toBe(0);
  });

  test("a summary written on one branch is not on the other", async () => {
    const t = await signedIn();
    const { sceneId, messages } = await sceneWith(t, 30, {
      summariseThreshold: 2,
      summariseFreeze: 1,
    });
    scriptSummaries("Branch one: they counted the oil.");
    await json<SummaryStateDto>(t, "POST", `/api/scenes/${sceneId}/summaries`);

    // Branch away from message 3 and build a second path.
    await json(t, "PUT", `/api/scenes/${sceneId}/leaf`, {
      messageId: messages[3]!.id,
      descend: false,
    });
    for (let at = 0; at < 8; at += 1) {
      await json<MessageDto>(t, "POST", `/api/scenes/${sceneId}/messages`, {
        kind: "user",
        authorType: "user",
        content: `Other branch ${at}.`,
      });
    }
    const onBranch = await json<SummaryStateDto>(t, "GET", `/api/scenes/${sceneId}/summaries`);
    expect(onBranch.summaries).toEqual([]);

    // And it is still there when the reader goes back.
    await json(t, "PUT", `/api/scenes/${sceneId}/leaf`, {
      messageId: messages.at(-1)!.id,
      descend: false,
    });
    const back = await json<SummaryStateDto>(t, "GET", `/api/scenes/${sceneId}/summaries`);
    expect(back.summaries.length).toBe(1);
  });
});

describe("condensing them", () => {
  /**
   * §11: "summaries stack: older summaries can be re-summarised when they
   * themselves grow past a budget." The budget is in tokens, so the fixture
   * writes summaries big enough that four of them cross it and three do not.
   */
  const BULKY = "They counted the barrels and argued about the count. ".repeat(28);

  /** Three summaries, which is one short of crossing the fold's budget. */
  async function threeSummaries(t: TestHarness) {
    const made = await sceneWith(t, 30, { summariseThreshold: 20, summariseEveryMessages: 2 });
    for (let round = 0; round < 3; round += 1) {
      scriptSummaries(`${BULKY} Stretch ${round}.`);
      await json<SummaryStateDto>(t, "POST", `/api/scenes/${made.sceneId}/summaries`);
      for (let at = 0; at < 5; at += 1) {
        await json<MessageDto>(t, "POST", `/api/scenes/${made.sceneId}/messages`, {
          kind: "user",
          authorType: "user",
          content: `Filler ${round}-${at}.`,
        });
      }
    }
    const state = await json<SummaryStateDto>(t, "GET", `/api/scenes/${made.sceneId}/summaries`);
    // The fixture itself is the assertion that the budget has not been crossed:
    // if it ever starts folding early, these tests would be testing nothing.
    expect(state.summaries.length).toBe(3);
    expect(state.summaries.every((row) => row.level === 0)).toBe(true);
    return made;
  }

  test("past the budget, the oldest run is folded into one", async () => {
    const t = await signedIn();
    const { sceneId } = await threeSummaries(t);

    // A fourth crosses the budget, and the fold comes back short.
    scriptSummaries(`${BULKY} Stretch 3.`, "All of it, briefly: they counted and came up short.");
    const after = await json<SummaryStateDto>(t, "POST", `/api/scenes/${sceneId}/summaries`);

    const folded = after.summaries.find((row) => row.level > 0);
    expect(folded).toBeDefined();
    // Four became one, and it covers everything the four covered between them:
    // the first stretch of ten, then three of five.
    expect(after.summaries.length).toBe(1);
    expect(folded!.content).toContain("came up short");
    expect(folded!.messageCount).toBe(25);
  });

  test("a fold that came back longer than its input is thrown away", async () => {
    const t = await signedIn();
    const { sceneId } = await threeSummaries(t);

    // The fold answers with more than went in, which condenses nothing.
    scriptSummaries(`${BULKY} Stretch 3.`, BULKY.repeat(5));
    const after = await json<SummaryStateDto>(t, "POST", `/api/scenes/${sceneId}/summaries`);

    expect(after.summaries.some((row) => row.level > 0)).toBe(false);
    expect(after.summaries.length).toBe(4);
  });

  test("an unreadable fold leaves the summaries alone", async () => {
    const t = await signedIn();
    const { sceneId } = await threeSummaries(t);

    // No reply to the fold at all.
    scriptSummaries(`${BULKY} Stretch 3.`);
    const after = await json<SummaryStateDto>(t, "POST", `/api/scenes/${sceneId}/summaries`);
    expect(after.summaries.length).toBe(4);
    expect(after.summaries.some((row) => row.level > 0)).toBe(false);
  });

  test("an edited summary is never folded away", async () => {
    const t = await signedIn();
    const { sceneId } = await threeSummaries(t);
    const before = await json<SummaryStateDto>(t, "GET", `/api/scenes/${sceneId}/summaries`);
    const oldest = before.summaries[0]!;
    await json<SummaryStateDto>(t, "PATCH", `/api/scenes/${sceneId}/summaries/${oldest.id}`, {
      content: "My own words about the first stretch.",
    });

    scriptSummaries(`${BULKY} Stretch 3.`, "All of it, briefly.");
    const after = await json<SummaryStateDto>(t, "POST", `/api/scenes/${sceneId}/summaries`);

    // §11 marks edits so regeneration does not clobber them, and a fold is
    // regeneration by another name. It survives, whatever that costs.
    const kept = after.summaries.find((row) => row.id === oldest.id);
    expect(kept).toBeDefined();
    expect(kept!.content).toBe("My own words about the first stretch.");
    expect(kept!.isEdited).toBe(true);
  });
});

describe("behind the turn", () => {
  test("a finished turn triggers the summariser, and never waits for it", async () => {
    const t = await signedIn();
    const { sceneId } = await sceneWith(t, 30, {
      summariseThreshold: 20,
      summariseEveryMessages: 4,
    });
    scriptSummaries("They counted the oil and came up short.");

    const started = await json<{ id: string }>(t, "POST", `/api/scenes/${sceneId}/generate`, {});
    await adapter.started;
    adapter.push("She did not look up from the ledger.");
    adapter.end();
    await until(() => t.generation.get(started.id)?.status === "complete");

    // The turn completed on its own schedule; the summary lands behind it.
    await until(async () => {
      const state = await json<SummaryStateDto>(t, "GET", `/api/scenes/${sceneId}/summaries`);
      return state.summaries.length === 1;
    });
  });

  test("summarise off means the turn triggers nothing", async () => {
    const t = await signedIn();
    const { sceneId } = await sceneWith(t, 30, {
      summariseThreshold: 20,
      summariseEveryMessages: 4,
      summarise: false,
    });
    scriptSummaries("Should never be written.");

    const started = await json<{ id: string }>(t, "POST", `/api/scenes/${sceneId}/generate`, {});
    await adapter.started;
    adapter.push("She did not look up.");
    adapter.end();
    await until(() => t.generation.get(started.id)?.status === "complete");

    const state = await json<SummaryStateDto>(t, "GET", `/api/scenes/${sceneId}/summaries`);
    expect(state.summaries).toEqual([]);
  });
});

describe("managing them", () => {
  async function withOne(t: TestHarness) {
    const made = await sceneWith(t, 30, { summariseThreshold: 20 });
    scriptSummaries("They counted the oil and came up short.");
    await json<SummaryStateDto>(t, "POST", `/api/scenes/${made.sceneId}/summaries`);
    const state = await json<SummaryStateDto>(t, "GET", `/api/scenes/${made.sceneId}/summaries`);
    return { ...made, summary: state.summaries[0]! };
  }

  test("an edit is kept and marked", async () => {
    const t = await signedIn();
    const { sceneId, summary } = await withOne(t);
    const state = await json<SummaryStateDto>(
      t,
      "PATCH",
      `/api/scenes/${sceneId}/summaries/${summary.id}`,
      { content: "They counted, and the barrels were light." },
    );
    expect(state.summaries[0]!.content).toBe("They counted, and the barrels were light.");
    expect(state.summaries[0]!.isEdited).toBe(true);
  });

  test("an empty edit is refused rather than treated as a delete", async () => {
    const t = await signedIn();
    const { sceneId, summary } = await withOne(t);
    expect(
      await statusOf(t, "PATCH", `/api/scenes/${sceneId}/summaries/${summary.id}`, {
        content: "   ",
      }),
    ).toBe(400);
  });

  test("rewriting keeps the range and replaces the words", async () => {
    const t = await signedIn();
    const { sceneId, summary } = await withOne(t);
    scriptSummaries("A second attempt at the same stretch.");
    const state = await json<SummaryStateDto>(
      t,
      "POST",
      `/api/scenes/${sceneId}/summaries/${summary.id}/rewrite`,
    );
    expect(state.summaries.length).toBe(1);
    expect(state.summaries[0]!.content).toBe("A second attempt at the same stretch.");
    expect(state.summaries[0]!.messageCount).toBe(summary.messageCount);
  });

  test("forgetting one puts its turns back in the queue", async () => {
    const t = await signedIn();
    const { sceneId, summary } = await withOne(t);
    const state = await json<SummaryStateDto>(
      t,
      "DELETE",
      `/api/scenes/${sceneId}/summaries/${summary.id}`,
    );
    expect(state.summaries).toEqual([]);
    // Not lost: the ten turns it covered are waiting to be summarised again.
    expect(state.pendingMessages).toBe(10);
  });

  test("forgetting all takes every summary", async () => {
    const t = await signedIn();
    const { sceneId } = await withOne(t);
    const state = await json<SummaryStateDto>(t, "DELETE", `/api/scenes/${sceneId}/summaries/all`);
    expect(state.summaries).toEqual([]);
  });

  test("a summary from another scene is not reachable", async () => {
    const t = await signedIn();
    const { summary } = await withOne(t);
    const other = await sceneWith(t, 2);
    expect(
      await statusOf(t, "PATCH", `/api/scenes/${other.sceneId}/summaries/${summary.id}`, {
        content: "nope",
      }),
    ).toBe(404);
  });

  test("out-of-range settings are refused", async () => {
    const t = await signedIn();
    const { sceneId } = await sceneWith(t, 2);
    // A freeze of zero would divide by nothing; a threshold of a million would
    // mean summaries that never arrive.
    expect(await statusOf(t, "PATCH", `/api/scenes/${sceneId}`, { summariseFreeze: 0 })).toBe(400);
    expect(
      await statusOf(t, "PATCH", `/api/scenes/${sceneId}`, { summariseThreshold: 100000 }),
    ).toBe(400);
    const tooFew = { summariseEveryMessages: 1 };
    expect(await statusOf(t, "PATCH", `/api/scenes/${sceneId}`, tooFew)).toBe(400);
  });
});
