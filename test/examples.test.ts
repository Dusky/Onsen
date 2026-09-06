import { describe, expect, test } from "bun:test";
import { buildPrompt } from "../server/prompt/index.ts";
import { splitExamples } from "../server/prompt/blocks.ts";
import { context, userSays, BELL, PRESET } from "./prompt-fixtures.ts";
import { createEstimatingTokenizer } from "../server/prompt/index.ts";

/**
 * What happens to the examples, and whether system turns merge (SPEC §3,
 * §20 phase 64).
 *
 * The incumbent's two prompt-assembly policies, and the reason the first one
 * needed structure before it needed a setting: example dialogue was one
 * undifferentiated string, so "drop an example when the budget tightens" had
 * only ever one thing to drop. Splitting on `<START>` is what makes push-out
 * expressible at all.
 */

const EXAMPLES = [
  "{{user}}: How short are we?",
  "<START>",
  "{{char}}: She turned the ledger around.",
  "<START>",
  "{{char}}: \"Say the number.\"",
].join("\n");

function withExamples(overrides: Parameters<typeof context>[0] = {}) {
  return context({
    spotlight: { ...BELL, exampleDialogue: EXAMPLES },
    ...overrides,
  });
}

function exampleBlocks(prompt: ReturnType<typeof buildPrompt>) {
  return prompt.debug.blocks.filter((block) => block.id === "example_dialogue");
}

describe("splitting", () => {
  test("one example per separator", () => {
    expect(splitExamples(EXAMPLES)).toHaveLength(3);
  });

  test("a card with no separator is one example", () => {
    expect(splitExamples("{{char}}: Just the one.")).toEqual(["{{char}}: Just the one."]);
  });

  test("cards write the separator loosely, and all of it counts", () => {
    // Lower case, extra space, a leading separator, a doubled one. Every card
    // library in the wild has all four.
    const messy = "<start>\n A \n< START >\n\n<START>\n B \n";
    expect(splitExamples(messy)).toEqual(["A", "B"]);
  });

  test("nothing is nothing, not one empty example", () => {
    expect(splitExamples(null)).toEqual([]);
    expect(splitExamples("   ")).toEqual([]);
  });
});

describe("keep", () => {
  test("every example reaches the prompt", () => {
    const built = buildPrompt(withExamples());
    expect(exampleBlocks(built)).toHaveLength(3);
  });

  test("and holds even when the scene has to be trimmed around it", () => {
    // A budget too small for both. `keep` means the examples stay and the
    // history goes, which is what this builder did before there was a choice.
    const history = Array.from({ length: 40 }, (_, index) =>
      userSays(`Turn ${index}: ${"the lamp gutters. ".repeat(20)}`),
    );
    const built = buildPrompt(withExamples({ history, budget: 2_400 }));
    expect(exampleBlocks(built)).toHaveLength(3);
    expect(built.debug.evicted.some((item) => item.reason === "history_budget")).toBe(true);
  });
});

describe("never", () => {
  test("drafts no example at all", () => {
    const built = buildPrompt(
      withExamples({ preset: { ...PRESET, exampleEviction: "never" } }),
    );
    expect(exampleBlocks(built)).toHaveLength(0);
    // Not merely evicted: a policy that dropped them later would still have
    // paid for them in the block list.
    expect(built.debug.evicted.filter((item) => item.blockId === "example_dialogue")).toEqual([]);
  });
});

describe("gradual push-out", () => {
  test("leaves them alone while there is room", () => {
    const built = buildPrompt(
      withExamples({ preset: { ...PRESET, exampleEviction: "gradual" }, budget: 8_000 }),
    );
    expect(exampleBlocks(built)).toHaveLength(3);
  });

  test("drops them before a single turn of the scene", () => {
    const history = Array.from({ length: 40 }, (_, index) =>
      userSays(`Turn ${index}: ${"the lamp gutters. ".repeat(20)}`),
    );
    const tokenizer = createEstimatingTokenizer();
    const historyTokens = history.reduce(
      (sum, message) => sum + tokenizer.count(message.content),
      0,
    );

    const kept = buildPrompt(
      withExamples({ history, preset: { ...PRESET, exampleEviction: "keep" }, budget: 3_000 }),
    );
    const pushed = buildPrompt(
      withExamples({ history, preset: { ...PRESET, exampleEviction: "gradual" }, budget: 3_000 }),
    );

    // The same scene, the same budget, and the policy decides who pays.
    expect(exampleBlocks(pushed).length).toBeLessThan(exampleBlocks(kept).length);
    expect(pushed.debug.historyIncluded.length).toBeGreaterThan(
      kept.debug.historyIncluded.length,
    );
    expect(pushed.debug.evicted.some((item) => item.reason === "example_pushed_out")).toBe(true);
    expect(historyTokens).toBeGreaterThan(0);
  });

  test("the oldest example is the first to go", () => {
    const history = Array.from({ length: 40 }, (_, index) =>
      userSays(`Turn ${index}: ${"the lamp gutters. ".repeat(20)}`),
    );
    const built = buildPrompt(
      withExamples({ history, preset: { ...PRESET, exampleEviction: "gradual" }, budget: 3_000 }),
    );
    const surviving = exampleBlocks(built);
    // One trim order, oldest first. The examples sit ahead of the scene in it,
    // so the first one written is the first one to leave — the same rule the
    // history has always been trimmed by, rather than a second policy.
    const gone = built.debug.evicted.filter((item) => item.reason === "example_pushed_out");
    expect(gone[0]!.label).toContain("How short are we?");
    if (surviving.length > 0) expect(surviving[0]!.content).not.toContain("How short are we?");
  });

  test("what went is named, not merely missing", () => {
    const history = Array.from({ length: 40 }, (_, index) =>
      userSays(`Turn ${index}: ${"the lamp gutters. ".repeat(20)}`),
    );
    const built = buildPrompt(
      withExamples({ history, preset: { ...PRESET, exampleEviction: "gradual" }, budget: 3_000 }),
    );
    const pushed = built.debug.evicted.filter((item) => item.reason === "example_pushed_out");
    expect(pushed.length).toBeGreaterThan(0);
    // §3 insists the eviction list is readable: "the character forgot" is
    // almost always "the model never saw it".
    expect(pushed[0]!.label.length).toBeGreaterThan(0);
    expect(pushed[0]!.tokens).toBeGreaterThan(0);
  });
});

describe("squashing system turns", () => {
  function systemRuns(prompt: ReturnType<typeof buildPrompt>): number {
    let runs = 0;
    let inRun = false;
    for (const message of prompt.messages) {
      if (message.role === "system") {
        if (!inRun) runs += 1;
        inRun = true;
      } else inRun = false;
    }
    return runs;
  }

  const NEAR_TURN: Parameters<typeof context>[0] = {
    history: [userSays("How short are we?")],
    guides: [
      { name: "Where they are", content: "The relay station, after dark." },
      { name: "What is true", content: "The shortage is unstated." },
    ],
    nudge: "Keep it under a paragraph.",
  };

  test("off, each near-turn block is its own system message", () => {
    const built = buildPrompt(context({ ...NEAR_TURN }));
    const system = built.messages.filter((message) => message.role === "system");
    expect(system.length).toBeGreaterThan(1);
  });

  test("on, a run of them becomes one", () => {
    const loose = buildPrompt(context({ ...NEAR_TURN }));
    const merged = buildPrompt(
      context({ ...NEAR_TURN, preset: { ...PRESET, squashSystem: true } }),
    );

    const looseCount = loose.messages.filter((m) => m.role === "system").length;
    const mergedCount = merged.messages.filter((m) => m.role === "system").length;
    expect(mergedCount).toBeLessThan(looseCount);
    // One message per run, not one message overall: a system turn on the far
    // side of a reply is a different instruction in a different place.
    expect(mergedCount).toBe(systemRuns(loose));

    // And nothing is lost in the merge.
    const before = loose.messages.map((m) => m.content).join("\n");
    const after = merged.messages.map((m) => m.content).join("\n");
    for (const fragment of ["The relay station, after dark.", "Keep it under a paragraph."]) {
      expect(before).toContain(fragment);
      expect(after).toContain(fragment);
    }
  });

  test("history turns are never merged into an instruction", () => {
    const built = buildPrompt(
      context({
        history: [userSays("One."), userSays("Two.")],
        preset: { ...PRESET, squashSystem: true },
      }),
    );
    // Every turn the model saw is still individually addressable, which is what
    // `historyIncluded` is for and what the inspector reads.
    expect(built.debug.historyIncluded).toHaveLength(2);
  });
});
