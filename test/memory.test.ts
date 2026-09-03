import { describe, expect, test } from "bun:test";
import {
  combineSalience,
  decayed,
  rank,
  scoreMemory,
  HALF_LIFE_TURNS,
} from "../server/memory/salience.ts";
import { parseExtraction } from "../server/memory/extract.ts";

/**
 * Narrative memory's pure halves (SPEC §11 layer 3).
 *
 * The whole feature is a ranking, and a ranking that could only be inspected by
 * running a model against a live scene is one nobody can reason about. So the
 * scoring is tested as arithmetic and the extraction as a parser.
 */

describe("salience", () => {
  test("narrative significance leads, because it predicts what will matter again", () => {
    const vivid = combineSalience({ emotional: 1, narrative: 0, density: 0 });
    const important = combineSalience({ emotional: 0, narrative: 1, density: 0 });
    // A frightening night that changes nothing is vivid and irrelevant.
    expect(important).toBeGreaterThan(vivid);
  });

  test("is bounded whatever it is given", () => {
    expect(combineSalience({ emotional: 5, narrative: 5, density: 5 })).toBe(1);
    expect(combineSalience({ emotional: -3, narrative: -3, density: -3 })).toBe(0);
  });
});

describe("decay", () => {
  test("halves over the half-life, until it reaches its floor", () => {
    expect(decayed(0.5, 0)).toBe(0.5);
    // A middling memory halves as expected: 0.5 floors at 0.25, which is where
    // one half-life lands it.
    expect(decayed(0.5, HALF_LIFE_TURNS)).toBeCloseTo(0.25, 2);
    // A low one keeps halving well past that, because its floor is far below.
    expect(decayed(0.2, HALF_LIFE_TURNS)).toBeCloseTo(0.1, 2);
  });

  test("the floor is a fraction of the original, not a constant", () => {
    // Which is what makes resistance proportional: a 0.8 memory stops at 0.64
    // rather than halving, and a 0.2 one falls to 0.04.
    expect(decayed(0.8, 10_000)).toBeCloseTo(0.64, 2);
    expect(decayed(0.2, 10_000)).toBeCloseTo(0.04, 2);
  });

  test("high salience resists decay, which is §11's rule as arithmetic", () => {
    // Both quiet for the same very long time. The important one is still worth
    // more than the trivial one ever was.
    const important = decayed(0.9, 1_000);
    const trivial = decayed(0.2, 1_000);
    expect(important).toBeGreaterThan(trivial);
    expect(important).toBeGreaterThan(0.5);
  });

  test("nothing decays to nothing", () => {
    // A memory at zero is indistinguishable from one that was never extracted.
    expect(decayed(0.3, 100_000)).toBeGreaterThan(0);
  });
});

describe("the retrieval blend", () => {
  const base = { salience: 0.5, turnsSince: 0, userEdited: false };

  test("similarity alone does not decide it", () => {
    const relevantButTrivial = scoreMemory({ ...base, similarity: 0.9, salience: 0.05 });
    const lessRelevantButImportant = scoreMemory({ ...base, similarity: 0.6, salience: 0.95 });
    expect(lessRelevantButImportant.score).toBeGreaterThan(relevantButTrivial.score);
  });

  test("salience alone does not decide it either", () => {
    // Multiplying would let either one veto the other; a fact with everything
    // to do with this moment must not be dropped for having been quiet.
    const important = scoreMemory({ ...base, similarity: 0.0, salience: 1 });
    const relevant = scoreMemory({ ...base, similarity: 1, salience: 0.3 });
    expect(relevant.score).toBeGreaterThan(important.score);
  });

  test("what the reader wrote is not something an algorithm gets to bury", () => {
    const mine = scoreMemory({ ...base, similarity: 0.4, userEdited: true });
    const extracted = scoreMemory({ ...base, similarity: 0.4, userEdited: false });
    expect(mine.score).toBeGreaterThan(extracted.score);
  });

  test("the trace keeps stored and effective salience apart", () => {
    const scored = scoreMemory({ similarity: 0.5, salience: 0.8, turnsSince: 80, userEdited: false });
    expect(scored.salience).toBe(0.8);
    expect(scored.effectiveSalience).toBeLessThan(0.8);
  });

  test("ranking drops what is not worth the tokens, and keeps the order", () => {
    const ranked = rank(
      [
        { similarity: 0.9, salience: 0.9, turnsSince: 0, userEdited: false },
        { similarity: 0.02, salience: 0.02, turnsSince: 500, userEdited: false },
        { similarity: 0.5, salience: 0.5, turnsSince: 0, userEdited: false },
      ],
      10,
    );
    expect(ranked).toHaveLength(2);
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });
});

describe("reading an extraction", () => {
  test("the ordinary shape", () => {
    const result = parseExtraction(
      JSON.stringify({
        entities: [
          { kind: "person", name: "Hollis", content: "Keeps the inn.", salience: 0.8 },
          { kind: "place", name: "The pass", content: "Closed until spring." },
        ],
        relations: [
          { from: "Hollis", to: "The pass", kind: "keeps the road to", salience: 0.6 },
        ],
      }),
    );
    expect(result.entities.map((entity) => entity.name)).toEqual(["Hollis", "The pass"]);
    expect(result.entities[0]?.salience).toBe(0.8);
    // No opinion about importance means the middle, not the bottom.
    expect(result.entities[1]?.salience).toBe(0.5);
    expect(result.relations[0]?.kind).toBe("keeps the road to");
  });

  test("prose around the JSON is not a failure", () => {
    const result = parseExtraction(
      'Here is the JSON you asked for:\n```json\n{"entities":[{"kind":"fact","name":"The bribe","content":"Taken in autumn."}]}\n```\nHope that helps!',
    );
    expect(result.entities[0]?.name).toBe("The bribe");
  });

  test("a salience given as three signals is combined", () => {
    const result = parseExtraction(
      JSON.stringify({
        entities: [
          {
            kind: "event",
            name: "The bribe",
            salience: { emotional: 0.9, narrative: 0.9, density: 0.5 },
          },
        ],
      }),
    );
    expect(result.entities[0]?.salience).toBeGreaterThan(0.7);
  });

  test("a percentage means what it looks like it means", () => {
    const result = parseExtraction(
      JSON.stringify({ entities: [{ kind: "fact", name: "A", salience: 80 }] }),
    );
    expect(result.entities[0]?.salience).toBe(0.8);
  });

  test("a kind this app does not know is named and dropped", () => {
    // Storing it would mean the CHECK failing at the far end of a background
    // task where nobody is looking.
    const result = parseExtraction(
      JSON.stringify({ entities: [{ kind: "vibe", name: "Unease" }] }),
    );
    expect(result.entities).toHaveLength(0);
    expect(result.problems[0]).toContain("vibe");
  });

  test("a relation from a thing to itself is an extraction mistake", () => {
    const result = parseExtraction(
      JSON.stringify({ relations: [{ from: "Hollis", to: "hollis", kind: "is" }] }),
    );
    expect(result.relations).toHaveLength(0);
  });

  test("a reply this cannot read yields nothing and says so", () => {
    const result = parseExtraction("I'm sorry, I can't help with that.");
    expect(result.entities).toEqual([]);
    expect(result.problems).toHaveLength(1);
  });
});
