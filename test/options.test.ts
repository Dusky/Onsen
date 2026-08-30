import { afterEach, describe, expect, test } from "bun:test";
import {
  ScriptedAdapter,
  completeSetup,
  createHarness,
  until,
  type TestHarness,
} from "./helpers.ts";
import { V2_CARD, pngCard } from "./card-fixtures.ts";
import { BUILTIN_BANS, BUILTIN_GROUPS } from "../server/options/builtin.ts";
import { findBanned, parseAnalysis, repeatedPhrases } from "../server/options/analyse.ts";
import { seedBuiltins } from "../server/db/queries/options.ts";
import { buildPromptContext } from "../server/generation/context.ts";
import { buildPrompt } from "../server/prompt/index.ts";
import { OPENAI_COMPATIBLE_CAPABILITIES } from "../server/adapters/index.ts";
import { findScene } from "../server/db/queries/history.ts";
import { ANALYSE_SLOP, SLOP_SCAN } from "../server/tasks/registry.ts";
import type {
  BanListDto,
  CharacterDto,
  ConnectionProfileDto,
  MessageDto,
  SceneDto,
  SceneOptionsDto,
  SceneWithHistoryDto,
  TaskDto,
} from "../shared/types.ts";
import type { GenerationSnapshot } from "../server/generation/service.ts";

/**
 * Prompt option groups and the ban list (SPEC §13.5, §13.6, §20 phase 18).
 *
 * The thing worth testing hardest is the cardinality, because it is the whole
 * argument for a table over a wall of toggles: a scene must not be able to ask
 * for two points of view at once.
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

async function scene(t: TestHarness) {
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
  await json(t, "POST", `/api/scenes/${created.id}/messages`, {
    kind: "user",
    authorType: "user",
    content: "Anyone counted the lamp oil?",
  });
  return { sceneId: created.id };
}

function promptOf(t: TestHarness, sceneId: string) {
  return buildPrompt(
    buildPromptContext({
      db: t.ctx.db,
      scene: findScene(t.ctx.db, sceneId)!,
      capabilities: OPENAI_COMPATIBLE_CAPABILITIES,
      now: Date.now(),
      seed: 1,
    }),
  );
}

/**
 * Switch off everything else that runs behind a turn.
 *
 * Guides, summaries and the other passes all reach the same adapter, so a test
 * about what the slop scan costs has to be the only thing spending anything.
 */
async function quietBehindTheTurn(t: TestHarness) {
  const tasks = await json<TaskDto[]>(t, "GET", "/api/tasks");
  for (const task of tasks) {
    if (task.key === SLOP_SCAN || !task.autoTrigger) continue;
    await json<TaskDto>(t, "PATCH", `/api/tasks/${task.key}`, { autoTrigger: false });
  }
}

function optionIn(state: SceneOptionsDto, groupKey: string, optionKey: string) {
  const group = state.groups.find((row) => row.key === groupKey)!;
  return group.options.find((row) => row.key === optionKey)!;
}

describe("what ships", () => {
  test("every group in §13.5's table is here, with its cardinality", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    const state = await json<SceneOptionsDto>(t, "GET", `/api/scenes/${sceneId}/options`);

    for (const group of BUILTIN_GROUPS) {
      const found = state.groups.find((row) => row.key === group.key);
      expect(found, group.key).toBeDefined();
      expect(found!.cardinality, group.key).toBe(group.cardinality);
      expect(found!.options.length, group.key).toBe(group.options.length);
    }
  });

  test("nothing ships switched off entirely", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    const state = await json<SceneOptionsDto>(t, "GET", `/api/scenes/${sceneId}/options`);

    // §22: "don't ship a preset with everything switched off. Major suites do
    // this and a first run looks broken."
    for (const group of state.groups) {
      expect(group.options.some((option) => option.selected), group.key).toBe(true);
    }
    expect(state.configured).toBe(false);
  });

  test("every option carries a token cost", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    const state = await json<SceneOptionsDto>(t, "GET", `/api/scenes/${sceneId}/options`);
    // §13.5's argument for modelling this natively rather than as toggles.
    const withWords = state.groups
      .flatMap((group) => group.options)
      .filter((option) => option.fragment.trim() !== "");
    expect(withWords.length).toBeGreaterThan(0);
    for (const option of withWords) expect(option.tokenCount).toBeGreaterThan(0);
  });

  test("seeding twice changes nothing", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    const before = await json<SceneOptionsDto>(t, "GET", `/api/scenes/${sceneId}/options`);
    seedBuiltins(t.ctx.db);
    seedBuiltins(t.ctx.db);
    const after = await json<SceneOptionsDto>(t, "GET", `/api/scenes/${sceneId}/options`);
    expect(after.groups.length).toBe(before.groups.length);
    expect(after.groups.flatMap((g) => g.options).length).toBe(
      before.groups.flatMap((g) => g.options).length,
    );
  });

  test("an edited built-in survives re-seeding", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    t.ctx.db
      .query("UPDATE options SET fragment = 'My own words.' WHERE key = 'flowing'")
      .run();
    seedBuiltins(t.ctx.db);
    const state = await json<SceneOptionsDto>(t, "GET", `/api/scenes/${sceneId}/options`);
    // Idempotent by key means a new built-in reaches an install without
    // reverting anything somebody rewrote.
    expect(optionIn(state, "prose_structure", "flowing").fragment).toBe("My own words.");
  });
});

describe("cardinality", () => {
  test("one_of swaps rather than adding", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    const before = await json<SceneOptionsDto>(t, "GET", `/api/scenes/${sceneId}/options`);
    expect(optionIn(before, "pov", "third_limited").selected).toBe(true);

    const first = optionIn(before, "pov", "first");
    const after = await json<SceneOptionsDto>(t, "PUT", `/api/scenes/${sceneId}/options/${first.id}`, {
      on: true,
    });

    // The point of the table: a scene cannot ask for two points of view.
    const pov = after.groups.find((row) => row.key === "pov")!;
    expect(pov.options.filter((option) => option.selected).map((option) => option.key)).toEqual([
      "first",
    ]);
  });

  test("any_of accumulates", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    const before = await json<SceneOptionsDto>(t, "GET", `/api/scenes/${sceneId}/options`);
    const cutaway = optionIn(before, "prose_discipline", "no_cutaway");
    expect(cutaway.selected).toBe(false);

    const after = await json<SceneOptionsDto>(
      t,
      "PUT",
      `/api/scenes/${sceneId}/options/${cutaway.id}`,
      { on: true },
    );
    const group = after.groups.find((row) => row.key === "prose_discipline")!;
    expect(group.options.filter((option) => option.selected).length).toBeGreaterThan(1);
    expect(optionIn(after, "prose_discipline", "no_cutaway").selected).toBe(true);
  });

  test("the first change keeps the other defaults", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    const before = await json<SceneOptionsDto>(t, "GET", `/api/scenes/${sceneId}/options`);
    const echo = optionIn(before, "prose_discipline", "no_echo");

    // Switching one thing off must mean "this, and keep the rest" — not
    // "this alone", which is what a scene inheriting defaults would give.
    const after = await json<SceneOptionsDto>(t, "PUT", `/api/scenes/${sceneId}/options/${echo.id}`, {
      on: false,
    });
    expect(optionIn(after, "prose_discipline", "no_echo").selected).toBe(false);
    expect(optionIn(after, "pov", "third_limited").selected).toBe(true);
    expect(optionIn(after, "length", "adaptive").selected).toBe(true);
    expect(after.configured).toBe(true);
  });

  test("resetting goes back to the shipped configuration, not to nothing", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    const before = await json<SceneOptionsDto>(t, "GET", `/api/scenes/${sceneId}/options`);
    const first = optionIn(before, "pov", "first");
    await json<SceneOptionsDto>(t, "PUT", `/api/scenes/${sceneId}/options/${first.id}`, { on: true });

    const after = await json<SceneOptionsDto>(t, "DELETE", `/api/scenes/${sceneId}/options`);
    expect(after.configured).toBe(false);
    expect(optionIn(after, "pov", "third_limited").selected).toBe(true);
  });

  test("an unknown option is refused", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    expect(await statusOf(t, "PUT", `/api/scenes/${sceneId}/options/nope`, { on: true })).toBe(404);
  });
});

describe("what reaches the prompt", () => {
  test("each selected option is its own labelled block", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    const blocks = promptOf(t, sceneId).debug.blocks.filter(
      (block) => block.id === "prompt_option",
    );
    // §13.5: visible in the inspector as a labelled block with a cost. Merging
    // them would give back the wall of toggles.
    expect(blocks.length).toBeGreaterThan(1);
    for (const block of blocks) {
      expect(block.label).toContain(": ");
      expect(block.tokens).toBeGreaterThan(0);
    }
  });

  test("an option with no words contributes nothing", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    const labels = promptOf(t, sceneId)
      .debug.blocks.filter((block) => block.id === "prompt_option")
      .map((block) => block.label);
    // "No planning" and "immersive prose" are real choices that say nothing.
    expect(labels.some((label) => label.includes("None"))).toBe(false);
  });

  test("swapping an option swaps what the prompt says", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    expect(JSON.stringify(promptOf(t, sceneId).messages)).toContain("third person");

    const state = await json<SceneOptionsDto>(t, "GET", `/api/scenes/${sceneId}/options`);
    const first = optionIn(state, "pov", "first");
    await json<SceneOptionsDto>(t, "PUT", `/api/scenes/${sceneId}/options/${first.id}`, { on: true });

    const after = JSON.stringify(promptOf(t, sceneId).messages);
    expect(after).toContain("first person");
    expect(after).not.toContain("Write in third person, limited");
  });

  test("the ban list reaches the prompt as one block", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    const block = promptOf(t, sceneId).debug.blocks.find((row) => row.id === "ban_list");
    expect(block).toBeDefined();
    expect(block!.content).toContain(BUILTIN_BANS[0]!);
  });

  test("a proposal is not injected", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    t.ctx.db
      .query(
        `INSERT INTO ban_phrases (ulid, scene_id, phrase, origin, created_at, updated_at)
         VALUES ('proposal', NULL, 'a phrase nobody accepted', 'proposed', 1, 1)`,
      )
      .run();
    const block = promptOf(t, sceneId).debug.blocks.find((row) => row.id === "ban_list")!;
    // A background task does not get to edit somebody's prose unasked (§13.6).
    expect(block.content).not.toContain("nobody accepted");
  });

  test("a disabled phrase stops being injected", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    const bans = await json<BanListDto>(t, "GET", `/api/scenes/${sceneId}/bans`);
    const first = bans.phrases[0]!;
    await json<BanListDto>(t, "PATCH", `/api/scenes/${sceneId}/bans/${first.id}`, {
      enabled: false,
    });
    const block = promptOf(t, sceneId).debug.blocks.find((row) => row.id === "ban_list")!;
    expect(block.content).not.toContain(first.phrase);
  });
});

describe("the ban list", () => {
  test("the starter list is global and shipped", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    const bans = await json<BanListDto>(t, "GET", `/api/scenes/${sceneId}/bans`);
    expect(bans.phrases.length).toBe(BUILTIN_BANS.length);
    expect(bans.phrases.every((row) => row.isGlobal && row.origin === "builtin")).toBe(true);
  });

  test("a phrase can be scoped to one scene", async () => {
    const t = await signedIn();
    const one = await scene(t);
    const two = await scene(t);

    await json<BanListDto>(t, "POST", `/api/scenes/${one.sceneId}/bans`, {
      phrase: "only in this story",
      scoped: true,
    });
    const here = await json<BanListDto>(t, "GET", `/api/scenes/${one.sceneId}/bans`);
    const there = await json<BanListDto>(t, "GET", `/api/scenes/${two.sceneId}/bans`);
    expect(here.phrases.some((row) => row.phrase === "only in this story")).toBe(true);
    expect(there.phrases.some((row) => row.phrase === "only in this story")).toBe(false);
  });

  test("adding the same phrase twice does not duplicate it", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await json<BanListDto>(t, "POST", `/api/scenes/${sceneId}/bans`, { phrase: "a stock line" });
    const after = await json<BanListDto>(t, "POST", `/api/scenes/${sceneId}/bans`, {
      phrase: "A Stock Line",
    });
    expect(after.phrases.filter((row) => row.phrase.toLowerCase() === "a stock line").length).toBe(
      1,
    );
  });

  test("an empty phrase is refused", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    expect(await statusOf(t, "POST", `/api/scenes/${sceneId}/bans`, { phrase: "  " })).toBe(400);
  });
});

describe("counting what repeats", () => {
  test("a phrase across several turns is found, once, in its longest form", () => {
    const turns = [
      "The air hung heavy with oil. She did not look up.",
      "He waited. The air hung heavy between them.",
      "The air hung heavy over the ridge, and Bell closed the ledger.",
    ];
    const found = repeatedPhrases(turns);
    expect(found.map((item) => item.phrase)).toEqual(["the air hung heavy"]);
    expect(found[0]!.hits).toBe(3);
    // "air hung heavy" recurs exactly as often, and proposing both would put
    // two versions of one problem in front of the user.
    expect(found.some((item) => item.phrase === "air hung heavy")).toBe(false);
  });

  test("twice in one turn is a choice, not a habit", () => {
    const found = repeatedPhrases([
      "the air hung heavy and the air hung heavy again",
      "nothing else at all here",
    ]);
    expect(found).toEqual([]);
  });

  test("the model can only choose from what was counted", () => {
    const candidates = repeatedPhrases([
      "the air hung heavy once",
      "the air hung heavy twice",
      "the air hung heavy thrice",
    ]);
    const chosen = parseAnalysis(
      '1. "the air hung heavy"\n- a phrase it made up\n\n',
      candidates,
    );
    expect(chosen.map((item) => item.phrase)).toEqual(["the air hung heavy"]);
  });

  test("matching is case-insensitive and substring", () => {
    expect(findBanned("The Air Hung Heavy with smoke.", ["the air hung heavy"])).toEqual([
      "the air hung heavy",
    ]);
    expect(findBanned("Nothing to see.", ["the air hung heavy"])).toEqual([]);
  });
});

describe("proposing bans", () => {
  /**
   * A phrase deliberately *not* on the shipped list: the analyser skips what is
   * already known, so a fixture built on a starter phrase would test nothing.
   */
  const TIC = "she counted the barrels again";

  async function repeating(t: TestHarness) {
    const made = await scene(t);
    for (const line of [
      `${TIC} and said nothing.`,
      `Later ${TIC}, more slowly.`,
      `By the lamp ${TIC}.`,
    ]) {
      await json<MessageDto>(t, "POST", `/api/scenes/${made.sceneId}/messages`, {
        kind: "spotlight",
        authorType: "character",
        content: line,
      });
    }
    return made;
  }

  test("the counter finds it and the model's pick becomes a proposal", async () => {
    const t = await signedIn();
    const { sceneId } = await repeating(t);
    adapter.taskReplyFor = (prompt) =>
      prompt.debug.blocks[0]?.label === "Ban analysis" ? TIC : null;

    const after = await json<BanListDto>(t, "POST", `/api/scenes/${sceneId}/bans/analyse`);
    const proposal = after.phrases.find((row) => row.origin === "proposed");
    expect(proposal).toBeDefined();
    expect(proposal!.phrase).toBe(TIC);
    // Recurrence is the evidence, so it travels with the proposal (§13.6).
    expect(proposal!.hits).toBe(3);
  });

  test("accepting one is what makes it a ban", async () => {
    const t = await signedIn();
    const { sceneId } = await repeating(t);
    adapter.taskReplyFor = (prompt) =>
      prompt.debug.blocks[0]?.label === "Ban analysis" ? TIC : null;
    const proposed = await json<BanListDto>(t, "POST", `/api/scenes/${sceneId}/bans/analyse`);
    const proposal = proposed.phrases.find((row) => row.origin === "proposed")!;

    const banBlock = () =>
      promptOf(t, sceneId).debug.blocks.find((b) => b.id === "ban_list")!.content;
    expect(banBlock()).not.toContain(TIC);

    await json<BanListDto>(t, "PATCH", `/api/scenes/${sceneId}/bans/${proposal.id}`, {
      accept: true,
    });
    expect(banBlock()).toContain(TIC);
  });

  test("running twice does not grow a duplicate", async () => {
    const t = await signedIn();
    const { sceneId } = await repeating(t);
    adapter.taskReplyFor = (prompt) =>
      prompt.debug.blocks[0]?.label === "Ban analysis" ? TIC : null;

    await json<BanListDto>(t, "POST", `/api/scenes/${sceneId}/bans/analyse`);
    const after = await json<BanListDto>(t, "POST", `/api/scenes/${sceneId}/bans/analyse`);
    // The analyser proposes the same thing until somebody deals with it; a list
    // that grew a row each run would be unusable within a week.
    expect(after.phrases.filter((row) => row.phrase === TIC).length).toBe(1);
  });

  test("a failing model costs nothing", async () => {
    const t = await signedIn();
    const { sceneId } = await repeating(t);
    adapter.taskFails = true;
    const after = await json<BanListDto>(t, "POST", `/api/scenes/${sceneId}/bans/analyse`);
    expect(after.phrases.some((row) => row.origin === "proposed")).toBe(false);
    adapter.taskFails = false;
  });

  test("nothing repeating is said plainly, not as a failure", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    const after = await json<BanListDto & { detail: string | null }>(
      t,
      "POST",
      `/api/scenes/${sceneId}/bans/analyse`,
    );
    expect(after.detail).toContain("repeats");
  });
});

describe("the slop scan", () => {
  test("it is a pass, and it never calls a model", async () => {
    const t = await signedIn();
    const tasks = await json<TaskDto[]>(t, "GET", "/api/tasks");
    const scan = tasks.find((row) => row.key === SLOP_SCAN);
    expect(scan).toBeDefined();
    expect(scan!.effect).toBe("flag");
    // Declared for the shape's sake; matching text is exact, instant and free.
    expect(scan!.defaultTemplate).toBe("");
  });

  test("a banned phrase in a turn is flagged, with the phrase named", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await json<SceneDto>(t, "PATCH", `/api/scenes/${sceneId}`, { autoPasses: true });
    await quietBehindTheTurn(t);

    const before = adapter.taskCalls;
    const started = await json<GenerationSnapshot>(t, "POST", `/api/scenes/${sceneId}/generate`, {});
    await adapter.started;
    adapter.push("The air hung heavy over the ridge.");
    adapter.end();
    await until(() => t.generation.get(started.id)?.status === "complete");

    await until(async () => {
      const read = await json<SceneWithHistoryDto>(t, "GET", `/api/scenes/${sceneId}`);
      return (read.messages.at(-1)?.annotations.length ?? 0) > 0;
    });
    const read = await json<SceneWithHistoryDto>(t, "GET", `/api/scenes/${sceneId}`);
    const note = read.messages.at(-1)!.annotations.find((row) => row.passKey === SLOP_SCAN)!;
    expect(note.status).toBe("flagged");
    expect(note.detail).toContain("the air hung heavy");
    // The whole pass, and not one model call.
    expect(adapter.taskCalls).toBe(before);
  });

  test("a clean turn gets no note at all", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await json<SceneDto>(t, "PATCH", `/api/scenes/${sceneId}`, { autoPasses: true });
    await quietBehindTheTurn(t);

    const started = await json<GenerationSnapshot>(t, "POST", `/api/scenes/${sceneId}/generate`, {});
    await adapter.started;
    adapter.push("She did not look up from the ledger.");
    adapter.end();
    await until(() => t.generation.get(started.id)?.status === "complete");
    await until(async () => {
      const read = await json<SceneWithHistoryDto>(t, "GET", `/api/scenes/${sceneId}`);
      return read.messages.at(-1)?.passesPending === false;
    });

    // The one pass that says nothing when it is happy, because unlike the
    // others it cannot fail: silence here is unambiguous.
    const read = await json<SceneWithHistoryDto>(t, "GET", `/api/scenes/${sceneId}`);
    expect(read.messages.at(-1)!.annotations).toEqual([]);
  });
});

describe("the ops", () => {
  test("proposing bans is a routable side call with words of its own", async () => {
    const t = await signedIn();
    const tasks = await json<TaskDto[]>(t, "GET", "/api/tasks");
    const op = tasks.find((row) => row.key === ANALYSE_SLOP)!;
    expect(op.runs).toBe("side_call");
    expect(op.defaultTemplate).toContain("{{candidates}}");
    // The judgement it is asked for, and the one it is not.
    expect(op.defaultTemplate.toLowerCase()).toContain("filler");
  });
});
