import { describe, expect, test } from "bun:test";
import { wrapSelection } from "../client/lib/marks.ts";
import { emphasis } from "../client/lib/emphasis.ts";

/**
 * ⌘/Ctrl+B and +I in the composer (§20 phase 166).
 *
 * The one part of the reader controls that is real logic rather than a switch,
 * so it is tested as logic. The invariant that matters is the round trip: what
 * this writes, `emphasis` has to read back as the emphasis that was asked for.
 * A formatting key that produces markup the renderer shows as literal
 * asterisks is worse than no key.
 */

/** What the tokenizer makes of a string, as a shape a test can state. */
function spans(text: string) {
  return emphasis(text).map((span) => `${span.kind}:${span.text}`);
}

describe("wrapping a selection", () => {
  test("wraps what is selected and selects it again", () => {
    const out = wrapSelection("she raised her staff", 4, 10, "*")!;
    expect(out.text).toBe("she *raised* her staff");
    // Around the text, not after it: the next thing a writer does is often to
    // emphasise the same phrase differently.
    expect(out.text.slice(out.start, out.end)).toBe("raised");
  });

  test("bold and italic are the tokenizer's own two marks", () => {
    expect(wrapSelection("no", 0, 2, "**")!.text).toBe("**no**");
    expect(spans(wrapSelection("no", 0, 2, "**")!.text)).toEqual(["strong:no"]);
    expect(spans(wrapSelection("no", 0, 2, "*")!.text)).toEqual(["em:no"]);
  });

  test("a collapsed caret opens the pair and sits inside it", () => {
    const out = wrapSelection("say ", 4, 4, "*")!;
    expect(out.text).toBe("say **");
    expect(out.start).toBe(5);
    expect(out.end).toBe(5);
  });
});

describe("pressing it again takes it off", () => {
  /**
   * Without this the second press produces `****text****`, which
   * `client/lib/emphasis.ts` renders as literal asterisks around bold text —
   * a formatting control that corrupts formatting.
   */
  test("with the marks inside the selection", () => {
    const out = wrapSelection("she **ran** home", 4, 11, "**")!;
    expect(out.text).toBe("she ran home");
    expect(out.text.slice(out.start, out.end)).toBe("ran");
  });

  test("with the selection between them", () => {
    // What a double-click on the word gives you.
    const out = wrapSelection("she **ran** home", 6, 9, "**")!;
    expect(out.text).toBe("she ran home");
    expect(out.text.slice(out.start, out.end)).toBe("ran");
  });

  test("never turning bold into italic behind the reader's back", () => {
    /*
     * `**x**` selected as `x` looks to a `*` unwrapper like `*` + `x` + `*`,
     * because emphasis is longest-match-first and the outer pair's inner marks
     * are single asterisks. Unwrapping there would leave `*x*` where `**x**`
     * was: ⌘+I on bold text silently making it italic.
     */
    const out = wrapSelection("**bold**", 2, 6, "*");
    expect(out!.text).not.toBe("*bold*");
    expect(spans(out!.text)).not.toEqual(["em:bold"]);
  });
});

describe("what it refuses", () => {
  test("a selection crossing a blank line", () => {
    // Paragraphs are split on a blank line before the tokenizer sees them, so
    // this would produce two unmatched markers rendered literally.
    expect(wrapSelection("one\n\ntwo", 0, 8, "*")).toBeNull();
  });

  test("an impossible range, rather than guessing at one", () => {
    expect(wrapSelection("abc", 2, 1, "*")).toBeNull();
    expect(wrapSelection("abc", 0, 9, "*")).toBeNull();
    expect(wrapSelection("abc", -1, 2, "*")).toBeNull();
  });
});

describe("the round trip holds", () => {
  test("everything it writes, the renderer reads back as emphasis", () => {
    for (const [text, start, end] of [
      ["plain words here", 6, 11],
      ["one", 0, 3],
      ["a b c d", 2, 5],
      ["trailing space ", 0, 8],
    ] as const) {
      for (const mark of ["*", "**"] as const) {
        const out = wrapSelection(text, start, end, mark)!;
        const kind = mark === "**" ? "strong" : "em";
        expect(spans(out.text)).toContain(`${kind}:${text.slice(start, end)}`);
      }
    }
  });
});
