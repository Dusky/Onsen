/**
 * Pulling out-of-character asides out of a turn (SPEC §12, §20 phase 23).
 *
 * The author is a collaborator, not a puppet, and §2 gives it an `ooc_voice`
 * for exactly this: stepping out of the scene to ask a question, flag a
 * problem, or check a direction. What it cannot do is say that *inside* the
 * prose — a line of authorial commentary sitting in the middle of a scene is
 * the single most common way a roleplay turn is ruined.
 *
 * So the aside is split out of the stream and stored as its own message, the
 * same way §13's reasoning is. The mechanics are the reasoning splitter's, and
 * for the same reason: a marker can arrive split across two network chunks, so
 * `((` may land with the prose that precedes it. Anything that could still turn
 * out to be a marker is held back until it is settled either way.
 *
 * The two differences from reasoning are deliberate. Reasoning that is never
 * closed is reasoning — better to hide the model's planning than print it. An
 * OOC aside that is never closed is **prose**, because the marker is an ordinary
 * character sequence that fiction does sometimes contain, and eating the rest of
 * a scene on a stray double-paren is far worse than showing one.
 *
 * Pure and incremental: no imports, no state beyond the splitter's own, and the
 * same two rules as the beat parser — never lose text, and end up with the same
 * result whether the input arrived in one piece or fifty.
 */

/**
 * The markers, in the order they are looked for.
 *
 * `((…))` is the one the invitation block asks for by name, and the one §21's
 * inline commands already use in the other direction. The bracketed forms are
 * interop: models fine-tuned on roleplay data emit `[OOC: …]` and `(OOC: …)`
 * unprompted, and an app that ignored them would put the aside in the scene.
 *
 * The single-paren form is safe only because of the literal `OOC:` inside it —
 * without that it would swallow ordinary parenthetical prose.
 */
const MARKERS: readonly { open: string; close: string; requiresTag: boolean }[] = [
  { open: "((", close: "))", requiresTag: false },
  { open: "[OOC:", close: "]", requiresTag: true },
  { open: "[ooc]", close: "[/ooc]", requiresTag: true },
  { open: "(OOC:", close: ")", requiresTag: true },
];

const OPENERS = MARKERS.map((marker) => marker.open);

export interface OocSplit {
  /** Text for the scene. */
  prose: string;
  /** Text for the OOC channel. May be several asides, joined by blank lines. */
  ooc: string;
}

function indexOfCaseless(haystack: string, needle: string, from = 0): number {
  return haystack.toLowerCase().indexOf(needle.toLowerCase(), from);
}

/**
 * How much of the tail could still be the beginning of a marker.
 *
 * `((` is two characters, so a lone `(` at the end of a chunk has to be held:
 * it is either the start of an aside or a literal parenthesis, and which one
 * has not arrived yet.
 */
function heldSuffixLength(text: string, candidates: readonly string[]): number {
  const longest = Math.max(...candidates.map((candidate) => candidate.length));
  for (let take = Math.min(longest - 1, text.length); take > 0; take -= 1) {
    const tail = text.slice(text.length - take).toLowerCase();
    if (candidates.some((candidate) => candidate.toLowerCase().startsWith(tail))) return take;
  }
  return 0;
}

function firstOpener(text: string): { at: number; open: string; close: string } | null {
  let best: { at: number; open: string; close: string } | null = null;
  for (const marker of MARKERS) {
    const at = indexOfCaseless(text, marker.open);
    if (at === -1) continue;
    if (best === null || at < best.at) best = { at, open: marker.open, close: marker.close };
  }
  return best;
}

export class OocSplitter {
  private pending = "";
  private closer: string | null = null;
  /** Text of the aside currently being read, so it can be released whole. */
  private inside = "";
  /** Asides completed so far, kept apart so they are not run together. */
  private readonly done: string[] = [];
  /**
   * Set after an aside closes, until the next prose is emitted.
   *
   * An aside lifted out of the middle of a paragraph leaves a seam: the space
   * before it and the space after it are both still there, so `A ((x)) B`
   * becomes `A  B`. Collapsing that is a small violation of "never lose text",
   * and it is the right one — the alternative is a double space in the scene
   * for every aside the author writes, which the reader would notice and could
   * not explain.
   *
   * Spaces and tabs only. A newline after an aside is a paragraph break the
   * author meant, and eating it would run two paragraphs together.
   */
  private closing = false;

  push(text: string): OocSplit {
    this.pending += text;
    let prose = "";

    for (;;) {
      if (this.closer === null) {
        const hit = firstOpener(this.pending);
        if (hit === null) break;
        prose += this.seam(this.pending.slice(0, hit.at));
        this.pending = this.pending.slice(hit.at + hit.open.length);
        this.closer = hit.close;
        continue;
      }

      const end = indexOfCaseless(this.pending, this.closer);
      if (end === -1) break;
      this.inside += this.pending.slice(0, end);
      this.pending = this.pending.slice(end + this.closer.length);
      this.closer = null;
      const aside = this.inside.trim();
      this.inside = "";
      if (aside !== "") this.done.push(aside);
      this.closing = true;
    }

    const held = heldSuffixLength(this.pending, this.closer === null ? OPENERS : [this.closer]);
    const settled = this.pending.slice(0, this.pending.length - held);
    this.pending = this.pending.slice(this.pending.length - held);
    if (this.closer === null) prose += this.seam(settled);
    else this.inside += settled;

    // The prose is emitted as it settles; the asides are only whole once their
    // closer arrives, so they are reported by `result()` rather than per chunk.
    return { prose, ooc: "" };
  }

  /**
   * Release what is held.
   *
   * An unterminated aside is **prose**, marker and all. `((` is a sequence
   * fiction does contain, and eating the remainder of a turn because a model
   * opened one and never closed it is a far worse failure than showing the
   * reader a stray double-paren.
   */
  flush(): OocSplit {
    const rest = this.pending;
    this.pending = "";
    if (this.closer === null) return { prose: rest, ooc: "" };
    const opener = MARKERS.find((marker) => marker.close === this.closer)?.open ?? "";
    const unterminated = this.inside;
    this.inside = "";
    this.closer = null;
    return { prose: opener + unterminated + rest, ooc: "" };
  }

  /** Close the gap an aside left behind. See `closing`. */
  private seam(text: string): string {
    if (!this.closing) return text;
    const trimmed = text.replace(/^[ \t]+/, "");
    // Still closing if nothing arrived: the space to eat may be in the next
    // chunk, since a network chunk can end exactly on the closing marker.
    if (text !== "") this.closing = false;
    return trimmed;
  }

  /** Every completed aside, joined. Empty when the turn had none. */
  result(): string {
    return this.done.join("\n\n");
  }

  /** True while inside an aside, so a caller can hold back a partial marker. */
  get isAside(): boolean {
    return this.closer !== null;
  }
}

/** Split a whole finished string. The streaming path and this must agree. */
export function splitOoc(text: string): OocSplit {
  const splitter = new OocSplitter();
  const first = splitter.push(text);
  const rest = splitter.flush();
  return { prose: first.prose + rest.prose, ooc: splitter.result() };
}
