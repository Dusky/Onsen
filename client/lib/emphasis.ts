/**
 * Bold, italics and a small, safe subset of inline HTML, as React-friendly
 * spans rather than markup.
 *
 * Roleplay prose is written with `*asterisks*`, and the models people prefer
 * for it — the Megumin Suite presets among them — also emit inline HTML for
 * coloured dialogue: `<span style="color:#e6a8d7">"Hello."</span>`. Until now
 * this app rendered that as raw tags, because `Prose` set the model's output
 * as one text node. Two marks are a solved problem; the HTML half needed a
 * boundary.
 *
 * The boundary, and the whole reason this stays a hand-rolled tokenizer rather
 * than a markdown or HTML library:
 *
 *   - **A whitelist, and nothing else.** `b`, `strong`, `i`, `em`, `u`,
 *     `br`, and `span`/`font` carrying only a colour. Anything else — a
 *     script, an image, a link, a style attribute with a URL in it — is not a
 *     tag at all: it renders as the literal text the model wrote, exactly like
 *     an unmatched asterisk.
 *   - **Colours are re-validated.** Only `#hex`, `rgb()`/`rgba()` with
 *     numeric channels, or a letter-only name. `url(`, `expression(`, a
 *     semicolon, a brace — anything that could smuggle CSS — is rejected and
 *     the tag becomes text.
 *   - **No `dangerouslySetInnerHTML`.** The spans above become React elements
 *     (`<strong>`, `<em>`, `<u>`, a `<span style={{color}}>`), never an HTML
 *     string. That invariant appears zero times repo-wide and stays zero.
 *   - **Never lose text** (`segments.ts`'s invariant). An unmatched tag or a
 *     rejected colour is punctuation again, not an excuse to swallow the rest.
 *
 * Nesting is flattened, the same trade `emphasis` already makes for asterisks:
 * the outer HTML style wins, and what is inside it is rendered as that style's
 * text. `<span color><b>bold</b></span>` reads as coloured "bold"; the rare
 * loss of the inner bold beats resolving the ambiguity.
 */

export interface Span {
  kind: "text" | "strong" | "em" | "underline" | "colour";
  text: string;
  /** The validated colour, only when `kind === "colour"`. */
  colour?: string;
}

/** Whether a run of asterisks at `at` can open emphasis. */
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
    if (mark === "*" && text[found + 1] === "*") {
      at = found + 2;
      continue;
    }
    if (found > from && closes(text, found)) return found;
    at = found + 1;
  }
  return -1;
}

/* ------------------------------------------------------------------ */
/* The HTML whitelist                                                  */
/* ------------------------------------------------------------------ */

/** A tag read from `<...>`: its name, whether it closes, and its attributes. */
interface Tag {
  name: string;
  closing: boolean;
  attrs: string;
  /** The index of the `>` that ends the tag. */
  end: number;
}

function readTag(text: string, at: number): Tag | null {
  const end = text.indexOf(">", at);
  if (end === -1) return null;
  const inner = text.slice(at + 1, end);
  const match = /^\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)([\s\S]*)$/.exec(inner);
  if (match === null) return null;
  return {
    name: match[2]!.toLowerCase(),
    closing: match[1] === "/",
    attrs: match[3]!,
    end,
  };
}

/** Only `#hex`, numeric `rgb()`/`rgba()`, or a letter-only colour name. */
function safeColour(raw: string): string | null {
  const value = raw.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(value)) return value;
  if (/^[a-zA-Z]{3,20}$/.test(value)) return value;
  if (/^rgba?\(\s*[\d.%\s,]+\s*\)$/.test(value) && !/url|expression|;/i.test(value)) {
    return value;
  }
  return null;
}

/** The colour a `span` or `font` tag asks for, or null. */
function colourOf(attrs: string): string | null {
  const style = /style\s*=\s*"([^"]*)"|style\s*=\s*'([^']*)'/.exec(attrs);
  if (style !== null) {
    const raw = style[1] ?? style[2] ?? "";
    const colour = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(raw);
    if (colour !== null) return safeColour(colour[1]!);
  }
  const legacy = /color\s*=\s*"([^"]*)"|color\s*=\s*'([^']*)'/.exec(attrs);
  if (legacy !== null) return safeColour(legacy[1] ?? legacy[2] ?? "");
  return null;
}

/** Where `</name>` opens, from `from`, or -1. */
function closeOf(text: string, name: string, from: number): number {
  const re = new RegExp(`</\\s*${name}\\s*>`, "i");
  const match = re.exec(text.slice(from));
  return match === null ? -1 : from + match.index;
}

/** The span an HTML tag at `at` produces, or null when it is not one. */
function htmlSpan(text: string, at: number): { span: Span; next: number } | null {
  const tag = readTag(text, at);
  if (tag === null || tag.closing) return null;

  // `<br>` (any form) is a line break: pre-wrap renders the newline.
  if (tag.name === "br") {
    return { span: { kind: "text", text: "\n" }, next: tag.end + 1 };
  }

  const kind =
    tag.name === "b" || tag.name === "strong"
      ? "strong"
      : tag.name === "i" || tag.name === "em"
        ? "em"
        : tag.name === "u"
          ? "underline"
          : tag.name === "span" || tag.name === "font"
            ? "colour"
            : null;
  if (kind === null) return null;

  if (kind === "colour") {
    const colour = colourOf(tag.attrs);
    if (colour === null) {
      // A span/font that names no safe colour is not a colour at all. Treat the
      // open tag as text so the reader sees what the model actually wrote.
      return null;
    }
    const parsed = innerOf(text, tag);
    if (parsed === null) return null;
    return { span: { kind: "colour", text: parsed.inner, colour }, next: parsed.next };
  }

  const parsed = innerOf(text, tag);
  if (parsed === null) return null;
  return { span: { kind, text: parsed.inner }, next: parsed.next };
}

/** The flattened text between a tag and its closer, and the index past it. */
function innerOf(text: string, tag: Tag): { inner: string; next: number } | null {
  const close = closeOf(text, tag.name, tag.end + 1);
  if (close === -1) return null; // unclosed: the `<` stays literal text
  const closeEnd = text.indexOf(">", close);
  if (closeEnd === -1) return null;
  // The inner prose, re-parsed so asterisks still render inside it, then
  // flattened — the outer style wins, the same trade the markdown makes.
  const inner = emphasis(text.slice(tag.end + 1, close)).map((span) => span.text).join("");
  return { inner, next: closeEnd + 1 };
}

/* ------------------------------------------------------------------ */
/* The scan                                                            */
/* ------------------------------------------------------------------ */

/**
 * One paragraph's spans, in order, covering every character of the input.
 *
 * Longest match first — `**` before `*`, and an HTML tag is read whole before
 * the characters inside it are looked at again. No nesting survives: what is
 * inside a pair is flattened to its text.
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
    if (text[at] === "<") {
      const handled = htmlSpan(text, at);
      if (handled === null) {
        plain += text[at];
        at += 1;
        continue;
      }
      flush();
      spans.push(handled.span);
      at = handled.next;
      continue;
    }

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
  return !text.includes("*") && !text.includes("<");
}
