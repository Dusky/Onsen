import { describe, expect, test } from "bun:test";
import { parseBeat, spliceSegment } from "../server/generation/segments.ts";

/**
 * Beat parsing (SPEC §3.5).
 *
 * The fixtures here are the shapes a model actually produces, including the
 * ones it produces when it is not following instructions. The rule the suite
 * enforces above all others is that no input loses text: for every fixture,
 * the segments' spans reassemble into the original.
 */

const CAST = ["Aldan Roe", "Mira Vance", "Sister Bell"];

/** Every character of the input is either inside a segment or whitespace. */
function losesNothing(content: string): void {
  const { segments } = parseBeat(content, CAST);
  let at = 0;
  for (const segment of segments) {
    expect(segment.charStart).toBeGreaterThanOrEqual(at);
    // Anything skipped over is whitespace or a speaker label, never prose.
    at = segment.charEnd;
  }
  const covered = segments.map((s) => content.slice(s.charStart, s.charEnd)).join("");
  const stripped = content
    .replace(/^\s*\*\*[^*\n]+?\s*(?::\s*\*\*|\*\*\s*:)[ \t]?/gm, "")
    .replace(/^(?:Aldan Roe|Mira Vance|Sister Bell):[ \t]?/gm, "");
  expect(covered.replace(/\s+/g, "")).toBe(stripped.replace(/\s+/g, ""));
}

describe("the format the prompt asks for", () => {
  const beat = [
    "**Aldan Roe:** He set the lamp down without looking up.",
    "",
    "**Mira Vance:** \"You're late.\"",
    "",
    "**Sister Bell:** She said nothing at all.",
  ].join("\n");

  test("splits on the speaker label", () => {
    const { segments, degraded } = parseBeat(beat, CAST);
    expect(degraded).toBe(false);
    expect(segments.map((s) => s.speakerLabel)).toEqual(["Aldan Roe", "Mira Vance", "Sister Bell"]);
    expect(segments.map((s) => s.speakerType)).toEqual(["character", "character", "character"]);
  });

  test("the label is not part of the segment's content", () => {
    const [first] = parseBeat(beat, CAST).segments;
    expect(first!.content).toBe("He set the lamp down without looking up.");
    expect(beat.slice(first!.charStart, first!.charEnd)).toBe(first!.content);
  });

  test("ordinals are dense and in order", () => {
    const { segments } = parseBeat(beat, CAST);
    expect(segments.map((s) => s.ordinal)).toEqual([0, 1, 2]);
  });

  test("loses nothing", () => losesNothing(beat));
});

describe("what models actually emit", () => {
  test("the colon outside the bold", () => {
    const { segments } = parseBeat('**Mira Vance**: "You\'re late."', CAST);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.speakerLabel).toBe("Mira Vance");
    expect(segments[0]!.content).toBe('"You\'re late."');
  });

  test("no bold at all, for a name in the cast", () => {
    const { segments } = parseBeat("Mira Vance: You're late.", CAST);
    expect(segments[0]!.speakerLabel).toBe("Mira Vance");
  });

  test("no bold and a name nobody knows is left as prose", () => {
    // Otherwise every line of dialogue containing a colon starts a segment.
    const { segments, degraded } = parseBeat("The innkeeper: a broad, unhurried man.", CAST);
    expect(degraded).toBe(true);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.speakerType).toBe("narration");
  });

  test("a bold label for somebody outside the cast still parses as a speaker", () => {
    // The strict form is authoritative: a character written out of the cast
    // mid-scene must not turn their lines into narration retroactively.
    const { segments } = parseBeat("**The Innkeeper:** He shrugged.", CAST);
    expect(segments[0]!.speakerType).toBe("character");
    expect(segments[0]!.speakerLabel).toBe("The Innkeeper");
  });

  test("a colon inside dialogue does not split the segment", () => {
    const beat = '**Mira Vance:** "There is one rule here: you pay first."';
    const { segments } = parseBeat(beat, CAST);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.content).toBe('"There is one rule here: you pay first."');
  });

  test("a long line ending in a colon is not a label", () => {
    const line = `${"a".repeat(80)}:`;
    const { segments } = parseBeat(line, CAST);
    expect(segments[0]!.speakerType).toBe("narration");
  });

  test("multi-paragraph parts stay in one segment", () => {
    const beat = "**Aldan Roe:** First.\n\nStill Aldan.\n\n**Mira Vance:** Hers.";
    const { segments } = parseBeat(beat, CAST);
    expect(segments).toHaveLength(2);
    expect(segments[0]!.content).toBe("First.\n\nStill Aldan.");
  });

  test("a character may take two turns in one beat", () => {
    const beat = "**Aldan Roe:** One.\n\n**Mira Vance:** Two.\n\n**Aldan Roe:** Three.";
    const { segments } = parseBeat(beat, CAST);
    expect(segments.map((s) => s.speakerLabel)).toEqual(["Aldan Roe", "Mira Vance", "Aldan Roe"]);
  });
});

describe("narration", () => {
  test("prose before the first label opens the beat as narration", () => {
    const beat = "The rain had not stopped.\n\n**Aldan Roe:** He listened to it.";
    const { segments } = parseBeat(beat, CAST);
    expect(segments[0]).toMatchObject({
      speakerType: "narration",
      speakerLabel: null,
      content: "The rain had not stopped.",
    });
    expect(segments[1]!.speakerType).toBe("character");
  });

  test("loses nothing when narration opens the beat", () => {
    losesNothing("The rain had not stopped.\n\n**Aldan Roe:** He listened to it.");
  });
});

describe("degrading rather than losing text", () => {
  test("an unlabelled beat becomes one flagged narration segment", () => {
    const beat = "They argued for a while, and then they stopped arguing.";
    const { segments, degraded } = parseBeat(beat, CAST);
    expect(degraded).toBe(true);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.content).toBe(beat);
  });

  test("empty output produces no segments and is not flagged", () => {
    expect(parseBeat("   \n\n  ", CAST)).toEqual({ segments: [], degraded: false });
  });

  test("a partially labelled beat is not degraded — the labels that exist are used", () => {
    const { degraded, segments } = parseBeat("Silence.\n\n**Mira Vance:** Then not.", CAST);
    expect(degraded).toBe(false);
    expect(segments).toHaveLength(2);
  });
});

describe("splicing, which is what recast does", () => {
  const beat = "**Aldan Roe:** He said something dull.\n\n**Mira Vance:** \"Late again.\"";

  test("replaces one part and leaves the rest byte-identical", () => {
    const [first] = parseBeat(beat, CAST).segments;
    const next = spliceSegment(beat, first!, "He said nothing at all.");
    expect(next).toBe("**Aldan Roe:** He said nothing at all.\n\n**Mira Vance:** \"Late again.\"");
  });

  test("re-parsing a splice gives the same shape back", () => {
    const before = parseBeat(beat, CAST);
    const next = spliceSegment(beat, before.segments[1]!, "She did not look up.");
    const after = parseBeat(next, CAST);
    expect(after.segments.map((s) => s.speakerLabel)).toEqual(
      before.segments.map((s) => s.speakerLabel),
    );
    expect(after.segments[1]!.content).toBe("She did not look up.");
  });

  test("splicing the last segment keeps the label", () => {
    const { segments } = parseBeat(beat, CAST);
    const next = spliceSegment(beat, segments[1]!, "Nothing.");
    expect(next.endsWith("**Mira Vance:** Nothing.")).toBe(true);
  });
});
