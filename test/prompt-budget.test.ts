import { describe, expect, test } from "bun:test";
import { buildPrompt } from "../server/prompt/index.ts";
import { PromptBudgetError } from "../server/prompt/types.ts";
import { createEstimatingTokenizer, createExactTokenizer } from "../server/prompt/tokenizer.ts";
import { PRESET, character, context, flatten, userSays } from "./prompt-fixtures.ts";

/**
 * Budget allocation and eviction reporting (SPEC §3, §23).
 *
 * SPEC §3 is emphatic that the debug output must record what was *trimmed*, not
 * only what was included: "the character forgot" is almost always "the model
 * never saw it", and the inspector is the only way a user can discover that.
 */

/** Counts words, so a test can state costs in numbers it can reason about. */
const words = createExactTokenizer("words", (text) =>
  text.trim() === "" ? 0 : text.trim().split(/\s+/).length,
);

describe("budget accounting", () => {
  test("reserves the response allowance before anything else", () => {
    const built = buildPrompt(context({ budget: 8_000, preset: { ...PRESET, maxResponseTokens: 512 } }));
    expect(built.debug.budget).toBe(8_000);
    expect(built.debug.reservedForResponse).toBe(512);
    expect(built.debug.available).toBe(7_488);
  });

  test("adds up: fixed plus history plus headroom is the available budget", () => {
    const built = buildPrompt(
      context({ history: Array.from({ length: 20 }, (_, i) => userSays(`turn ${i}`)) }),
    );
    const { available, fixedTokens, historyTokens, headroom, totalTokens } = built.debug;
    expect(totalTokens).toBe(fixedTokens + historyTokens);
    expect(headroom).toBe(available - totalTokens);
    expect(headroom).toBeGreaterThanOrEqual(0);
  });

  test("every block reports its own cost", () => {
    const built = buildPrompt(context({ preset: { ...PRESET, systemPrompt: "House rules." } }));
    for (const block of built.debug.blocks) {
      if (block.id === "history") continue;
      expect(block.tokens).toBeGreaterThan(0);
    }
    const sum = built.debug.blocks
      .filter((block) => block.id !== "history")
      .reduce((total, block) => total + block.tokens, 0);
    expect(sum).toBe(built.debug.fixedTokens);
  });

  test("labels an estimated count as an estimate", () => {
    // SPEC §3: a user who trusts an estimate and overflows the context has no
    // way to find out why unless the estimate says so.
    const estimated = buildPrompt(context({ tokenizer: createEstimatingTokenizer() }));
    expect(estimated.debug.tokensAreEstimated).toBe(true);

    const exact = buildPrompt(context({ tokenizer: words }));
    expect(exact.debug.tokensAreEstimated).toBe(false);
    expect(exact.debug.tokenizerId).toBe("words");
  });

  test("uses a message's cached token count instead of recounting", () => {
    const cached = buildPrompt(
      context({ tokenizer: words, history: [userSays("one two three", { tokenCount: 999 })] }),
    );
    // The cache is trusted, plus the cost of the speaker label the renderer adds.
    expect(cached.debug.historyTokens).toBeGreaterThanOrEqual(999);
  });
});

describe("trimming history", () => {
  test("drops the oldest turns first and keeps the newest", () => {
    const history = Array.from({ length: 60 }, (_, i) => userSays(`turn number ${i}`));
    const built = buildPrompt(
      context({ tokenizer: words, history, budget: 260, preset: { ...PRESET, maxResponseTokens: 20 } }),
    );

    expect(built.debug.evicted.length).toBeGreaterThan(0);
    expect(built.debug.historyIncluded.length).toBeGreaterThan(0);
    expect(built.debug.historyIncluded.length).toBeLessThan(history.length);

    // The surviving window is the newest, contiguous, in order.
    const survivors = built.debug.historyIncluded;
    const expected = history.slice(history.length - survivors.length).map((m) => m.id);
    expect(survivors).toEqual(expected);

    expect(flatten(built)).toContain("turn number 59");
    expect(flatten(built)).not.toContain("turn number 0");
  });

  test("never trims a partial message", () => {
    const history = Array.from({ length: 40 }, (_, i) => userSays(`turn ${i} ${"filler ".repeat(5)}`));
    const built = buildPrompt(
      context({ tokenizer: words, history, budget: 300, preset: { ...PRESET, maxResponseTokens: 20 } }),
    );

    // Every surviving message is present in full; nothing is half a message.
    for (const id of built.debug.historyIncluded) {
      const original = history.find((message) => message.id === id)!;
      expect(flatten(built)).toContain(original.content);
    }
  });

  test("names every evicted message and what it cost", () => {
    const history = Array.from({ length: 40 }, (_, i) => userSays(`turn number ${i}`));
    const built = buildPrompt(
      context({ tokenizer: words, history, budget: 250, preset: { ...PRESET, maxResponseTokens: 20 } }),
    );

    const budgetEvictions = built.debug.evicted.filter((item) => item.reason === "history_budget");
    expect(budgetEvictions.length).toBeGreaterThan(0);
    for (const eviction of budgetEvictions) {
      expect(eviction.blockId).toBe("history");
      expect(eviction.itemId).not.toBeNull();
      expect(eviction.tokens).toBeGreaterThan(0);
      expect(eviction.label.length).toBeGreaterThan(0);
    }

    // Evicted and included together account for the whole history.
    const accounted = new Set([
      ...built.debug.historyIncluded,
      ...budgetEvictions.map((item) => item.itemId),
    ]);
    expect(accounted.size).toBe(history.length);
  });

  test("evictions are oldest-first, in order", () => {
    const history = Array.from({ length: 40 }, (_, i) => userSays(`turn number ${i}`));
    const built = buildPrompt(
      context({ tokenizer: words, history, budget: 250, preset: { ...PRESET, maxResponseTokens: 20 } }),
    );
    const evictedIds = built.debug.evicted
      .filter((item) => item.reason === "history_budget")
      .map((item) => item.itemId);
    expect(evictedIds).toEqual(history.slice(0, evictedIds.length).map((m) => m.id));
  });

  test("keeps everything when it all fits, and reports no evictions", () => {
    const built = buildPrompt(
      context({ tokenizer: words, history: [userSays("one"), userSays("two")], budget: 8_000 }),
    );
    expect(built.debug.evicted).toEqual([]);
    expect(built.debug.historyIncluded).toHaveLength(2);
  });

  test("a fixed block growing pushes history out, not the other way round", () => {
    const history = Array.from({ length: 30 }, (_, i) => userSays(`turn number ${i}`));
    const base = context({
      tokenizer: words,
      history,
      budget: 400,
      preset: { ...PRESET, maxResponseTokens: 20 },
    });

    const lean = buildPrompt(base);
    const heavy = buildPrompt({
      ...base,
      preset: { ...PRESET, maxResponseTokens: 20, systemPrompt: "word ".repeat(100) },
    });

    expect(heavy.debug.fixedTokens).toBeGreaterThan(lean.debug.fixedTokens);
    expect(heavy.debug.historyIncluded.length).toBeLessThan(lean.debug.historyIncluded.length);
  });
});

describe("failing loudly", () => {
  test("throws when the untrimmable blocks do not fit", () => {
    // SPEC §3: if the budget cannot fit the fixed blocks, fail loudly rather
    // than shipping a prompt the provider will reject.
    const build = () =>
      buildPrompt(
        context({
          tokenizer: words,
          budget: 60,
          preset: { ...PRESET, maxResponseTokens: 20, systemPrompt: "word ".repeat(200) },
        }),
      );

    expect(build).toThrow(PromptBudgetError);
    try {
      build();
    } catch (caught) {
      const error = caught as PromptBudgetError;
      expect(error.required).toBeGreaterThan(error.available);
      expect(error.message).toContain("cannot fit");
      // The message has to say what to do about it.
      expect(error.message).toContain("context size");
    }
  });

  test("throws rather than emptying history to make room", () => {
    expect(() =>
      buildPrompt(
        context({
          tokenizer: words,
          history: [userSays("a turn")],
          budget: 50,
          preset: { ...PRESET, maxResponseTokens: 10, systemPrompt: "word ".repeat(200) },
        }),
      ),
    ).toThrow(PromptBudgetError);
  });

  test("a character definition too large for the window fails visibly", () => {
    expect(() =>
      buildPrompt(
        context({
          tokenizer: words,
          budget: 100,
          spotlight: character("bell", "Bell", { description: "word ".repeat(500) }),
          preset: { ...PRESET, maxResponseTokens: 20 },
        }),
      ),
    ).toThrow(PromptBudgetError);
  });
});

describe("the estimator", () => {
  test("over-counts rather than under-counts", () => {
    const estimator = createEstimatingTokenizer();
    // Roughly four characters per token in English; counting at 3.6 leaves a
    // margin, and an underestimate is what overflows a context window.
    const text = "The ridge station hums through the night shift.";
    expect(estimator.count(text)).toBeGreaterThan(text.length / 4);
  });

  test("counts nothing as nothing", () => {
    expect(createEstimatingTokenizer().count("")).toBe(0);
  });
});
