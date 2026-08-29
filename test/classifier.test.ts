import { describe, expect, test } from "bun:test";
import {
  buildClassifierPrompt,
  classifierQuestion,
  parseClassifierReply,
  type ClassifierCandidate,
} from "../server/generation/classifier.ts";
import { createEstimatingTokenizer } from "../server/prompt/index.ts";

/**
 * The classifier turn director's question and answer (SPEC §6).
 *
 * Everything here is written on the assumption that the model answering is
 * small, fast, and imperfect at following instructions — which is the whole
 * point of routing it to a cheap model. The parser's job is to get a usable
 * decision out of an imperfect reply, and to say "no answer" rather than a
 * wrong one when it cannot.
 */

const CAST: ClassifierCandidate[] = [
  { id: "aldan", name: "Aldan Roe", description: "The station's ledger-keeper.", turnsSilent: 3 },
  { id: "mira", name: "Mira Vance", description: "A courier on the ridge line.", turnsSilent: 0 },
  { id: "bell", name: "Sister Bell", description: "Keeps the chapel.", turnsSilent: null },
];

function question(overrides: Partial<Parameters<typeof classifierQuestion>[0]> = {}) {
  return classifierQuestion({
    candidates: CAST,
    history: [{ speaker: "Wren", content: "Has anyone counted the lamp oil?" }],
    reader: "Wren",
    askScope: false,
    ...overrides,
  });
}

describe("the question", () => {
  test("lists everyone it is willing to be told, with something to choose on", () => {
    const text = question();
    for (const member of CAST) {
      expect(text).toContain(member.name);
      expect(text).toContain(member.description!);
    }
  });

  test("says how long each of them has been quiet", () => {
    const text = question();
    expect(text).toContain("last spoke 3 turns ago");
    expect(text).toContain("spoke most recently");
    expect(text).toContain("has not spoken in this scene yet");
  });

  test("names the reader and puts them out of reach", () => {
    // The user-lock is not only a generation concern: a director that picks the
    // reader has decided what the reader does, which is the same failure.
    expect(question()).toContain("Wren is the reader, who is not yours to choose");
  });

  test("asks for a reason, because a decision nobody can read is a dice roll", () => {
    expect(question()).toContain("WHY:");
    expect(question()).toContain("one short sentence, for the reader");
  });

  test("asks about scope only when the scope is still open", () => {
    expect(question({ askScope: false })).not.toContain("SCOPE:");
    expect(question({ askScope: false })).toContain("two lines");

    const asked = question({ askScope: true });
    expect(asked).toContain("SCOPE:");
    expect(asked).toContain("three lines");
  });

  test("says the scene has not started rather than showing an empty transcript", () => {
    expect(question({ history: [] })).toContain("(the scene has not started)");
  });

  test("shortens a long turn rather than sending the whole scene", () => {
    const text = question({
      history: [{ speaker: "Aldan Roe", content: "word ".repeat(400) }],
    });
    expect(text).toContain("…");
    expect(text.length).toBeLessThan(3000);
  });

  test("is small — the point of a classifier is that it is cheap", () => {
    const prompt = buildClassifierPrompt(
      { candidates: CAST, history: [], reader: null, askScope: true },
      createEstimatingTokenizer(),
    );
    expect(prompt.debug.totalTokens).toBeLessThan(400);
    expect(prompt.messages).toHaveLength(1);
    expect(prompt.system).toContain("without commentary");
  });
});

describe("reading the answer", () => {
  test("the format it was asked for", () => {
    const reply = parseClassifierReply(
      "SPEAKER: Aldan Roe\nSCOPE: one\nWHY: He was asked a direct question and has not answered.",
      CAST,
    );
    expect(reply).toEqual({
      characterId: "aldan",
      name: "Aldan Roe",
      scope: "spotlight",
      reason: "He was asked a direct question and has not answered.",
    });
  });

  test("reads room as a beat", () => {
    const reply = parseClassifierReply("SPEAKER: Mira Vance\nSCOPE: room\nWHY: Everyone reacts.", CAST);
    expect(reply!.scope).toBe("beat");
  });

  test("a bare name, which is what a model that ignores the format says", () => {
    const reply = parseClassifierReply("Sister Bell", CAST);
    expect(reply).toMatchObject({ characterId: "bell", reason: null });
  });

  test("a name wrapped in the decoration models add", () => {
    expect(parseClassifierReply('SPEAKER: **"Mira Vance."**', CAST)!.characterId).toBe("mira");
  });

  test("a first name only, which happens constantly", () => {
    expect(parseClassifierReply("SPEAKER: Bell", CAST)!.characterId).toBe("bell");
    expect(parseClassifierReply("SPEAKER: Aldan", CAST)!.characterId).toBe("aldan");
  });

  test("lowercase field names", () => {
    const reply = parseClassifierReply("speaker: mira vance\nwhy: she was addressed", CAST);
    expect(reply).toMatchObject({ characterId: "mira", reason: "she was addressed" });
  });

  test("refuses a name that is nobody, rather than guessing", () => {
    expect(parseClassifierReply("SPEAKER: The innkeeper\nWHY: He is nearby.", CAST)).toBeNull();
    expect(parseClassifierReply("", CAST)).toBeNull();
    expect(parseClassifierReply("I am not able to help with that.", CAST)).toBeNull();
  });

  test("refuses an ambiguous first name rather than picking one", () => {
    const twoRoes: ClassifierCandidate[] = [
      { id: "a", name: "Aldan Roe", description: null, turnsSilent: 0 },
      { id: "b", name: "Aldan Vance", description: null, turnsSilent: 0 },
    ];
    expect(parseClassifierReply("SPEAKER: Aldan", twoRoes)).toBeNull();
  });

  test("a missing or unreadable scope is not a beat by accident", () => {
    expect(parseClassifierReply("SPEAKER: Mira Vance", CAST)!.scope).toBeNull();
    expect(parseClassifierReply("SPEAKER: Mira Vance\nSCOPE: perhaps", CAST)!.scope).toBeNull();
  });

  test("caps a reason that turned into an essay", () => {
    const reply = parseClassifierReply(`SPEAKER: Mira Vance\nWHY: ${"because ".repeat(80)}`, CAST);
    expect(reply!.reason!.length).toBeLessThanOrEqual(180);
  });

  test("survives a model that explains itself first", () => {
    const reply = parseClassifierReply(
      "Sure! Here is my answer:\n\nSPEAKER: Sister Bell\nWHY: She has been silent throughout.",
      CAST,
    );
    expect(reply).toMatchObject({ characterId: "bell" });
  });
});
