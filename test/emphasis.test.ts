import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { emphasis, isPlain, plainText } from "../client/lib/emphasis.ts";

/**
 * Bold and italics in the reading surface (§20 phase 161).
 *
 * Roleplay prose is written in asterisks and this app rendered them as
 * asterisks, so a paragraph of `*she looked up*` was a paragraph of
 * punctuation. Two marks, no markdown library, and no
 * `dangerouslySetInnerHTML` — which appears zero times repo-wide and is going
 * to stay that way.
 *
 * The governing invariant is `segments.ts`'s: never lose text. A tokenizer
 * that swallows an unmatched marker is worse than one that renders nothing,
 * because the reader cannot tell it happened. So every case below also checks
 * that the spans put together are the input again.
 */

/**
 * The input, rebuilt from its spans.
 *
 * Not the rendered text — a matched pair's marks are consumed, which is the
 * point. This puts them back, so "no text was lost" is a question with a yes
 * or no answer rather than an eyeball.
 */
function reconstructed(spans: { kind: string; text: string }[]): string {
  return spans
    .map((span) =>
      span.kind === "strong" ? `**${span.text}**` : span.kind === "em" ? `*${span.text}*` : span.text,
    )
    .join("");
}

describe("emphasis", () => {
  test("italics and bold, the two marks roleplay prose uses", () => {
    expect(emphasis("*she looked up*")).toEqual([{ kind: "em", text: "she looked up" }]);
    expect(emphasis("**Wren**")).toEqual([{ kind: "strong", text: "Wren" }]);
  });

  test("bold wins over italics, because `**` is tried first", () => {
    expect(emphasis("**bold**")).toEqual([{ kind: "strong", text: "bold" }]);
    // Not `em("") + text("bold") + em("")`, which is what a shorter-first
    // scanner produces.
    expect(emphasis("**a**b*c*")).toEqual([
      { kind: "strong", text: "a" },
      { kind: "text", text: "b" },
      { kind: "em", text: "c" },
    ]);
  });

  test("an unmatched marker is punctuation, not a swallowed paragraph", () => {
    for (const text of ["*unclosed", "she said *", "**half", "a * b", "***", "*"]) {
      expect({ text, out: reconstructed(emphasis(text)) }).toMatchObject({ out: text });
    }
    expect(emphasis("*unclosed")).toEqual([{ kind: "text", text: "*unclosed" }]);
  });

  test("arithmetic is not italics", () => {
    // CommonMark's rule, and the reason it is here: an opener may not be
    // followed by whitespace, a closer may not be preceded by it.
    expect(emphasis("2 * 3 * 4")).toEqual([{ kind: "text", text: "2 * 3 * 4" }]);
    expect(emphasis("a *b * c")).toEqual([{ kind: "text", text: "a *b * c" }]);
  });

  test("a beat's own label renders bold", () => {
    // `prompt/blocks.ts` asks for `**Name:**` line labels and `segments.ts`
    // strips them, so a beat's segment never contains one — but an ordinary
    // message that happens to carry the same shape now renders bold rather
    // than as four asterisks. That is an improvement, and it is pinned so the
    // change is deliberate rather than noticed later.
    expect(emphasis("**Wren:** She looked up.")).toEqual([
      { kind: "strong", text: "Wren:" },
      { kind: "text", text: " She looked up." },
    ]);
  });

  test("every character of the input comes out the other side", () => {
    const samples = [
      "She *turned*, slowly, and **left**.",
      "no marks at all",
      "*a**b*",
      "**a*b**",
      "***both***",
      "*multi word phrase* then **another one** and a lone * here",
      "trailing **",
      "\"*quoted*\"",
      "punctuation*inside*words",
    ];
    for (const text of samples) {
      expect({ text, out: reconstructed(emphasis(text)) }).toMatchObject({ out: text });
    }
  });

  test("nothing inside a pair is read as markup again", () => {
    // Flat on purpose: two marks are what the prose uses, and a `*word*`
    // inside a `**sentence**` is rare enough that flattening beats resolving.
    expect(emphasis("**bold *and* more**")).toEqual([
      { kind: "strong", text: "bold *and* more" },
    ]);
  });

  test("text with no asterisk is known to be plain without scanning it", () => {
    expect(isPlain("She looked up.")).toBe(true);
    expect(isPlain("She *looked up*.")).toBe(false);
    expect(isPlain('She said "hi."')).toBe(false);
  });

  test("quoted dialogue renders italic, quotes included", () => {
    expect(emphasis('"Hello."')).toEqual([{ kind: "dialogue", text: '"Hello."' }]);
    expect(emphasis('She said "Hello." and left.')).toEqual([
      { kind: "text", text: "She said " },
      { kind: "dialogue", text: '"Hello."' },
      { kind: "text", text: " and left." },
    ]);
  });

  test("marks inside speech are marks, not asterisks on screen", () => {
    /*
     * Phase 217 made a quoted run one terminal span, and phase 221 undid that
     * for what is *inside* it. The reason the trade differs: the asterisk pairs
     * flatten what is nested in them because a `**` is a mark somebody chose to
     * write and the rare nested one is not worth resolving. A quote is not a
     * mark — it is punctuation, in nearly every line of dialogue the app
     * renders — so applying the same trade put `**has**` on screen verbatim, in
     * the middle of the prose, in the reader's own live scene.
     */
    const spans = emphasis('"…road **has** a name."');
    expect(spans).toHaveLength(1);
    expect(spans[0]!.kind).toBe("dialogue");
    expect(spans[0]!.children?.map((child) => `${child.kind}:${child.text}`)).toEqual([
      'text:"',
      "text:…road ",
      "strong:has",
      "text: a name.",
      'text:"',
    ]);
  });

  test("speech with nothing in it keeps the shape it always had", () => {
    // The common case by a distance, and it carries no children at all: one
    // span, nothing for the renderer to walk.
    expect(emphasis('"Hello."')).toEqual([{ kind: "dialogue", text: '"Hello."' }]);
    expect(emphasis('"Hello."')[0]!.children).toBeUndefined();
  });

  test("the round-trip is exact whether or not speech carries marks", () => {
    // `text` still holds the whole run, quotes included, so `segments.ts`'s
    // "never lose text" invariant is untouched — which is what a recast splice
    // depends on, since its offsets address the canonical string.
    for (const text of [
      '"…road **has** a name."',
      'He said "it is *fine*" and left.',
      '"a *b* c" then "d **e** f"',
      '"<b>shouted</b>"',
      '"nothing in here"',
    ]) {
      expect({ text, out: emphasis(text).map((span) => span.text).join("") }).toEqual({
        text,
        out: text,
      });
    }
  });

  test("an unclosed quote is literal, never swallowed", () => {
    expect(emphasis('She said "Hello.')).toEqual([{ kind: "text", text: 'She said "Hello.' }]);
  });

  test("coloured dialogue renders as a coloured span", () => {
    expect(emphasis('<span style="color:#e6a8d7">"Hello."</span>')).toEqual([
      { kind: "colour", text: '"Hello."', colour: "#e6a8d7" },
    ]);
    // `<font color>` is the legacy spelling, still what some presets emit.
    expect(emphasis('<font color="red">He nodded.</font>')).toEqual([
      { kind: "colour", text: "He nodded.", colour: "red" },
    ]);
  });

  test("b, i and u are the bold, italic and underline they name", () => {
    expect(emphasis("<b>bold</b>")).toEqual([{ kind: "strong", text: "bold" }]);
    expect(emphasis("<strong>bold</strong>")).toEqual([{ kind: "strong", text: "bold" }]);
    expect(emphasis("<i>it</i>")).toEqual([{ kind: "em", text: "it" }]);
    expect(emphasis("<em>it</em>")).toEqual([{ kind: "em", text: "it" }]);
    expect(emphasis("<u>under</u>")).toEqual([{ kind: "underline", text: "under" }]);
  });

  test("a line break tag is a newline, which pre-wrap draws", () => {
    expect(emphasis("a<br>b")).toEqual([
      { kind: "text", text: "a" },
      { kind: "text", text: "\n" },
      { kind: "text", text: "b" },
    ]);
  });

  test("asterisks and HTML mix in one paragraph", () => {
    expect(emphasis('*she looked up* and <span style="color:#f00">"hi."</span>')).toEqual([
      { kind: "em", text: "she looked up" },
      { kind: "text", text: " and " },
      { kind: "colour", text: '"hi."', colour: "#f00" },
    ]);
  });

  test("anything not on the whitelist is text, not markup", () => {
    for (const text of [
      "<script>alert(1)</script>",
      "<img src=x onerror=alert(1)>",
      "<a href=\"javascript:alert(1)\">x</a>",
      "<span style=\"color:url(javascript:alert(1))\">x</span>",
      "<div>block</div>",
    ]) {
      expect(emphasis(text)).toEqual([{ kind: "text", text }]);
    }
  });

  test("only the colour survives a style attribute — nothing else is applied", () => {
    // `position:fixed` and friends are in the model's string and are dropped:
    // the renderer sets `color` alone, so the extra CSS never reaches the page.
    expect(emphasis('<span style="color:red; position:fixed">x</span>')).toEqual([
      { kind: "colour", text: "x", colour: "red" },
    ]);
  });

  test("an unclosed or closing tag is literal, never swallowed", () => {
    expect(emphasis("<b>unclosed")).toEqual([{ kind: "text", text: "<b>unclosed" }]);
    expect(emphasis("she said </b> nothing")).toEqual([
      { kind: "text", text: "she said </b> nothing" },
    ]);
  });

  test("colour inside colour keeps the outer and flattens the inner", () => {
    // Outer wins, the same trade the asterisks make: the rare nested bold is
    // flattened into the colour rather than resolved ambiguously.
    expect(emphasis('<span style="color:#f00"><b>bold</b> *and*</span>')).toEqual([
      { kind: "colour", text: "bold and", colour: "#f00" },
    ]);
  });
});

/**
 * Both reading surfaces run it, and neither reaches for HTML to do so.
 *
 * The streaming tail is a separate element from a finished turn's paragraphs —
 * `MessageLog` renders `active.text` in its own `<p>` — so it is the half that
 * silently drifts. Formatting that appeared only when a turn completed would
 * reflow the whole paragraph at the moment the reader's eye is on it, which
 * reads as the app changing its mind.
 */
describe("where it is used", () => {
  const ROOT = join(import.meta.dir, "..");
  const BLOCK = readFileSync(join(ROOT, "client", "components", "MessageBlock.tsx"), "utf8");
  const LOG = readFileSync(join(ROOT, "client", "screens", "chat", "MessageLog.tsx"), "utf8");

  test("a finished turn and the streaming tail share one renderer", () => {
    /*
     * The spelling of the tail's call changed in §20 phase 223, when it gained
     * the `Name:` strip, so this asserts the relationship rather than the
     * literal: both surfaces render prose through `Emphasis`, and the tail's
     * text is still derived from `active.text` rather than from some second
     * path. A guard pinned to the exact JSX fails on formatting and says
     * nothing about the property it is named for.
     */
    expect(BLOCK).toContain("<Emphasis text={paragraph} colour={colour} />");
    expect(LOG).toContain("<Emphasis");
    expect(LOG).toContain("active.text");
    // Two uses in the log, both accounted for: the streaming tail and phase
    // 213's conversation bubble. Neither renders prose any other way, which is
    // the property — a third would be a renderer free to drift from these.
    expect(LOG.match(/<Emphasis/g)?.length).toBe(2);
  });

  test("it builds elements, never an HTML string", () => {
    expect(BLOCK).toContain("<strong");
    expect(BLOCK).toContain("<em");
  });

  test("and the client still has no `dangerouslySetInnerHTML` anywhere", () => {
    // The invariant this whole approach exists to keep, asserted over the
    // whole client rather than the two files that render prose — the reason
    // there is no markdown library here is that one would have meant auditing
    // what it renders and holding this line anyway.
    //
    // Comments are stripped first, the way `density.test.ts` does: this file
    // and `MessageBlock` both explain the rule in prose, and a guard that
    // reads its own explanation as the violation is a guard nobody can write
    // about.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry)) continue;
        const code = readFileSync(path, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\/\/[^\n]*/g, "");
        if (code.includes("dangerouslySetInnerHTML")) offenders.push(path.slice(ROOT.length + 1));
      }
    };
    walk(join(ROOT, "client"));
    expect(offenders).toEqual([]);
  });

  test("the paragraph split and its pre-wrap survive", () => {
    // A single newline inside a paragraph is the model's own line break. The
    // emphasis runs inside each paragraph and changes neither.
    expect(BLOCK).toContain("text.split(/\\n{2,}/)");
    expect(BLOCK).toContain("whitespace-pre-wrap");
  });
});


/**
 * The same prose with its marks taken off (§20 phase 229).
 *
 * The right rail's "just spoke" card was the one place in the app that showed
 * raw markup: `**Elira Voss:** took two keys off the board…`, six inches from
 * a transcript rendering the same content with a coloured label and no
 * asterisks. `plainText` is the fix, and it is built on the tokenizer rather
 * than on a regex of its own so there is one set of rules about what a mark
 * is.
 */
describe("prose with its marks taken off", () => {
  const ROOT = join(import.meta.dir, "..");

  test("the marks come off and the words stay", () => {
    expect(plainText("**Elira Voss:** took two keys, *quietly*"))
      .toBe("Elira Voss: took two keys, quietly");
  });

  /**
   * The case the obvious implementation gets wrong.
   *
   * A `dialogue` span's `text` holds the whole run *including* the marks
   * inside it — deliberately, and `emphasis.ts` documents why — so
   * `spans.map((s) => s.text).join("")` gives back `that road **has** a name.`
   * with its asterisks intact. It looks right, it passes the test above, and
   * it is wrong. `plainText` has to recurse into `children`.
   */
  test("marks inside a line of speech come off too", () => {
    const flat = plainText('and said "that road **has** a name."');
    expect(flat).toBe('and said "that road has a name."');
    expect(flat).not.toContain("*");
  });

  test("a coloured run keeps its words and loses its tag", () => {
    // The speaker's colour is chrome a 90-character card has no room for; the
    // words are the point. The tokenizer has already flattened the run, so
    // this is asserting that nothing puts the markup back.
    const flat = plainText('<span style="color:#f00"><b>bold</b> *and*</span> quiet');
    expect(flat).toBe("bold and quiet");
  });

  test("plain prose is returned unchanged", () => {
    const plain = "She took two keys off the board behind her.";
    expect(plainText(plain)).toBe(plain);
  });

  /**
   * The governing invariant of this file, one layer on: never lose text.
   *
   * An unmatched marker is literal, so stripping cannot silently eat it — the
   * card would show a shorter sentence than the turn and the reader could not
   * tell.
   */
  test("an unmatched marker survives as itself", () => {
    expect(plainText("two keys * and a ring")).toBe("two keys * and a ring");
  });

  /**
   * The cast card goes through it rather than growing its own rules.
   *
   * Structural, because the card is a component and this project runs no DOM
   * tests. What it pins is the thing that regresses: somebody adds a third
   * place that shows a line of a turn, strips asterisks with a regex of its
   * own, and the two surfaces disagree about what a mark is within a phase.
   */
  test("the cast card cuts the flattened text, not the raw text", () => {
    const rail = readFileSync(join(ROOT, "client", "components", "CastRail.tsx"), "utf8");
    expect(rail).toContain("plainText");
    // Flattened *before* the cut, so the 90-character limit counts characters
    // a reader sees rather than ones the model wrote.
    expect(rail).toMatch(/plainText\(text\)\.replace/);
    // And no second set of markup rules beside it.
    expect(rail.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/replace\(\/\\\*/);
  });
});
