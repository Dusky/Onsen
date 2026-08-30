/**
 * Pulling reasoning out of a stream (SPEC §13).
 *
 * Two things emit reasoning and they arrive by different routes.
 *
 * **A provider field.** DeepSeek, vLLM and OpenRouter put it in
 * `delta.reasoning_content` (or `delta.reasoning`), separate from the prose.
 * The adapter surfaces that directly and there is nothing to parse.
 *
 * **Inline tags.** Most local models emit `<think>…</think>` straight into the
 * content, and that is a *streaming* problem rather than a parsing one: the tag
 * can be split across chunks, so `<thi` may arrive with the prose that precedes
 * it. Showing the reader a stray `<think>` for one frame is the failure this
 * module exists to prevent, so anything that could still turn out to be a tag is
 * held back until it is settled either way.
 *
 * Pure and incremental, like the beat parser: no imports, no state beyond the
 * splitter's own, and the same two rules — never lose text, and end up with the
 * same result whether the input arrived in one piece or fifty.
 */

/** The tag pairs seen in the wild. Matched case-insensitively. */
const TAG_PAIRS: readonly [string, string][] = [
  ["<think>", "</think>"],
  ["<thinking>", "</thinking>"],
  ["<reasoning>", "</reasoning>"],
  ["<reflection>", "</reflection>"],
];

const OPENERS = TAG_PAIRS.map(([open]) => open);

export interface ReasoningSplit {
  /** Text for the reader. */
  prose: string;
  /** Text for the reasoning strip. */
  reasoning: string;
}

/**
 * How much of the tail could still be the beginning of a tag.
 *
 * A prefix of an opener has to be held: `<thi` is either the start of `<think>`
 * or four literal characters, and which one it is has not arrived yet.
 */
function heldSuffixLength(text: string, candidates: readonly string[]): number {
  const longest = Math.max(...candidates.map((candidate) => candidate.length));
  for (let take = Math.min(longest - 1, text.length); take > 0; take -= 1) {
    const tail = text.slice(text.length - take).toLowerCase();
    if (candidates.some((candidate) => candidate.toLowerCase().startsWith(tail))) return take;
  }
  return 0;
}

function indexOfCaseless(haystack: string, needle: string, from = 0): number {
  return haystack.toLowerCase().indexOf(needle.toLowerCase(), from);
}

/**
 * A streaming splitter. Feed it chunks; it returns the prose and reasoning that
 * are settled so far, holding back anything still ambiguous.
 *
 * `flush()` releases whatever is being held, which matters for the case that
 * actually happens: a model opens `<think>` and the stream ends before it
 * closes. That text is reasoning, not prose — treating an unterminated block as
 * prose would print the model's private planning into the scene.
 */
export class ReasoningSplitter {
  /** Text seen but not yet classified. */
  private pending = "";
  /** Set while inside a block, to the closer being looked for. */
  private closer: string | null = null;

  push(text: string): ReasoningSplit {
    this.pending += text;
    let prose = "";
    let reasoning = "";

    for (;;) {
      if (this.closer === null) {
        const hit = firstOpener(this.pending);
        if (hit === null) break;
        prose += this.pending.slice(0, hit.at);
        this.pending = this.pending.slice(hit.at + hit.open.length);
        this.closer = hit.close;
        continue;
      }

      const end = indexOfCaseless(this.pending, this.closer);
      if (end === -1) break;
      reasoning += this.pending.slice(0, end);
      this.pending = this.pending.slice(end + this.closer.length);
      this.closer = null;
    }

    // Whatever is left is either safe to release or might still be a tag.
    const held = heldSuffixLength(this.pending, this.closer === null ? OPENERS : [this.closer]);
    const settled = this.pending.slice(0, this.pending.length - held);
    this.pending = this.pending.slice(this.pending.length - held);
    if (this.closer === null) prose += settled;
    else reasoning += settled;

    return { prose, reasoning };
  }

  /** Release what is held. An unclosed block is reasoning, not prose. */
  flush(): ReasoningSplit {
    const rest = this.pending;
    this.pending = "";
    const inside = this.closer !== null;
    this.closer = null;
    return inside ? { prose: "", reasoning: rest } : { prose: rest, reasoning: "" };
  }

  /** True while inside a block, so a caller can report "still thinking". */
  get isThinking(): boolean {
    return this.closer !== null;
  }
}

function firstOpener(text: string): { at: number; open: string; close: string } | null {
  let best: { at: number; open: string; close: string } | null = null;
  for (const [open, close] of TAG_PAIRS) {
    const at = indexOfCaseless(text, open);
    if (at === -1) continue;
    if (best === null || at < best.at) best = { at, open, close };
  }
  return best;
}

/** Split a whole finished string. The streaming path and this must agree. */
export function splitReasoning(text: string): ReasoningSplit {
  const splitter = new ReasoningSplitter();
  const first = splitter.push(text);
  const rest = splitter.flush();
  return {
    prose: first.prose + rest.prose,
    reasoning: first.reasoning + rest.reasoning,
  };
}

/* ------------------------------------------------------------------ */
/* Re-injection (SPEC §13)                                             */
/* ------------------------------------------------------------------ */

/**
 * §13: "Do not feed reasoning back into multi-turn context by default — most
 * providers advise against it. Make re-injection of the last N blocks an opt-in
 * with configurable prefix/suffix."
 *
 * Off is expressed as zero blocks rather than a separate flag, so there is one
 * thing to read and no way for a flag and a count to disagree.
 */
export interface ReasoningConfig {
  /** How many of the most recent blocks to re-inject. 0 is off, and is default. */
  reinjectLast: number;
  prefix: string;
  suffix: string;
  /** Strip inline tags from the prose. On: a stray `<think>` is never a turn. */
  parseInline: boolean;
}

export const REASONING_DEFAULTS: ReasoningConfig = {
  reinjectLast: 0,
  prefix: "Your earlier reasoning:",
  suffix: "",
  parseInline: true,
};

export function parseReasoningConfig(json: string | null): ReasoningConfig {
  if (json === null) return { ...REASONING_DEFAULTS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ...REASONING_DEFAULTS };
  }
  if (typeof parsed !== "object" || parsed === null) return { ...REASONING_DEFAULTS };
  const raw = parsed as Partial<ReasoningConfig>;
  return {
    reinjectLast:
      typeof raw.reinjectLast === "number" && Number.isInteger(raw.reinjectLast)
        ? Math.max(0, Math.min(20, raw.reinjectLast))
        : REASONING_DEFAULTS.reinjectLast,
    prefix: typeof raw.prefix === "string" ? raw.prefix : REASONING_DEFAULTS.prefix,
    suffix: typeof raw.suffix === "string" ? raw.suffix : REASONING_DEFAULTS.suffix,
    parseInline:
      typeof raw.parseInline === "boolean" ? raw.parseInline : REASONING_DEFAULTS.parseInline,
  };
}
