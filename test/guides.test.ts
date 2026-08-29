import { afterEach, describe, expect, test } from "bun:test";
import {
  ScriptedAdapter,
  completeSetup,
  createHarness,
  until,
  type TestHarness,
} from "./helpers.ts";
import { V2_CARD, pngCard } from "./card-fixtures.ts";
import { guideQuestion, cleanGuide } from "../server/guides/runner.ts";
import { defaultTemplateOf } from "../server/prompt/index.ts";
import { GUIDE_KINDS, guideOpKey, opKind, type GuideKind } from "../server/tasks/registry.ts";
import { buildPromptContext } from "../server/generation/context.ts";
import { buildPrompt } from "../server/prompt/index.ts";
import { OPENAI_COMPATIBLE_CAPABILITIES } from "../server/adapters/index.ts";
import { findScene } from "../server/db/queries/history.ts";
import type {
  CharacterDto,
  ConnectionProfileDto,
  GuideDto,
  MessageDto,
  SceneDto,
  SceneWithHistoryDto,
  TaskDto,
} from "../shared/types.ts";
import type { GenerationSnapshot } from "../server/generation/service.ts";

/**
 * Persistent guides (SPEC §8, §20 phase 15).
 *
 * State a side call writes once and the prompt injects every turn until it is
 * flushed. The line that shapes the whole design is the last one in §8's guides
 * section: **versioned per message, so rewinding rewinds them.**
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
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  return (await response.json()) as T;
}

async function statusOf(t: TestHarness, method: string, path: string, body?: unknown) {
  const response = await t.fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
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

/** Answer only the guides, and only the ones a test names. */
function scriptGuides(byLabel: Record<string, string>) {
  adapter.taskReplyFor = (prompt) => {
    if (prompt.debug.blocks[0]?.label !== "Guide") return null;
    const question = prompt.messages[0]?.content ?? "";
    for (const [needle, reply] of Object.entries(byLabel)) {
      if (question.includes(needle)) return reply;
    }
    return null;
  };
}

/** Turn every guide off, so a test only pays for the ones it is about. */
async function onlyGuides(t: TestHarness, kinds: string[]) {
  for (const kind of GUIDE_KINDS) {
    await json<TaskDto>(t, "PATCH", `/api/tasks/${guideOpKey(kind)}`, {
      autoTrigger: kinds.includes(kind),
    });
  }
}

async function generate(t: TestHarness, sceneId: string, output: string) {
  const started = await json<GenerationSnapshot>(t, "POST", `/api/scenes/${sceneId}/generate`, {});
  await adapter.started;
  adapter.push(output);
  adapter.end();
  await until(() => t.generation.get(started.id)?.status === "complete");
}

async function guidesOf(t: TestHarness, sceneId: string): Promise<GuideDto[]> {
  const read = await json<SceneWithHistoryDto>(t, "GET", `/api/scenes/${sceneId}`);
  return read.guides;
}

async function settled(t: TestHarness, sceneId: string, expected: number) {
  await until(async () => (await guidesOf(t, sceneId)).length >= expected);
  return guidesOf(t, sceneId);
}

/* ------------------------------------------------------------------ */
/* The six                                                             */
/* ------------------------------------------------------------------ */

describe("the six guides", () => {
  test("all of them exist as separately configurable ops", async () => {
    const t = await signedIn();
    const tasks = await json<TaskDto[]>(t, "GET", "/api/tasks");
    for (const kind of GUIDE_KINDS) {
      expect(
        tasks.find((task) => task.key === guideOpKey(kind)),
        kind,
      ).toBeDefined();
    }
  });

  test("Thinking, Clothes and State arrive switched on; the rest wait", async () => {
    const t = await signedIn();
    const tasks = await json<TaskDto[]>(t, "GET", "/api/tasks");
    const auto = (kind: GuideKind) =>
      tasks.find((task) => task.key === guideOpKey(kind))!.autoTrigger;

    // SPEC §8 names exactly these three.
    expect(auto("thinking")).toBe(true);
    expect(auto("clothes")).toBe(true);
    expect(auto("state")).toBe(true);
    expect(auto("situational")).toBe(false);
    expect(auto("rules")).toBe(false);
    expect(auto("custom")).toBe(false);
  });

  test("each has words a user can replace", async () => {
    for (const kind of GUIDE_KINDS) {
      const template = defaultTemplateOf(guideOpKey(kind));
      expect(template, kind).not.toBe("");
      expect(template, kind).toContain("{{transcript}}");
      expect(template, kind).toContain("{{previous}}");
    }
    expect(defaultTemplateOf(guideOpKey("custom"))).toContain("{{input}}");
  });

  test("a guide is asked for prose, not a structure", () => {
    // §8 chooses free text over structured output on purpose: there is no parse
    // step, so there is nothing to fail.
    const question = guideQuestion(defaultTemplateOf(guideOpKey("clothes")), {
      transcript: "The reader: hello",
      previous: null,
      input: "",
    });
    expect(question).toContain("plain prose a person could edit");
    expect(question).toContain("no bullet list");
    expect(question).toContain("Nothing has been written down yet.");
  });

  test("a refresh is shown what it wrote last time", () => {
    const question = guideQuestion(defaultTemplateOf(guideOpKey("clothes")), {
      transcript: "…",
      previous: "Bell: a grey coat.",
      input: "",
    });
    // Without this a coat somebody took off three turns ago comes back on.
    expect(question).toContain("What you wrote last time:");
    expect(question).toContain("Bell: a grey coat.");
  });

  test("the wrapping a model puts around a note is trimmed", () => {
    expect(cleanGuide("Here is the updated note:\n\nBell: a grey coat.")).toBe(
      "Bell: a grey coat.",
    );
  });
});

/* ------------------------------------------------------------------ */
/* Writing them                                                        */
/* ------------------------------------------------------------------ */

describe("writing a guide", () => {
  test("a turn refreshes the guides that are switched on", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await onlyGuides(t, ["clothes"]);
    scriptGuides({ "currently wearing": "Bell: a grey coat, buttoned." });

    await generate(t, sceneId, "She did not look up.");
    const guides = await settled(t, sceneId, 1);
    expect(guides).toHaveLength(1);
    expect(guides[0]).toMatchObject({
      kind: "clothes",
      label: "Clothes",
      isPinned: false,
    });
    expect(guides[0]!.content).toBe("Bell: a grey coat, buttoned.");
    // §8 requires Show to state the cost, so it is counted when written.
    expect(guides[0]!.tokenCount).toBeGreaterThan(0);
  });

  test("the guide reaches the prompt on the next turn", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await onlyGuides(t, ["clothes"]);
    scriptGuides({ "currently wearing": "Bell: a grey coat." });

    await generate(t, sceneId, "One.");
    await settled(t, sceneId, 1);

    const row = findScene(t.ctx.db, sceneId)!;
    const prompt = buildPrompt(
      buildPromptContext({
        db: t.ctx.db,
        scene: row,
        capabilities: OPENAI_COMPATIBLE_CAPABILITIES,
        now: Date.now(),
        seed: 1,
      }),
    );
    const block = prompt.debug.blocks.find((b) => b.id === "guides")!;
    expect(block.content).toContain("Clothes");
    expect(block.content).toContain("Bell: a grey coat.");
  });

  test("rebuilding by hand runs every guide that is enabled, not just the automatic ones", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await onlyGuides(t, []);
    await json<SceneDto>(t, "PATCH", `/api/scenes/${sceneId}`, {
      customGuidePrompt: "Keep a list of everyone who owes somebody money.",
    });
    scriptGuides({
      "currently wearing": "Bell: a coat.",
      "privately thinking": "Bell: wants them gone.",
      "physically is": "Bell: behind the counter.",
      "scene currently stands": "Nobody has counted the oil.",
      "rules this world": "The station closes at dusk.",
      "owes somebody money": "Nobody, yet.",
    });

    const rebuilt = await json<GuideDto[]>(t, "POST", `/api/scenes/${sceneId}/guides/rebuild`, {});
    expect(rebuilt.map((guide) => guide.kind).sort()).toEqual([...GUIDE_KINDS].sort());
  });

  test("one guide can be rebuilt on its own", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await onlyGuides(t, []);
    scriptGuides({ "currently wearing": "Bell: a coat." });

    const rebuilt = await json<GuideDto[]>(t, "POST", `/api/scenes/${sceneId}/guides/rebuild`, {
      kind: "clothes",
    });
    expect(rebuilt.map((guide) => guide.kind)).toEqual(["clothes"]);
  });

  test("the custom guide has nothing to ask until you write the question", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await onlyGuides(t, []);
    scriptGuides({});

    const rebuilt = await json<GuideDto[]>(t, "POST", `/api/scenes/${sceneId}/guides/rebuild`, {
      kind: "custom",
    });
    // §8 calls it a free-form user-defined injection; with nothing written
    // there is no question, so nothing is invented.
    expect(rebuilt).toEqual([]);
  });

  test("a guide that came back empty leaves the previous one alone", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await onlyGuides(t, []);
    scriptGuides({ "currently wearing": "Bell: a coat." });
    await json(t, "POST", `/api/scenes/${sceneId}/guides/rebuild`, {
      kind: "clothes",
    });

    scriptGuides({ "currently wearing": "   " });
    const after = await json<GuideDto[]>(t, "POST", `/api/scenes/${sceneId}/guides/rebuild`, {
      kind: "clothes",
    });
    expect(after[0]!.content).toBe("Bell: a coat.");
  });

  test("a failing model costs a guide, never the turn", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await onlyGuides(t, ["clothes"]);
    adapter.taskFails = true;

    await generate(t, sceneId, "She did not look up.");
    adapter.taskFails = false;

    const messages = await json<MessageDto[]>(t, "GET", `/api/scenes/${sceneId}/messages`);
    expect(messages.at(-1)!.content).toBe("She did not look up.");
    expect(await guidesOf(t, sceneId)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Versioned per message                                               */
/* ------------------------------------------------------------------ */

describe("rewinding rewinds them", () => {
  test("a guide written after a turn goes away when that turn does", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await onlyGuides(t, ["clothes"]);
    scriptGuides({ "currently wearing": "Bell: a grey coat." });

    await generate(t, sceneId, "She took her coat off.");
    await settled(t, sceneId, 1);
    const messages = await json<MessageDto[]>(t, "GET", `/api/scenes/${sceneId}/messages`);
    const turn = messages.at(-1)!;

    // Rewind to before that turn. The state that turn produced goes with it —
    // which is the only thing that makes sense once history is a tree (§8).
    await json(t, "PUT", `/api/scenes/${sceneId}/leaf`, {
      messageId: messages[0]!.id,
      descend: false,
    });
    expect(await guidesOf(t, sceneId)).toEqual([]);

    // And swiping forward again brings it back: nothing was destroyed.
    await json(t, "PUT", `/api/scenes/${sceneId}/leaf`, { messageId: turn.id });
    expect((await guidesOf(t, sceneId))[0]!.content).toBe("Bell: a grey coat.");
  });

  test("two branches carry their own version of the same guide", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await onlyGuides(t, ["clothes"]);

    scriptGuides({ "currently wearing": "Bell: a grey coat." });
    await generate(t, sceneId, "She kept the coat on.");
    await settled(t, sceneId, 1);
    const first = (await json<MessageDto[]>(t, "GET", `/api/scenes/${sceneId}/messages`)).at(-1)!;

    // A sibling of that turn, with its own guide.
    scriptGuides({ "currently wearing": "Bell: shirtsleeves." });
    const started = await json<GenerationSnapshot>(t, "POST", `/api/scenes/${sceneId}/generate`, {
      parentId: first.parentId,
    });
    await adapter.started;
    adapter.push("She hung the coat by the stove.");
    adapter.end();
    await until(() => t.generation.get(started.id)?.status === "complete");
    await until(async () => (await guidesOf(t, sceneId))[0]?.content === "Bell: shirtsleeves.");

    // Swipe back to the first branch and its own version is in force again.
    await json(t, "PUT", `/api/scenes/${sceneId}/leaf`, {
      messageId: first.id,
    });
    expect((await guidesOf(t, sceneId))[0]!.content).toBe("Bell: a grey coat.");
  });
});

/* ------------------------------------------------------------------ */
/* Edit, show, flush                                                   */
/* ------------------------------------------------------------------ */

describe("managing them", () => {
  test("a hand edit pins the guide, and a refresh leaves it alone", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await onlyGuides(t, []);
    scriptGuides({ "currently wearing": "Bell: a coat." });
    await json(t, "POST", `/api/scenes/${sceneId}/guides/rebuild`, {
      kind: "clothes",
    });

    const guide = (await guidesOf(t, sceneId))[0]!;
    const edited = await json<GuideDto>(t, "PATCH", `/api/scenes/${sceneId}/guides/${guide.id}`, {
      content: "Bell: a coat, and gloves she keeps forgetting.",
    });
    expect(edited.isPinned).toBe(true);

    // A refresh that overwrote a person's edit would make editing pointless.
    scriptGuides({ "currently wearing": "Bell: nothing at all." });
    await json(t, "POST", `/api/scenes/${sceneId}/guides/rebuild`, {
      kind: "clothes",
    });
    expect((await guidesOf(t, sceneId))[0]!.content).toContain("gloves she keeps forgetting");
  });

  test("an empty edit is refused — that is a flush", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await onlyGuides(t, []);
    scriptGuides({ "currently wearing": "Bell: a coat." });
    await json(t, "POST", `/api/scenes/${sceneId}/guides/rebuild`, {
      kind: "clothes",
    });
    const guide = (await guidesOf(t, sceneId))[0]!;

    expect(
      await statusOf(t, "PATCH", `/api/scenes/${sceneId}/guides/${guide.id}`, {
        content: "  ",
      }),
    ).toBe(400);
  });

  test("flushing one leaves the others", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await onlyGuides(t, []);
    scriptGuides({
      "currently wearing": "A coat.",
      "privately thinking": "Impatience.",
    });
    await json(t, "POST", `/api/scenes/${sceneId}/guides/rebuild`, {
      kind: "clothes",
    });
    await json(t, "POST", `/api/scenes/${sceneId}/guides/rebuild`, {
      kind: "thinking",
    });

    const after = await json<GuideDto[]>(t, "DELETE", `/api/scenes/${sceneId}/guides/clothes`);
    expect(after.map((guide) => guide.kind)).toEqual(["thinking"]);
  });

  test("flushing all empties the panel", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await onlyGuides(t, []);
    scriptGuides({
      "currently wearing": "A coat.",
      "privately thinking": "Impatience.",
    });
    await json(t, "POST", `/api/scenes/${sceneId}/guides/rebuild`, {});

    expect(await json<GuideDto[]>(t, "DELETE", `/api/scenes/${sceneId}/guides/all`)).toEqual([]);
  });

  test("a flush takes every version, so a rewind cannot resurrect one", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await onlyGuides(t, ["clothes"]);
    scriptGuides({ "currently wearing": "Bell: a coat." });

    await generate(t, sceneId, "One.");
    await settled(t, sceneId, 1);
    const messages = await json<MessageDto[]>(t, "GET", `/api/scenes/${sceneId}/messages`);

    await json(t, "DELETE", `/api/scenes/${sceneId}/guides/all`);
    await json(t, "PUT", `/api/scenes/${sceneId}/leaf`, {
      messageId: messages.at(-1)!.id,
    });
    expect(await guidesOf(t, sceneId)).toEqual([]);
  });

  test("rejects a guide nobody has heard of", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    expect(await statusOf(t, "DELETE", `/api/scenes/${sceneId}/guides/hats`)).toBe(404);
    expect(
      await statusOf(t, "POST", `/api/scenes/${sceneId}/guides/rebuild`, {
        kind: "hats",
      }),
    ).toBe(400);
  });

  test("the label a guide carries is its op's", async () => {
    // "Positions" reads better than "state" and the design uses it; the label
    // lives in one place so the panel and the settings screen cannot disagree.
    expect(opKind(guideOpKey("state"))!.label).toBe("Positions");
  });
});
