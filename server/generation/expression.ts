/**
 * Pulling author-declared expressions out of a turn (SPEC §12, §20 phase 29).
 *
 * In author mode the author already knows who is emoting and how, so the spec's
 * cheaper option is the right one: the model declares it inline — `<expr>ana:
 * worried</expr>` — and the app parses and strips it, storing the label on the
 * message. Zero extra inference, and a classifier can only guess at what the
 * author knows for certain.
 *
 * The mechanics are the OOC splitter's, for the same reason: a marker can
 * arrive split across two network chunks, so a partial `<expr` is held back
 * until it settles. The failure mode is different and deliberately the
 * opposite of reasoning's: an unclosed tag is **prose**, because `<expr` is
 * not a sequence fiction contains, but eating the rest of a turn on a stray
 * `<` would still be worse than showing it — so it is shown, tag and all.
 *
 * Pure and incremental: no imports, no state beyond the splitter's own.
 */

export interface DeclaredExpression {
  /** The character name, or null when the turn is a single character's. */
  character: string | null;
  /** The label — a GoEmotions name or a custom one, lowercased. */
  label: string;
}

const OPEN = "<expr>";
const CLOSE = "</expr>";

function indexOfCaseless(haystack: string, needle: string, from = 0): number {
  return haystack.toLowerCase().indexOf(needle.toLowerCase(), from);
}

/** How much of the tail could still be the start of a tag. */
function heldSuffixLength(text: string, needle: string): number {
  for (let take = Math.min(needle.length - 1, text.length); take > 0; take -= 1) {
    const tail = text.slice(text.length - take).toLowerCase();
    if (needle.toLowerCase().startsWith(tail)) return take;
  }
  return 0;
}

export interface ExprSplit {
  prose: string;
}

/** Parse `ana:worried` or `worried` into its parts. */
export function parseDeclaredExpression(inside: string): DeclaredExpression | null {
  const trimmed = inside.trim();
  if (trimmed === "") return null;
  const colon = trimmed.indexOf(":");
  if (colon === -1) {
    const label = normalise(trimmed);
    return label === "" ? null : { character: null, label };
  }
  const character = trimmed.slice(0, colon).trim();
  const label = normalise(trimmed.slice(colon + 1));
  if (label === "") return null;
  return { character: character === "" ? null : character, label };
}

function normalise(value: string): string {
  return value.replace(/\s+/g, "_").toLowerCase();
}

export class ExprSplitter {
  private pending = "";
  private inside: string | null = null;
  /** Expressions completed so far, in order. */
  private readonly done: DeclaredExpression[] = [];

  push(text: string): ExprSplit {
    this.pending += text;
    let prose = "";

    for (;;) {
      if (this.inside === null) {
        const at = indexOfCaseless(this.pending, OPEN);
        if (at === -1) break;
        prose += this.pending.slice(0, at);
        this.pending = this.pending.slice(at + OPEN.length);
        this.inside = "";
        continue;
      }

      const end = indexOfCaseless(this.pending, CLOSE);
      if (end === -1) break;
      this.inside += this.pending.slice(0, end);
      this.pending = this.pending.slice(end + CLOSE.length);
      const parsed = parseDeclaredExpression(this.inside);
      this.inside = null;
      if (parsed !== null) this.done.push(parsed);
    }

    const held = heldSuffixLength(
      this.pending,
      this.inside === null ? OPEN : CLOSE,
    );
    const settled = this.pending.slice(0, this.pending.length - held);
    this.pending = this.pending.slice(this.pending.length - held);
    if (this.inside === null) prose += settled;
    else this.inside += settled;

    return { prose };
  }

  /** An unclosed tag is prose — shown, never eaten (see the module note). */
  flush(): ExprSplit {
    const rest = this.pending;
    this.pending = "";
    if (this.inside === null) return { prose: rest };
    const open = OPEN;
    const inner = this.inside;
    this.inside = null;
    return { prose: open + inner + rest };
  }

  /** Every completed expression, in order. */
  result(): DeclaredExpression[] {
    return [...this.done];
  }
}

/** Split a whole finished string. The streaming path and this must agree. */
export function splitExpr(text: string): { prose: string; expressions: DeclaredExpression[] } {
  const splitter = new ExprSplitter();
  const first = splitter.push(text);
  const rest = splitter.flush();
  return { prose: first.prose + rest.prose, expressions: splitter.result() };
}
