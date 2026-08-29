/**
 * Parsing a beat into segments (SPEC §3.5).
 *
 * A beat is one generation in which the author writes several characters
 * interacting. The raw text stays canonical on the message; segments are the
 * parsed view used for rendering, per-character editing (recast) and splitting.
 *
 * This module is pure — text and a cast list in, segments out — because the
 * thing it has to be is *predictable*. Two rules govern it:
 *
 * - **Never lose text.** Every character of the input belongs to exactly one
 *   segment or to the whitespace between two. When nothing parses, the whole
 *   message becomes one narration segment and is flagged, rather than being
 *   dropped or half-read.
 * - **Re-parsing is idempotent.** Offsets address the canonical content, so
 *   splicing a segment's replacement in at its offsets and parsing again gives
 *   the same segmentation back.
 */

export type SegmentSpeakerType = "character" | "narration";

export interface ParsedSegment {
  ordinal: number;
  speakerType: SegmentSpeakerType;
  /** The name exactly as it was written. Null for narration. */
  speakerLabel: string | null;
  /** The prose, with the speaker label stripped. */
  content: string;
  /**
   * Offsets into the canonical content, covering `content` alone — not the
   * label. Replacing `[charStart, charEnd)` with new prose leaves the label and
   * the surrounding blank lines exactly where they were, which is what makes
   * recast a splice rather than a rewrite.
   */
  charStart: number;
  charEnd: number;
}

export interface ParsedBeat {
  segments: ParsedSegment[];
  /**
   * True when no speaker label was found at all. The text is preserved as one
   * narration segment; the flag is what tells the UI to say so rather than
   * presenting a failed parse as a deliberate piece of narration.
   */
  degraded: boolean;
}

/**
 * A label is never this long. The cap is what stops an ordinary line of prose
 * that happens to end in a colon from being read as a speaker change.
 */
const MAX_LABEL_LENGTH = 48;

/** `**Name:**`, and the `**Name**:` variant models drift into. */
const BOLD_LABEL = new RegExp(`^\\*\\*([^*\\n]{1,${MAX_LABEL_LENGTH}}?)\\s*(?::\\s*\\*\\*|\\*\\*\\s*:)`);

interface Label {
  name: string;
  /** Offset where the prose after the label begins. */
  contentStart: number;
}

/**
 * Read a speaker label at the start of a line, or null.
 *
 * `**Name:**` is the form the prompt asks for. The other two are what models
 * actually emit when they drift: the colon outside the bold, and no bold at
 * all. The unbolded form is only accepted for a name that is actually in the
 * cast, because without that restriction every line of dialogue containing
 * "she said:" would start a new segment.
 */
function readLabel(text: string, lineStart: number, castNames: Set<string>): Label | null {
  const lineEnd = indexOfLineEnd(text, lineStart);
  const line = text.slice(lineStart, lineEnd);

  // `**Name:**` and `**Name**:`
  const bold = BOLD_LABEL.exec(line);
  if (bold !== null) {
    const name = bold[1]!.trim();
    if (name !== "") {
      return { name, contentStart: lineStart + skipInlineSpace(line, bold[0].length) };
    }
  }

  // `Name:` — only for a name we know, so prose is never split by accident.
  const colon = line.indexOf(":");
  if (colon > 0 && colon <= MAX_LABEL_LENGTH) {
    const name = line.slice(0, colon).trim();
    if (name !== "" && castNames.has(normalize(name))) {
      return { name, contentStart: lineStart + skipInlineSpace(line, colon + 1) };
    }
  }

  return null;
}

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

function indexOfLineEnd(text: string, from: number): number {
  const newline = text.indexOf("\n", from);
  return newline === -1 ? text.length : newline;
}

/** Advance past spaces and tabs only — never past a newline, which is content. */
function skipInlineSpace(line: string, from: number): number {
  let at = from;
  while (at < line.length && (line[at] === " " || line[at] === "\t")) at++;
  return at;
}

/** Every line start in the text, in order. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) {
    starts.push(at + 1);
  }
  return starts;
}

/** Trim trailing whitespace from a range, so blank lines stay between segments. */
function trimmedEnd(text: string, from: number, to: number): number {
  let end = to;
  while (end > from && /\s/.test(text[end - 1]!)) end--;
  return end;
}

function trimmedStart(text: string, from: number, to: number): number {
  let start = from;
  while (start < to && /\s/.test(text[start]!)) start++;
  return start;
}

/**
 * Split a beat's canonical text into segments.
 *
 * `castNames` are the names the author was told to use; they only widen what
 * counts as a label, never narrow it, so a labelled speaker who has left the
 * cast still parses as a speaker.
 */
export function parseBeat(content: string, castNames: readonly string[]): ParsedBeat {
  const known = new Set(castNames.map(normalize));

  // Where each labelled part begins, plus whatever came before the first one.
  const marks: { label: Label | null; from: number }[] = [];
  for (const lineStart of lineStarts(content)) {
    const label = readLabel(content, lineStart, known);
    if (label !== null) marks.push({ label, from: lineStart });
  }

  const segments: ParsedSegment[] = [];
  const push = (
    speakerType: SegmentSpeakerType,
    speakerLabel: string | null,
    from: number,
    to: number,
  ) => {
    const start = trimmedStart(content, from, to);
    const end = trimmedEnd(content, start, to);
    if (start >= end) return;
    segments.push({
      ordinal: segments.length,
      speakerType,
      speakerLabel,
      content: content.slice(start, end),
      charStart: start,
      charEnd: end,
    });
  };

  // Anything before the first label is narration — a stage direction opening
  // the beat, which is exactly what the prompt asks unlabelled prose to be.
  const first = marks[0];
  if (first === undefined) {
    push("narration", null, 0, content.length);
    return { segments, degraded: segments.length > 0 };
  }
  push("narration", null, 0, first.from);

  for (let index = 0; index < marks.length; index++) {
    const mark = marks[index]!;
    const next = marks[index + 1];
    push(
      "character",
      mark.label!.name,
      mark.label!.contentStart,
      next === undefined ? content.length : next.from,
    );
  }

  // Renumber: a dropped empty range would otherwise leave a gap.
  segments.forEach((segment, index) => {
    segment.ordinal = index;
  });

  return { segments, degraded: false };
}

/**
 * Replace one segment's prose in the canonical text.
 *
 * The label and the whitespace around it are outside the segment's offsets, so
 * they survive untouched and the result re-parses to the same shape.
 */
export function spliceSegment(content: string, segment: ParsedSegment, replacement: string): string {
  return content.slice(0, segment.charStart) + replacement.trim() + content.slice(segment.charEnd);
}
