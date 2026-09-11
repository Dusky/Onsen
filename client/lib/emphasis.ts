/**
 * Bold and italics, as spans rather than markup.
 *
 * Roleplay prose is written with `*asterisks*` — every model produces them,
 * every card is full of them, and until now this app rendered them as
 * asterisks, because `Prose` set the model's output as one text node. That is
 * a reasonable place to have started (SPEC §18's "content is not instruction"
 * is a rule about trust, and the safest renderer is one that renders nothing)
 * and it is a poor place to stay: a paragraph of `*she looked up*` is a
 * paragraph of punctuation.
 *
 * What this is not:
 *
 *   - **Not markdown.** Two marks, no links, no images, no headings, no HTML.
 *     Adding a markdown library would mean auditing what it renders and
 *     keeping `dangerouslySetInnerHTML` out of the app, which appears zero
 *     times repo-wide and is going to stay that way.
 *   - **Not a rewrite.** The caller gets spans over the *same* string. Segment
 *     offsets (`charStart`/`charEnd`) address canonical text including its
 *     markup, so a recast splice stays correct only while nothing edits what
 *     is stored. Nothing here edits anything.
 *   - **Not lossy.** `segments.ts` states the invariant — never lose text — and
 *     the renderer holds the same line. An unmatched marker is punctuation
 *     again, not an excuse to swallow the rest of the paragraph.
 */

export interface Span {
  kind: "text" | "strong" | "em";
  text: string;
}

/**
 * Whether a run of asterisks at `at` can open emphasis.
 *
 * CommonMark's rule, and it is the one that matters here: an opener may not be
 * followed by whitespace and a closer may not be preceded by it. Without it
 * `2 * 3 * 4` italicises `3`, and arithmetic in a scene is rarer than the bug
 * would be embarrassing.
 */
function opens(text: string, after: number): boolean {
  const next = text[after];
  return next !== undefined && !/\s/.test(next);
}

function closes(text: string, before: number): boolean {
  const previous = text[before - 1];
  return previous !== undefined && !/\s/.test(previous);
}

/** Where the matching closer for `mark` starts, or -1. */
function closerAt(text: string, mark: string, from: number): number {
  let at = from;
  while (at < text.length) {
    const found = text.indexOf(mark, at);
    if (found === -1) return -1;
    // A `**` run must not be mistaken for the `*` closer of a `*…*` pair, or
    // `*a**b*` splits in the wrong place.
    if (mark === "*" && text[found + 1] === "*") {
      at = found + 2;
      continue;
    }
    if (found > from && closes(text, found)) return found;
    at = found + 1;
  }
  return -1;
}

/**
 * One paragraph's spans, in order, covering every character of the input.
 *
 * Longest match first — `**` is tried before `*` — and no nesting: what is
 * inside a pair is its own text. Two marks are what roleplay prose uses and a
 * `*word*` inside a `**sentence**` is rare enough that flattening it is a
 * better trade than the ambiguity of resolving it.
 */
export function emphasis(text: string): Span[] {
  const spans: Span[] = [];
  let plain = "";
  const flush = () => {
    if (plain !== "") spans.push({ kind: "text", text: plain });
    plain = "";
  };

  let at = 0;
  while (at < text.length) {
    if (text[at] !== "*") {
      plain += text[at];
      at += 1;
      continue;
    }

    const double = text[at + 1] === "*";
    const mark = double ? "**" : "*";
    const from = at + mark.length;
    const end = opens(text, from) ? closerAt(text, mark, from) : -1;
    if (end === -1) {
      // No partner, or one that would enclose nothing: the asterisk is
      // punctuation and stays exactly where the model put it.
      plain += text[at];
      at += 1;
      continue;
    }

    flush();
    spans.push({ kind: double ? "strong" : "em", text: text.slice(from, end) });
    at = end + mark.length;
  }
  flush();
  return spans;
}

/** True when nothing in the text would render differently. */
export function isPlain(text: string): boolean {
  return !text.includes("*");
}
