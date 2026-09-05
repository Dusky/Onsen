import { useState } from "react";
import type { AnnotationDto, MessageDto, MessageSegmentDto } from "@shared/types.ts";
import { useSwipe } from "../lib/gestures.ts";
import { strings } from "../strings.ts";
import { MessageMedia } from "./MessageMedia.tsx";

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
  /** Its place in the log, 1-based — the `#46` in the gutter (§20 phase 55). */
  ordinal?: number;
  speakerName: string;
  /**
   * Where the name sits (§20 phase 52). `stacked` puts it on its own row above
   * the prose; Broadsheet's `inline` sets it as the opening of the paragraph,
   * with the director's reason beside it, so the log reads as a printed page
   * rather than as a transcript.
   */
  attribution?: "stacked" | "inline";
  onReroll(): void;
  onOpenVersions(): void;
  onLongPress(): void;
  /** The turn ⌘K and the accelerators act on (§20 phase 43). */
  selected?: boolean;
  onSelect?(): void;
  /** Streaming text replaces the content while this message is being written. */
  streamingText?: string;
  /**
   * A part of this beat being rewritten right now (SPEC §7). The text lands
   * inside the message rather than after it, so it is shown where it will end
   * up rather than arriving at the bottom of the log and then vanishing.
   */
  recasting?: { ordinal: number; text: string };
  /** Put back what a pass changed (SPEC §7.5). */
  onRevert?(annotation: AnnotationDto): void;
  /** Reasoning arriving live, before the message it belongs to exists (§13). */
  streamingReasoning?: string;
  /**
   * Reroll, branch and edit at the end of the attribution rule, revealed on
   * hover (design `4a`).
   *
   * **The only hover affordance in the system, and it exists only on desktop.**
   * Every mobile equivalent is a tap, a swipe or a long-press, and those still
   * work here — this is a shortcut for a pointer, not a replacement. Passed in
   * rather than read from a breakpoint so the component stays a function of its
   * props: absent means no hover row, on any width.
   */
  hoverActions?: { onBranch(): void; onEdit(): void };
}

/**
 * The reasoning strip (SPEC §13: hidden from the prose, rendered as a
 * collapsible section).
 *
 * Entirely mono, like a pass annotation, because it is the machine talking
 * about its own work rather than another voice in the scene — and collapsed by
 * default, because a reader who wanted to watch a model think would not be
 * reading a roleplay. The header says how much there is, so the closed state is
 * still informative: "it thought for 900 characters" is the fact worth having.
 */
export function Reasoning({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const trimmed = text.trim();
  if (trimmed === "") return null;
  return (
    <div className="mb-[12px]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="chrome flex min-h-[28px] w-full items-center gap-[8px] text-left text-[10px] text-ink-dim"
      >
        <span aria-hidden>{open ? "⌃" : "⌄"}</span>
        {strings.chat.reasoning(trimmed.length)}
      </button>
      {open ? (
        <p
          className="chrome mt-[7px] border-l pl-[11px] text-[11.5px] leading-[1.65] whitespace-pre-wrap text-ink-dim"
          style={{ borderColor: "var(--onsen-color-rule)" }}
        >
          {trimmed}
        </p>
      ) : null}
    </div>
  );
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
      // Red is the live pencil: the part being rewritten is the only thing on
      // the screen that is happening now.
      style={
        replacement === undefined
          ? undefined
          : { borderLeft: "2px solid var(--onsen-color-red)", paddingLeft: "10px" }
      }
    >
      {segment.speakerName === null ? null : (
        <p className="chrome mb-[5px] text-[10.5px] text-ink-label">
          {segment.speakerName}
        </p>
      )}
      <Prose text={replacement ?? segment.content} />
    </div>
  );
}

/**
 * What a post-generation pass found (SPEC §7.5).
 *
 * "Show pass results as a small annotation on the message, not a modal" — a
 * pass is a second reader's note in the margin. Entirely mono, like the
 * reasoning strip: it reads as an annotation rather than as another voice in
 * the scene. A clean verdict is quieter still, because a pipeline that reports
 * every success as loudly as every failure is a pipeline you stop reading.
 */
function Annotation({
  annotation,
  onRevert,
}: {
  annotation: AnnotationDto;
  onRevert?: ((annotation: AnnotationDto) => void) | undefined;
}) {
  const flagged = annotation.status === "flagged";
  const failed = annotation.status === "failed";
  return (
    <p
      className="chrome mt-[7px] flex gap-[7px] text-[10.5px] leading-[1.55]"
      style={{
        color: flagged ? "var(--onsen-color-red)" : "var(--onsen-color-text-dim)",
        opacity: annotation.status === "ok" ? 0.7 : 1,
      }}
    >
      <span className="flex-none">
        {failed
          ? strings.chat.passFailed(annotation.passLabel)
          : annotation.status === "ok"
            ? strings.chat.passOk(annotation.passLabel)
            : annotation.passLabel}
      </span>
      {annotation.detail === null ? null : (
        <span className="min-w-0 flex-1">{annotation.detail}</span>
      )}
      {annotation.revertable && onRevert !== undefined ? (
        <button
          type="button"
          onClick={() => onRevert(annotation)}
          className="flex-none underline"
        >
          {strings.chat.passRevert}
        </button>
      ) : null}
    </p>
  );
}

/**
 * An out-of-character aside, inline in the log (design `2a`, SPEC §7).
 *
 * The design's marginal treatment: an 18px inset with a 2px blue rule running
 * its full height, a blue mono label, and the body in a bubble with the
 * asymmetric corner that reads as a tail. It is one of the three places in the
 * system allowed a rounded corner, and the only place the app sets story-column
 * content in mono — the author speaking as itself rather than writing.
 *
 * Deliberately *not* a bubble in the reader's own colour when the reader wrote
 * it. Inline, this is one aside in one margin; who said what is the label's
 * job. The channel sheet is where the exchange becomes a conversation with
 * sides, and that is where the alternating treatment lives.
 */
export function OocBlock({
  message,
  speakerName,
  streamingText,
  onOpenChannel,
}: {
  message: MessageDto;
  /** Null with no author set: the label then just says what it is. */
  speakerName: string | null;
  streamingText?: string;
  onOpenChannel?: (() => void) | undefined;
}) {
  const text = streamingText ?? message.content;
  const fromReader = message.authorType === "user";

  return (
    <article
      className="pl-[18px]"
      style={{ borderLeft: "2px solid var(--onsen-color-blue)" }}
      aria-label={`${speakerName} out of character: ${text.slice(0, 80)}`}
    >
      <div className="mb-[7px] flex items-baseline gap-[10px]">
        <span
          className="chrome shrink-0 text-[10.5px]"
          style={{ color: "var(--onsen-color-blue-text-muted)" }}
        >
          {strings.chat.oocLabel(speakerName)}
        </span>
        <span className="flex-1" />
        {onOpenChannel === undefined ? null : (
          <button
            type="button"
            onClick={onOpenChannel}
            className="chrome shrink-0 text-[10px]"
            style={{ color: "var(--onsen-color-blue-text-muted)" }}
          >
            {strings.chat.oocOpenChannel}
          </button>
        )}
      </div>
      <div
        className="chrome px-[12px] py-[9px] text-[12.5px] leading-[1.55] whitespace-pre-wrap"
        style={{
          background: "var(--onsen-color-blue-bg)",
          border: "1px solid var(--onsen-color-blue-border)",
          color: "var(--onsen-color-blue-text)",
          // The asymmetric corner is the tail. It points the other way when the
          // reader is the one who spoke.
          borderRadius: fromReader ? "12px 3px 12px 12px" : "3px 12px 12px 12px",
        }}
      >
        {text}
      </div>
    </article>
  );
}

/**
 * What the turn cost, in the gutter and untapped (SPEC §16 §Density rule 2).
 *
 * The server has measured all of this on every generated message since phase 4;
 * until phase 55 no DTO carried it, and the spec's own instruction to put it
 * "behind a tap" is most of why nobody noticed. Rendered as `#46 · 1.2s · 868t
 * · 41/s`, which is the shape the incumbent uses and the shape a reader
 * comparing two models actually reads.
 *
 * Absent on user turns, imported history and anything written before phase 4 —
 * so the ordinal renders alone rather than the row disappearing, because the
 * message number is useful on its own when reporting a bad turn.
 */
function Stats({ message, ordinal }: { message: MessageDto; ordinal: number | undefined }) {
  const meta = message.generation;
  const parts: string[] = [];
  if (ordinal !== undefined) parts.push(`#${ordinal}`);
  if (meta !== null) {
    // Milliseconds under a second: a fast local model reading `0.0s` says
    // nothing, and "how long before it started" is the number people compare
    // backends on.
    if (meta.ttftMs !== null) {
      parts.push(meta.ttftMs < 1000 ? `${Math.round(meta.ttftMs)}ms` : `${(meta.ttftMs / 1000).toFixed(1)}s`);
    }
    if (meta.completionTokens !== null) {
      // A tilde where the count is the estimator's rather than the provider's
      // (§3): the number is worth showing and worth not overstating.
      parts.push(`${meta.tokensAreEstimated ? "~" : ""}${meta.completionTokens}t`);
    }
    if (meta.tokensPerSecond !== null) parts.push(`${Math.round(meta.tokensPerSecond)}/s`);
  }
  if (parts.length === 0) return null;
  return (
    <span className="meta shrink-0 tabular-nums" title={meta?.model ?? undefined}>
      {parts.join(" \u00b7 ")}
    </span>
  );
}

export function MessageBlock({
  message,
  ordinal,
  speakerName,
  attribution = "stacked",
  onReroll,
  onOpenVersions,
  onLongPress,
  selected,
  onSelect,
  streamingText,
  recasting,
  onRevert,
  streamingReasoning,
  hoverActions,
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
      className="turn group select-none"
      // Instrument's spine (§20 phase 50): a rail belonging to the turn rather
      // than a rule between two of them. The user's is quieter than a
      // character's — their line is the prompt, not the performance.
      data-rail={isUser ? "user" : "character"}
      data-live={streamingText === undefined ? undefined : "true"}
      // The whole block is the gesture target, so the affordance matches the
      // thing being acted on rather than a handle beside it.
      aria-label={`${speakerName}: ${text.slice(0, 80)}`}
      // §20 phase 43: the selected turn is what ⌘K and the single-key
      // accelerators act on, so it has to be visible without being loud —
      // a red edge in the gutter, not a highlight over the prose.
      aria-current={selected === true ? "true" : undefined}
      data-selected={selected === true ? "true" : undefined}
      // The anchor j/k scrolls to. On the element rather than in a ref map,
      // because the log is virtualised and refs to unmounted rows go stale.
      data-message-id={message.id}
      onClick={onSelect}
      style={
        selected === true
          ? {
              borderLeft: "2px solid var(--onsen-color-red)",
              marginLeft: "-20px",
              paddingLeft: "18px",
              background: "var(--onsen-color-bg-raised)",
            }
          : undefined
      }
    >
      <header className="mb-[10px] flex items-center gap-[10px]" hidden={attribution === "inline"}>
        <span
          className="chrome shrink-0 text-[11.5px] font-semibold"
          style={{ color: isUser ? "var(--onsen-color-text-muted)" : "var(--onsen-color-text-label)" }}
        >
          {speakerName}
        </span>
        {/* Instrument gave the turn a rail of its own (§20 phase 50), so the
            rule that used to run from the name to the right edge would be a
            second separator on the same block. The span stays — it is what the
            swipe counter sits at the end of, and what the hover actions are
            painted over rather than laid out beside, since in flow they would
            reserve their width whether or not anyone is hovering — but it no
            longer draws a line. */}
        <span className="relative h-px flex-1">
          {hoverActions === undefined ? null : (
            <span className="absolute top-1/2 right-0 flex -translate-y-1/2 items-center gap-[7px] bg-bg pl-[10px] opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              {[
                { label: strings.chat.reroll, run: onReroll },
                { label: strings.chat.hoverBranch, run: hoverActions.onBranch },
                { label: strings.chat.edit, run: hoverActions.onEdit },
              ].map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={action.run}
                  className="chrome text-[9.5px] text-ink-dim hover:text-ink-label"
                >
                  {action.label}
                </button>
              ))}
            </span>
          )}
        </span>
        <Stats message={message} ordinal={ordinal} />
        {message.siblingCount > 1 ? (
          <button
            type="button"
            onClick={onOpenVersions}
            className="chrome shrink-0 text-[10.5px] text-ink-dim"
          >
            {strings.chat.versionCounter(message.siblingIndex + 1, message.siblingCount)}
          </button>
        ) : null}
      </header>

      <div>
        {/* Collapsed by default, above the prose it produced: reasoning happened
            first, and putting it after would read as an afterword (§13). */}
        <Reasoning text={streamingReasoning ?? message.reasoning ?? ""} />

        {/* A beat is rendered by its parts; every other message is its own text.
            While one is streaming there are no parts yet, so the raw output
            shows — labels and all — rather than the log going blank. */}
        {/* Broadsheet sets the name into the paragraph rather than above it,
            which is what makes the log read as a page. Only on a whole
            message: a beat's parts already name their own speakers, and a
            second name at the top would be saying it twice. */}
        {attribution === "inline" && segments === null ? (
          <p className="mt-0 text-[length:var(--onsen-text-prose)] leading-[var(--onsen-leading-prose)] whitespace-pre-wrap">
            <span
              className="chrome text-[11.5px] font-semibold"
              style={{
                color: isUser
                  ? "var(--onsen-color-text-muted)"
                  : "var(--onsen-color-text-label)",
              }}
            >
              {speakerName}
            </span>
            <span className="chrome text-[11.5px] text-ink-dim"> &middot; </span>
            {text}
          </p>
        ) : segments === null ? (
          <Prose text={text} />
        ) : (
          segments.map((segment) => (
            // The spacing lives on the wrapper, not the part: each part now has
            // its own notes under it, and `first:` on the inner element would
            // match every one of them.
            <div key={segment.ordinal} className="mt-[16px] first:mt-0">
              <Segment
                segment={segment}
                {...(recasting?.ordinal === segment.ordinal
                  ? { replacement: recasting.text }
                  : {})}
              />
              {/* A voice check reads a beat part by part, so its note belongs
                  under the part it is about — naming which line drifted is the
                  whole point of the pass (SPEC §7.5). */}
              {message.annotations
                .filter((note) => note.segmentOrdinal === segment.ordinal)
                .map((note) => (
                  <Annotation key={note.id} annotation={note} onRevert={onRevert} />
                ))}
            </div>
          ))
        )}
        {message.annotations
          .filter((note) => note.segmentOrdinal === null)
          .map((note) => (
            <Annotation key={note.id} annotation={note} onRevert={onRevert} />
          ))}
        {message.passesPending ? (
          <p className="chrome mt-[6px] text-[10.5px] leading-[1.55] text-ink-dim">
            {strings.chat.passesPending}
          </p>
        ) : null}
        {message.parseDegraded ? (
          <p className="chrome mt-[8px] text-[10px] leading-[1.5] text-ink-dim">
            {strings.chat.beatUnparsed}
          </p>
        ) : null}
        {/* §2: still in the log, out of the prompt. Said on the message rather
            than only in the menu that set it — a turn the author cannot see
            reads exactly like one it can, and the difference matters most when
            you are wondering why it did not react. */}
        {message.isHidden ? (
          <p className="chrome mt-[8px] text-[10px]" style={{ color: "var(--onsen-color-blue-text)" }}>
            {strings.chat.hiddenFromPrompt}
          </p>
        ) : null}
        {/* §20 phase 41: what was drawn for this turn, read aloud from it, or
            attached to it. Below the prose, because it illustrates the words
            rather than replacing them. */}
        {message.media.length > 0 ? (
          <MessageMedia sceneId={message.sceneId} assets={message.media} />
        ) : null}
        {message.editedAt !== null ? (
          <p className="chrome mt-[8px] text-[10px] text-ink-dim">
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
