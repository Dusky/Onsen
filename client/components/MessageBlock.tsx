import { useState } from "react";
import type { MessageDto } from "@shared/types.ts";
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

export function MessageBlock({
  message,
  speakerName,
  onReroll,
  onOpenVersions,
  onLongPress,
  streamingText,
}: MessageBlockProps) {
  const swipe = useSwipe({
    // Opposite directions by design (design handoff, Gestures).
    onSwipeLeft: onReroll,
    onSwipeRight: message.siblingCount > 1 ? onOpenVersions : undefined,
    onLongPress,
  });

  const text = streamingText ?? message.content;
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
        <Prose text={text} />
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
