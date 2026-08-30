import { describe, expect, test } from "bun:test";
import {
  activateLore,
  keyMatches,
  type ActivationInput,
  type LoreCandidate,
} from "../server/lore/activate.ts";

/**
 * The activation model (SPEC §10, §20 phase 21).
 *
 * Six rules that each look simple on their own and interact in ways that are
 * hard to hold in your head — which is exactly why the engine is pure and why
 * these tests drive it directly rather than through a scene.
 */

function entry(over: Partial<LoreCandidate> = {}): LoreCandidate {
  return {
    id: over.id ?? "e1",
    title: "An entry",
    content: "The ridge station runs on lamp oil.",
    enabled: true,
    keys: ["oil"],
    secondaryKeys: [],
    secondaryLogic: "and_any",
    caseSensitive: false,
    matchWholeWords: true,
    useRegex: false,
    probability: 100,
    isConstant: false,
    scanDepth: null,
    characterFilter: [],
    sticky: 0,
    cooldown: 0,
    delay: 0,
    delayFrom: "scene_start",
    inclusionGroup: null,
    groupWeight: 100,
    groupSelection: "weight",
    position: "before_history",
    insertionOrder: 100,
    insertionDepth: 4,
    insertionRole: "system",
    outletName: null,
    recursionLevel: 0,
    nonRecursable: false,
    preventFurtherRecursion: false,
    bookId: "b1",
    bookScanDepth: 4,
    bookTokenBudget: 0,
    ...over,
  };
}

function run(entries: LoreCandidate[], over: Partial<ActivationInput> = {}) {
  return activateLore({
    entries,
    transcript: ["Has anyone counted the lamp oil?"],
    presentCharacterIds: ["bell"],
    timed: [],
    messageCount: 10,
    messagesSinceBranch: 10,
    // Fixed, so probability and weighted groups are replayable in a test the
    // way they are replayable in a generation.
    random: () => 0.5,
    recursionCap: 2,
    countTokens: (text) => Math.ceil(text.length / 4),
    ...over,
  });
}

const fired = (result: ReturnType<typeof run>) => result.activated.map((e) => e.id);
const why = (result: ReturnType<typeof run>, id: string) =>
  result.trace.find((row) => row.entryId === id)?.skipped ?? null;

describe("matching", () => {
  test("whole words by default, which is the fix for the classic complaint", () => {
    // An entry keyed on "ash" that fires on "washed" is the single most common
    // complaint about world info.
    expect(keyMatches("she washed it", "ash", { caseSensitive: false, matchWholeWords: true, useRegex: false })).toBe(false);
    expect(keyMatches("ash on the sill", "ash", { caseSensitive: false, matchWholeWords: true, useRegex: false })).toBe(true);
    // Off, it behaves the old way.
    expect(keyMatches("she washed it", "ash", { caseSensitive: false, matchWholeWords: false, useRegex: false })).toBe(true);
  });

  test("a key with no word edges falls back to substring rather than never matching", () => {
    // Word boundaries cannot help a key like this, and silently never matching
    // would be worse than matching loosely.
    expect(keyMatches("the 灯 is out", "灯", { caseSensitive: false, matchWholeWords: true, useRegex: false })).toBe(true);
    expect(keyMatches("what? oil.", "?", { caseSensitive: false, matchWholeWords: true, useRegex: false })).toBe(true);
  });

  test("case sensitivity and regex", () => {
    expect(keyMatches("Oil", "oil", { caseSensitive: true, matchWholeWords: true, useRegex: false })).toBe(false);
    expect(keyMatches("barrels 12", "barrels? \\d+", { caseSensitive: false, matchWholeWords: false, useRegex: true })).toBe(true);
  });

  test("a broken pattern is a typo, not a failed generation", () => {
    expect(keyMatches("anything", "([", { caseSensitive: false, matchWholeWords: false, useRegex: true })).toBe(false);
  });

  test("an unmatched entry stays out, and says so", () => {
    const result = run([entry({ keys: ["ledger"] })]);
    expect(fired(result)).toEqual([]);
    expect(why(result, "e1")).toBe("no_match");
  });

  test("a constant entry needs no keys at all", () => {
    const result = run([entry({ isConstant: true, keys: [] })]);
    expect(fired(result)).toEqual(["e1"]);
  });

  test("scan depth is per entry, over the book's", () => {
    const transcript = ["oil was mentioned here", "a", "b", "c", "d"];
    // The book looks back four; this entry looks back two, so it misses it.
    expect(fired(run([entry({ scanDepth: 2 })], { transcript }))).toEqual([]);
    expect(fired(run([entry({ scanDepth: 5 })], { transcript }))).toEqual(["e1"]);
  });
});

describe("secondary keys", () => {
  const transcript = ["The lamp oil is short and Bell is counting."];
  const cases: [string, string[], string[], boolean][] = [
    ["and_any hits", ["Bell", "nobody"], [], true],
    ["and_any misses", ["nobody", "nothing"], [], false],
    ["and_all hits", ["Bell", "counting"], [], true],
    ["and_all misses", ["Bell", "nothing"], [], false],
    ["not_any hits", ["nothing"], [], true],
    ["not_any misses", ["Bell"], [], false],
    ["not_all hits", ["Bell", "nothing"], [], true],
    ["not_all misses", ["Bell", "counting"], [], false],
  ];

  for (const [name, keys, , expected] of cases) {
    const logic = name.split(" ")[0] as "and_any" | "and_all" | "not_any" | "not_all";
    test(name, () => {
      const result = run([entry({ secondaryKeys: keys, secondaryLogic: logic })], { transcript });
      expect(fired(result).length > 0).toBe(expected);
      if (!expected) expect(why(result, "e1")).toBe("secondary_keys");
    });
  }

  test("secondary keys qualify a match, they do not cause one", () => {
    // "Bell" is a secondary key and appears; the primary key does not, so
    // nothing fires.
    const result = run([entry({ keys: ["ledger"], secondaryKeys: ["Bell"] })], { transcript });
    expect(fired(result)).toEqual([]);
    expect(why(result, "e1")).toBe("no_match");
  });
});

describe("the character filter", () => {
  test("scopes an entry to who is present", () => {
    // §10: essential when a group shares one lorebook and cast members should
    // hold different knowledge.
    expect(fired(run([entry({ characterFilter: ["bell"] })]))).toEqual(["e1"]);
    const missing = run([entry({ characterFilter: ["aldan"] })]);
    expect(fired(missing)).toEqual([]);
    expect(why(missing, "e1")).toBe("character_filter");
  });

  test("an empty filter means everybody", () => {
    expect(fired(run([entry({ characterFilter: [] })], { presentCharacterIds: [] }))).toEqual(["e1"]);
  });
});

describe("timed effects", () => {
  test("delay keeps an entry out until the scene is old enough", () => {
    const young = run([entry({ delay: 20 })], { messageCount: 5 });
    expect(fired(young)).toEqual([]);
    expect(why(young, "e1")).toBe("delayed");
    expect(fired(run([entry({ delay: 20 })], { messageCount: 25 }))).toEqual(["e1"]);
  });

  test("delay can be measured from the branch point instead of the scene", () => {
    // §10 names measuring only from the start of the whole chat as the
    // limitation to avoid: in a long scene it never delays anything.
    const input = { messageCount: 500, messagesSinceBranch: 3 };
    expect(fired(run([entry({ delay: 10, delayFrom: "scene_start" })], input))).toEqual(["e1"]);
    expect(fired(run([entry({ delay: 10, delayFrom: "branch_point" })], input))).toEqual([]);
  });

  test("cooldown keeps an entry out after it fires", () => {
    const timed = [{ entryId: "e1", messagesAgo: 2 }];
    const cooling = run([entry({ cooldown: 5 })], { timed });
    expect(fired(cooling)).toEqual([]);
    expect(why(cooling, "e1")).toBe("cooling_down");
    expect(fired(run([entry({ cooldown: 5 })], { timed: [{ entryId: "e1", messagesAgo: 6 }] }))).toEqual(["e1"]);
  });

  test("sticky keeps an entry in without a match", () => {
    const result = run([entry({ sticky: 4, keys: ["nothing here"] })], {
      timed: [{ entryId: "e1", messagesAgo: 1 }],
    });
    expect(fired(result)).toEqual(["e1"]);
    expect(result.trace.find((row) => row.entryId === "e1")?.sticky).toBe(true);
  });

  test("sticky bypasses probability, and expiry hands over to cooldown", () => {
    // An entry that rolled well once should not have to keep rolling well for
    // a duration it was already granted.
    const sticky = run([entry({ sticky: 4, cooldown: 6, probability: 0 })], {
      timed: [{ entryId: "e1", messagesAgo: 1 }],
    });
    expect(fired(sticky)).toEqual(["e1"]);

    // Past the sticky window, the cooldown is what applies — §10's "chains
    // naturally after sticky expires".
    const cooling = run([entry({ sticky: 4, cooldown: 6, probability: 100 })], {
      timed: [{ entryId: "e1", messagesAgo: 5 }],
    });
    expect(why(cooling, "e1")).toBe("cooling_down");
  });
});

describe("probability", () => {
  test("a roll above the threshold keeps it out", () => {
    const unlucky = run([entry({ probability: 20 })], { random: () => 0.9 });
    expect(fired(unlucky)).toEqual([]);
    expect(why(unlucky, "e1")).toBe("probability");
    expect(fired(run([entry({ probability: 20 })], { random: () => 0.1 }))).toEqual(["e1"]);
  });

  test("100 never rolls", () => {
    expect(fired(run([entry({ probability: 100 })], { random: () => 0.999 }))).toEqual(["e1"]);
  });
});

describe("inclusion groups", () => {
  const members = (selection: "weight" | "prioritize" | "score") => [
    entry({ id: "a", inclusionGroup: "event", groupSelection: selection, groupWeight: 10, insertionOrder: 50, keys: ["oil"] }),
    entry({ id: "b", inclusionGroup: "event", groupSelection: selection, groupWeight: 90, insertionOrder: 10, keys: ["oil", "lamp", "counted"] }),
  ];

  test("only one member of a group is inserted", () => {
    const result = run(members("weight"));
    expect(result.activated.length).toBe(1);
    // The one that lost says why, rather than looking unmatched.
    const loser = result.activated[0]!.id === "a" ? "b" : "a";
    expect(why(result, loser)).toBe("group_not_chosen");
  });

  test("prioritize is deterministic: lowest insertion order wins", () => {
    expect(fired(run(members("prioritize")))).toEqual(["b"]);
  });

  test("score picks the one with the most key matches", () => {
    // "b" matches oil, lamp and counted; "a" matches only oil.
    expect(fired(run(members("score")), )).toEqual(["b"]);
  });

  test("weight is a weighted roll, and a seeded one", () => {
    // 10 against 90: a roll at 0.5 of 100 lands past the first member.
    expect(fired(run(members("weight"), { random: () => 0.5 }))).toEqual(["b"]);
    expect(fired(run(members("weight"), { random: () => 0.01 }))).toEqual(["a"]);
  });
});

describe("recursion", () => {
  const seed = entry({ id: "seed", keys: ["oil"], content: "The oil comes up from Coldharbour." });
  const second = entry({ id: "second", keys: ["Coldharbour"], content: "Coldharbour is three days south." });

  test("an injected entry can trigger another", () => {
    const result = run([seed, second]);
    expect(fired(result).sort()).toEqual(["second", "seed"]);
    expect(result.trace.find((row) => row.entryId === "second")?.round).toBe(1);
  });

  test("the cap stops it", () => {
    const third = entry({ id: "third", keys: ["south"], content: "South is where the coast road runs." });
    expect(fired(run([seed, second, third], { recursionCap: 1 })).sort()).toEqual(["second", "seed"]);
    expect(fired(run([seed, second, third], { recursionCap: 2 })).sort()).toEqual(["second", "seed", "third"]);
  });

  test("a non-recursable entry contributes no text to the next scan", () => {
    const quiet = { ...seed, nonRecursable: true };
    expect(fired(run([quiet, second]))).toEqual(["seed"]);
  });

  test("prevent_further_recursion ends it outright", () => {
    const stop = { ...seed, preventFurtherRecursion: true };
    expect(fired(run([stop, second]))).toEqual(["seed"]);
  });

  test("levels are matched lowest first, and a level that fires holds the pass", () => {
    // §10: entries grouped by level are "matched only after lower levels are
    // exhausted". Level 0 matches, so level 1 does not run in this pass.
    const low = entry({ id: "low", recursionLevel: 0, keys: ["oil"] });
    const high = entry({ id: "high", recursionLevel: 1, keys: ["oil"] });
    expect(fired(run([low, high]))[0]).toBe("low");
  });

  test("a higher level runs when the lower one matches nothing", () => {
    const low = entry({ id: "low", recursionLevel: 0, keys: ["ledger"] });
    const high = entry({ id: "high", recursionLevel: 1, keys: ["oil"] });
    expect(fired(run([low, high]))).toEqual(["high"]);
  });
});

describe("the per-book budget", () => {
  test("lowest priority drops when the budget is exceeded", () => {
    const long = "x".repeat(400); // 100 tokens at the estimator's 4 chars
    const first = entry({ id: "first", insertionOrder: 10, content: long, bookTokenBudget: 150 });
    const second = entry({ id: "second", insertionOrder: 20, content: long, bookTokenBudget: 150 });
    const result = run([first, second]);
    expect(fired(result)).toEqual(["first"]);
    // Dropped by the budget, not by failing to match — the trace says which.
    expect(why(result, "second")).toBe("book_budget");
  });

  test("no budget means no dropping", () => {
    const long = "x".repeat(4000);
    const a = entry({ id: "a", content: long, bookTokenBudget: 0 });
    const b = entry({ id: "b", content: long, bookTokenBudget: 0, insertionOrder: 200 });
    expect(fired(run([a, b])).sort()).toEqual(["a", "b"]);
  });

  test("budgets are per book, not shared", () => {
    const long = "x".repeat(400);
    const a = entry({ id: "a", content: long, bookId: "one", bookTokenBudget: 150 });
    const b = entry({ id: "b", content: long, bookId: "two", bookTokenBudget: 150 });
    expect(fired(run([a, b])).sort()).toEqual(["a", "b"]);
  });
});

describe("the trace", () => {
  test("every entry considered appears, fired or not", () => {
    const result = run([
      entry({ id: "hit", keys: ["oil"] }),
      entry({ id: "miss", keys: ["ledger"] }),
      entry({ id: "off", enabled: false }),
    ]);
    expect(result.trace.map((row) => row.entryId).sort()).toEqual(["hit", "miss", "off"]);
    expect(why(result, "hit")).toBeNull();
    expect(why(result, "off")).toBe("disabled");
    // §3's inspector needs the key, not just the fact: "why did this fire".
    expect(result.trace.find((row) => row.entryId === "hit")?.matchedKey).toBe("oil");
  });
});
