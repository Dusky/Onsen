/**
 * Wrapping a selection in the marks the log renders (§20 phase 166).
 *
 * Its own module because the interesting part is string arithmetic with no DOM
 * in it, which means it can be tested — and because two rules here are the
 * kind that get quietly lost inside a key handler:
 *
 * **Unwrapping is the same key.** ⌘+B on text that is already bold removes the
 * bold, the way every editor behaves. Without it the second press produces
 * `****text****`, which `client/lib/emphasis.ts` renders as literal asterisks
 * around bold text — a formatting control that corrupts formatting.
 *
 * **A collapsed caret still works.** No selection inserts the pair and puts
 * the caret between the marks, so ⌘+B then typing is bold. The alternative —
 * doing nothing — makes the key feel broken exactly when a writer reaches for
 * it first.
 */

export interface Wrapped {
  text: string;
  /** Where the selection goes afterwards: around the wrapped text, not after it. */
  start: number;
  end: number;
}

/**
 * `null` when there is nothing sensible to do, so the caller can leave the
 * keystroke to the browser rather than swallowing it.
 */
export function wrapSelection(
  text: string,
  start: number,
  end: number,
  mark: "*" | "**",
): Wrapped | null {
  if (start < 0 || end < start || end > text.length) return null;

  const selected = text.slice(start, end);
  const width = mark.length;

  /*
   * Already wrapped, in either of the two ways a selection can be: the marks
   * inside the selection, or the selection sitting between them. A writer who
   * double-clicked a word gets the second; one who dragged across the marks
   * gets the first. Both have to unwrap or the key only works half the time.
   */
  if (selected.startsWith(mark) && selected.endsWith(mark) && selected.length > width * 2) {
    const inner = selected.slice(width, -width);
    return { text: text.slice(0, start) + inner + text.slice(end), start, end: start + inner.length };
  }
  const before = text.slice(Math.max(0, start - width), start);
  const after = text.slice(end, end + width);
  if (before === mark && after === mark) {
    // Emphasis is the longest match first (`**` before `*`), so a `*` asked to
    // unwrap what is really the inner half of a `**` pair would leave `*x*`
    // where `**x**` was — bold silently becoming italic. Only unwrap when the
    // marks are the whole of what is there.
    const outerBefore = text.slice(Math.max(0, start - width - 1), start - width);
    const outerAfter = text.slice(end + width, end + width + 1);
    if (outerBefore !== "*" && outerAfter !== "*") {
      return {
        text: text.slice(0, start - width) + selected + text.slice(end + width),
        start: start - width,
        end: end - width,
      };
    }
  }

  /*
   * Emphasis does not span a blank line — paragraphs are split on one before
   * the tokenizer ever sees the text — so a selection crossing one would
   * produce two unmatched markers rendered literally. Refused rather than
   * silently producing asterisks.
   */
  if (/\n\s*\n/.test(selected)) return null;

  const wrapped = `${mark}${selected}${mark}`;
  return {
    text: text.slice(0, start) + wrapped + text.slice(end),
    start: start + width,
    end: start + width + selected.length,
  };
}
