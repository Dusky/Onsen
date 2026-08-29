/**
 * CCv3 lorebook decorators (SPEC §9).
 *
 * A V3 lore entry may prefix its content with decorator lines that change how
 * the entry is inserted:
 *
 *     @@depth 4
 *     @@@instruct_depth 2
 *     The actual content of the entry.
 *
 * Two rules matter. Decorators are **stripped from the content** before the
 * text ever reaches a prompt — leaving them in would put `@@depth 4` in front
 * of the model. And a decorator this app does not understand **falls through
 * its fallback chain** rather than erroring: `@@@` marks a fallback for the
 * decorator above it, so an unknown primary is skipped in favour of the next
 * alternative, and an entry using a decorator nobody supports still inserts its
 * text.
 */

export interface Decorator {
  name: string;
  /** Everything after the name, unparsed. */
  value: string;
  /** True for `@@@`: an alternative to the decorator above it. */
  isFallback: boolean;
}

export interface DecoratedContent {
  /** The content with all decorator lines removed. */
  content: string;
  /** Every decorator found, in order, including fallbacks. */
  decorators: Decorator[];
  /** The decorators that actually apply, after resolving fallback chains. */
  applied: Decorator[];
  /** Names encountered that this app does not implement. */
  unsupported: string[];
}

/**
 * Decorators this app acts on. Anything else is preserved and reported but does
 * not affect insertion — which is what lets a card from a newer spec still work.
 */
const SUPPORTED = new Set([
  "depth",
  "instruct_depth",
  "role",
  "position",
  "activate_only_after",
  "activate_only_every",
  "keep_activate_after_match",
  "dont_activate_after_match",
  "disable_ui_prompt",
  "is_greeting",
  "ignore_on_max_context",
  "activate_after_emotion",
]);

const DECORATOR_LINE = /^(@@@?)([A-Za-z_][A-Za-z0-9_]*)\s*(.*)$/;

export function parseDecorators(raw: string): DecoratedContent {
  const lines = raw.split(/\r?\n/);
  const decorators: Decorator[] = [];
  let firstContentLine = 0;

  // Decorators only appear at the top of an entry; the first line that is not
  // one ends the block, so `@@something` inside prose is left alone.
  for (const line of lines) {
    const match = DECORATOR_LINE.exec(line.trim());
    if (match === null) break;
    decorators.push({
      isFallback: match[1] === "@@@",
      name: match[2]!.toLowerCase(),
      value: match[3]!.trim(),
    });
    firstContentLine += 1;
  }

  return {
    content: lines.slice(firstContentLine).join("\n").replace(/^\n+/, ""),
    decorators,
    applied: resolveFallbacks(decorators),
    unsupported: [
      ...new Set(decorators.filter((d) => !SUPPORTED.has(d.name)).map((d) => d.name)),
    ],
  };
}

/**
 * Walk the fallback chains. A `@@@` decorator is an alternative to the primary
 * above it: the first supported entry in each chain wins, and a chain where
 * nothing is supported contributes nothing rather than failing.
 */
function resolveFallbacks(decorators: Decorator[]): Decorator[] {
  const applied: Decorator[] = [];
  let index = 0;

  while (index < decorators.length) {
    const primary = decorators[index]!;
    // Collect this decorator and every fallback attached to it.
    const chain: Decorator[] = [primary];
    let next = index + 1;
    while (next < decorators.length && decorators[next]!.isFallback) {
      chain.push(decorators[next]!);
      next += 1;
    }

    const chosen = chain.find((candidate) => SUPPORTED.has(candidate.name));
    if (chosen !== undefined) applied.push(chosen);
    index = next;
  }

  return applied;
}

/** Read a numeric decorator, ignoring one whose value is not a number. */
export function numericDecorator(applied: Decorator[], name: string): number | null {
  const found = applied.find((decorator) => decorator.name === name);
  if (found === undefined) return null;
  const parsed = Number(found.value.split(/\s+/)[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function stringDecorator(applied: Decorator[], name: string): string | null {
  return applied.find((decorator) => decorator.name === name)?.value ?? null;
}
