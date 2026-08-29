import { useState } from "react";
import type { MessageDto, MessageSegmentDto } from "@shared/types.ts";
import { useSwipe } from "../lib/gestures.ts";
import { strings } from "../strings.ts";

/**
 * One message in the log.
 *
 * The design's three rules show up directly here: the speaker attribution is
 * the app speaking, so it is mono, uppercase and heavily tracked; the prose is
 * the user's material, so it is Spectral; and separation is a hairline rule
 * running to the right edge rather than a bubble or a card. No avatar, no
 * timestamp, no shadow.
 */

interface MessageBlockProps {
  message: MessageDto;
  speakerName: string;
  onReroll(): void;
  onOpenVersions(): void;
  onLongPress(): void;
  /** Streaming text replaces the content while this message is being written. */
  streamingText?: string;
  /**
   * A part of this beat being rewritten right now (SPEC §7). The text lands
   * inside the message rather than after it, so it is shown where it will end
   * up rather than arriving at the bottom of the log and then vanishing.
   */
  recasting?: { ordinal: number; text: string };
}

/**
 * Paragraphs are split on blank lines, which is how a model emits them, and set
 * with `text-wrap: pretty` for the sake of the person reading for hours.
 */
function Prose({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/).filter((paragraph) => paragraph.trim() !== "");
  return (
    <>
      {paragraphs.map((paragraph, index) => (
        <p
          key={index}
          className="mt-[9px] first:mt-0 text-[length:var(--onsen-text-prose)] leading-[var(--onsen-leading-prose)] whitespace-pre-wrap"
        >
          {paragraph}
        </p>
      ))}
    </>
  );
}

/**
 * One speaker's part of a beat.
 *
 * A beat is one message, so its parts are not separated the way messages are:
 * no full-width rule, no swipe counter, nothing that would read as a turn
 * boundary. What distinguishes a speaker inside a beat is their name, set
 * smaller and quieter than a message's own attribution, and nothing else — the
 * prose stays one continuous document, which is the whole point of a beat.
 *
 * The parts carry no gestures of their own. A long-press inside a beat would
 * nest one gesture target inside another, and the beat has to keep its own
 * swipe: recast is reached from the message's action sheet instead, which is
 * also where a reader would look for it.
 */
function Segment({
  segment,
  replacement,
}: {
  segment: MessageSegmentDto;
  /** Live text for this part while it is being rewritten. */
  replacement?: string;
}) {
  return (
    <div
      className="mt-[16px] first:mt-0"
      // Red is the live pencil: the part being rewritten is the only thing on
      // the screen that is happening now.
      style={
        replacement === undefined
          ? undefined
          : { borderLeft: "2px solid var(--onsen-color-red)", paddingLeft: "10px" }
      }
    >
      {segment.speakerName === null ? null : (
        <p className="chrome mb-[5px] text-[9px] tracking-[0.14em] text-ink-label uppercase">
          {segment.speakerName}
        </p>
      )}
      <Prose text={replacement ?? segment.content} />
    </div>
  );
}

export function MessageBlock({
  message,
  speakerName,
  onReroll,
  onOpenVersions,
  onLongPress,
  streamingText,
  recasting,
}: MessageBlockProps) {
  const swipe = useSwipe({
    // Opposite directions by design (design handoff, Gestures).
    onSwipeLeft: onReroll,
    onSwipeRight: message.siblingCount > 1 ? onOpenVersions : undefined,
    onLongPress,
  });

  const text = streamingText ?? message.content;
  const segments = streamingText === undefined ? message.segments : null;
  // Attribution is the only thing that distinguishes a speaker: the design's
  // rule is three message kinds in one document, so the prose itself is not
  // recoloured by who wrote it.
  const isUser = message.authorType === "user";

  return (
    <article
      {...swipe}
      className="select-none"
      // The whole block is the gesture target, so the affordance matches the
      // thing being acted on rather than a handle beside it.
      aria-label={`${speakerName}: ${text.slice(0, 80)}`}
    >
      <header className="mb-[10px] flex items-center gap-[10px]">
        <span
          className="chrome shrink-0 text-[10px] font-semibold tracking-[0.18em] uppercase"
          style={{ color: isUser ? "var(--onsen-color-text-muted)" : "var(--onsen-color-text-label)" }}
        >
          {speakerName}
        </span>
        {/* The rule runs to the right edge; the swipe counter sits at its end. */}
        <span className="h-px flex-1 bg-rule" />
        {message.siblingCount > 1 ? (
          <button
            type="button"
            onClick={onOpenVersions}
            className="chrome shrink-0 text-[9px] tracking-[0.08em] text-ink-dim"
          >
            {strings.chat.versionCounter(message.siblingIndex + 1, message.siblingCount)}
          </button>
        ) : null}
      </header>

      <div>
        {/* A beat is rendered by its parts; every other message is its own text.
            While one is streaming there are no parts yet, so the raw output
            shows — labels and all — rather than the log going blank. */}
        {segments === null ? (
          <Prose text={text} />
        ) : (
          segments.map((segment) => (
            <Segment
              key={segment.ordinal}
              segment={segment}
              {...(recasting?.ordinal === segment.ordinal
                ? { replacement: recasting.text }
                : {})}
            />
          ))
        )}
        {message.parseDegraded ? (
          <p className="chrome mt-[8px] text-[8.5px] leading-[1.5] tracking-[0.06em] text-ink-dim uppercase">
            {strings.chat.beatUnparsed}
          </p>
        ) : null}
        {message.editedAt !== null ? (
          <p className="chrome mt-[8px] text-[8.5px] tracking-[0.1em] text-ink-dim uppercase">
            {strings.chat.edited}
          </p>
        ) : null}
      </div>
    </article>
  );
}

/**
 * The inline editor. Editing happens in place in the log rather than in a
 * modal, so the surrounding scene stays readable while a line is corrected.
 */
export function MessageEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave(content: string): void;
  onCancel(): void;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <div>
      <textarea
        className="field min-h-[160px] resize-y"
        value={draft}
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="mt-[10px] flex gap-[8px]">
        <button
          type="button"
          className="btn btn-primary flex-1"
          onClick={() => onSave(draft)}
          disabled={draft.trim() === ""}
        >
          {strings.chat.save}
        </button>
        <button type="button" className="btn flex-1" onClick={onCancel}>
          {strings.common.cancel}
        </button>
      </div>
    </div>
  );
}
