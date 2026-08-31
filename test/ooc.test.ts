import { describe, expect, test } from "bun:test";
import { OocSplitter, splitOoc } from "../server/generation/ooc.ts";

/**
 * The OOC splitter (SPEC §12, §20 phase 23).
 *
 * Two rules, the same two the beat parser and the reasoning splitter hold to:
 * never lose text, and end up with the same result whether the input arrived in
 * one piece or fifty. The second is the one worth testing hard, because a
 * marker split across a network chunk is not an edge case — it is what happens
 * on a phone.
 */

/** Feed a string one character at a time, which is the worst case. */
function byChar(text: string) {
  const splitter = new OocSplitter();
  let prose = "";
  for (const character of text) prose += splitter.push(character).prose;
  prose += splitter.flush().prose;
  return { prose, ooc: splitter.result() };
}

describe("finding an aside", () => {
  test("the marker the invitation asks for", () => {
    expect(splitOoc("She set it down. ((Do you want her angrier?))")).toEqual({
      prose: "She set it down. ",
      ooc: "Do you want her angrier?",
    });
  });

  test("the bracketed forms models emit unprompted", () => {
    // Interop: roleplay finetunes produce these without being asked, and an app
    // that ignored them would put the aside in the scene.
    expect(splitOoc("Text. [OOC: shall I skip ahead?]").ooc).toBe("shall I skip ahead?");
    expect(splitOoc("Text. (OOC: shall I skip ahead?)").ooc).toBe("shall I skip ahead?");
    expect(splitOoc("Text. [ooc]shall I skip ahead?[/ooc]").ooc).toBe("shall I skip ahead?");
  });

  test("an aside in the middle closes the gap it left", () => {
    // Not `Before.  After.`: an aside lifted out of a paragraph would otherwise
    // leave a double space in the scene for every aside the author writes,
    // which a reader notices and cannot explain.
    expect(splitOoc("Before. ((aside)) After.")).toEqual({
      prose: "Before. After.",
      ooc: "aside",
    });
  });

  test("a paragraph break after an aside survives", () => {
    // Spaces and tabs only. A newline is a break the author meant.
    expect(splitOoc("Before.\n\n((aside))\n\nAfter.").prose).toBe("Before.\n\n\n\nAfter.");
  });

  test("several asides stay apart rather than running together", () => {
    expect(splitOoc("A ((one)) B ((two)) C").ooc).toBe("one\n\ntwo");
  });

  test("an empty aside is not a message", () => {
    expect(splitOoc("Text. (( ))")).toEqual({ prose: "Text. ", ooc: "" });
  });
});

describe("what is not an aside", () => {
  test("ordinary parenthetical prose survives", () => {
    const text = "She paused (only for a moment) and went on.";
    expect(splitOoc(text)).toEqual({ prose: text, ooc: "" });
  });

  test("a single-paren OOC needs the tag, or it would eat the sentence", () => {
    const text = "He shrugged (as he always did) and left.";
    expect(splitOoc(text).ooc).toBe("");
  });

  test("an unterminated aside is prose, marker and all", () => {
    // The opposite of the reasoning splitter's rule, and deliberately so. `((`
    // is a sequence fiction does contain, and eating the rest of a turn on a
    // stray double-paren is far worse than showing one.
    expect(splitOoc("She said ((and then the stream died")).toEqual({
      prose: "She said ((and then the stream died",
      ooc: "",
    });
  });

  test("a turn with no marker is untouched", () => {
    const text = "Nothing here but prose, and a lot of it.";
    expect(splitOoc(text)).toEqual({ prose: text, ooc: "" });
  });
});

describe("streaming", () => {
  test("a marker split across chunks is still found", () => {
    const splitter = new OocSplitter();
    let prose = "";
    for (const chunk of ["She set it down. (", "(Do you want ", "her angrier?)", ")"]) {
      prose += splitter.push(chunk).prose;
    }
    prose += splitter.flush().prose;
    expect(prose).toBe("She set it down. ");
    expect(splitter.result()).toBe("Do you want her angrier?");
  });

  test("a lone open paren is held, then released when it turns out to be prose", () => {
    const splitter = new OocSplitter();
    // Held: it could still be the start of `((`.
    expect(splitter.push("She paused (").prose).toBe("She paused ");
    expect(splitter.push("only a moment) and went on.").prose).toBe(
      "(only a moment) and went on.",
    );
    expect(splitter.result()).toBe("");
  });

  test("character by character gives the same answer as all at once", () => {
    for (const text of [
      "She set it down. ((Do you want her angrier?))",
      "Before. ((aside)) After.",
      "She paused (only for a moment) and went on.",
      "A ((one)) B ((two)) C",
      "Text. [OOC: shall I skip ahead?] More.",
      "She said ((and then the stream died",
      "No markers at all.",
    ]) {
      expect(byChar(text), text).toEqual(splitOoc(text));
    }
  });

  test("nothing is lost: prose plus asides account for every character", () => {
    // Not a strict equality — the markers themselves are consumed — but no text
    // between them may go missing.
    const text = "One ((two)) three ((four)) five";
    const split = splitOoc(text);
    expect(split.prose).toBe("One three five");
    expect(split.ooc).toBe("two\n\nfour");
  });

  test("isAside reports while a marker is open", () => {
    const splitter = new OocSplitter();
    splitter.push("Text ((partial");
    expect(splitter.isAside).toBe(true);
    splitter.push("))");
    expect(splitter.isAside).toBe(false);
  });
});
