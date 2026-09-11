import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { emphasis, isPlain } from "../client/lib/emphasis.ts";

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
    expect(BLOCK).toContain("<Emphasis text={paragraph} />");
    expect(LOG).toContain("<Emphasis text={active.text} />");
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
