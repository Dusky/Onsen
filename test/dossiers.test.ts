import { describe, expect, test } from "bun:test";
import { recurringNames } from "../server/generation/recurring.ts";
import { parseDossier } from "../server/generation/authoring.ts";

/**
 * Finding the character who turned out to matter (SPEC §11, §20 phase 32).
 *
 * The detector is heuristic and will be wrong sometimes — which is why nothing
 * it finds is written without the reader accepting it. What these tests hold it
 * to is the two failures that would make it useless rather than imperfect:
 * proposing the words at the start of sentences, and proposing people who
 * already have a card.
 */

const READER = "Reader: ";

describe("finding a recurring name", () => {
  test("a name across several messages is found", () => {
    expect(
      recurringNames({
        messages: [
          "The innkeeper poured. Hollis never looked up from the ledger.",
          "Hollis said the road was closed.",
          "She asked Hollis about the pass.",
        ],
        known: [],
        threshold: 3,
      }),
    ).toEqual([{ name: "Hollis", mentions: 3 }]);
  });

  test("counted in messages, not occurrences", () => {
    // A name said three times in one line is one moment. A name said once in
    // three turns is a character who keeps coming back — the second is what a
    // dossier is for.
    expect(
      recurringNames({
        messages: ["Hollis, Hollis, Hollis."],
        known: [],
        threshold: 3,
      }),
    ).toEqual([]);
  });

  test("sentence-initial words are not names", () => {
    // The whole problem with finding names by capitalisation.
    const found = recurringNames({
      messages: [
        "Then she left. The road was closed.",
        "Then he followed. The gate was shut.",
        "Then it rained. The night came on.",
      ],
      known: [],
      threshold: 2,
    });
    expect(found).toEqual([]);
  });

  test("someone who already has a card is not proposed again", () => {
    expect(
      recurringNames({
        messages: ["Aldan waited.", "Aldan waited again.", "Aldan gave up."],
        known: ["aldan"],
        threshold: 2,
      }),
    ).toEqual([]);
  });

  test("speaker labels in a transcript are not proposed", () => {
    // §3's transcript labels its turns in caps; every one of them would be a
    // false positive if the matcher took uppercase words.
    expect(
      recurringNames({
        messages: ["ALDAN: I waited.", "ALDAN: Still waiting.", "ALDAN: Enough."],
        known: [],
        threshold: 2,
      }),
    ).toEqual([]);
  });

  test("possessives are the same name", () => {
    expect(
      recurringNames({
        messages: ["Hollis's ledger.", "The ledger was Hollis's.", "Hollis kept it."],
        known: [],
        threshold: 3,
      })[0]?.name,
    ).toBe("Hollis");
  });

  test("most mentioned first", () => {
    const found = recurringNames({
      messages: [
        `${READER}Hollis and Kestrel argued.`,
        "Hollis left.",
        "Hollis came back.",
        "Kestrel shrugged.",
      ],
      known: [],
      threshold: 2,
    });
    expect(found.map((row) => row.name)).toEqual(["Hollis", "Kestrel"]);
  });
});

describe("reading a dossier back", () => {
  test("the five fields, and the tiers", () => {
    const parsed = parseDossier(
      JSON.stringify({
        role: "Keeps the inn at the pass.",
        voice: "Short sentences. Never asks a question twice.",
        canonLock: "Has a limp from the winter. Refuses to discuss the war.",
        knowledge: { public: "Runs the inn.", private: "Knows the pass is open.", buried: "Took the bribe." },
        standing: "Wary but civil.",
      }),
      "Hollis",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.dossier.name).toBe("Hollis");
    expect(parsed.dossier.canonLock).toContain("limp");
    expect(parsed.dossier.knowledge.buried).toBe("Took the bribe.");
  });

  test("a reply that filled nothing is refused", () => {
    // It would render an empty entry, and the reader would have to delete
    // something the app invented.
    const parsed = parseDossier(JSON.stringify({ role: "", voice: "" }), "Hollis");
    expect(parsed.ok).toBe(false);
  });

  test("prose around the JSON is tolerated", () => {
    const parsed = parseDossier(
      'Here you go:\n{"role": "The ferryman.", "voice": "Slow."}\nHope that helps.',
      "Ward",
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.dossier.role).toBe("The ferryman.");
  });
});
