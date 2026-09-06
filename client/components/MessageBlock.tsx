import { useState } from "react";
import type {
  AnnotationDto,
  AvatarShape,
  MessageDto,
  MessageSegmentDto,
  TurnStyle,
} from "@shared/types.ts";
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
  /**
   * How this side's turns are shaped (§20 phase 57). Passed in rather than read
   * from preferences so the component stays a function of its props — the same
   * reasoning `attribution` was given in phase 52.
   */
  style?: TurnStyle;
  avatarShape?: AvatarShape;
  /**
   * Whose picture the reader's own turns draw (§20 phase 61).
   *
   * Phase 57 shipped the avatar with a note saying the reader's side would show
   * an initial until `personas.avatar_path` was wired, and did not pretend
   * otherwise. This is that wire. It comes from the scene rather than the
   * message because a persona belongs to the roleplay, not to the turn.
   */
  personaId?: string | null;
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
   * Always rendered, on every width (§20 phase 57). Until then this was a hover
   * row of three, passed only when `isDesktop` — so on a phone the other twelve
   * turn commands were reachable solely by a long-press nobody is told about.
   * §16 §Density rule 3: controls live in the row.
   */
  actions: TurnActions;
}

/** What a turn can have done to it, in the order the row shows them. */
export interface TurnActions {
  onVersions(): void;
  onBranch(): void;
  onEdit(): void;
  onCopy(): void;
  onHide(): void;
  /** The palette, opened on this turn — where all fifteen commands live. */
  onMore(): void;
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

/**
 * Who is speaking, as a picture (§20 phase 57).
 *
 * Characters have one at `/api/characters/:id/avatar`, the URL the cast rail
 * has used since phase 50. The reader has none: `personas.avatar_path` exists
 * in the schema and nothing reads or writes it (`docs/GAPS.md` §3), so their
 * side falls back to an initial rather than to a broken image.
 */
function Avatar({
  message,
  speakerName,
  shape,
  personaId,
}: {
  message: MessageDto;
  speakerName: string;
  shape: AvatarShape;
  personaId: string | null;
}) {
  const url =
    message.characterId !== null
      ? `/api/characters/${message.characterId}/avatar`
      : personaId === null
        ? null
        : `/api/personas/${personaId}/avatar`;
  return (
    <span
      aria-hidden="true"
      className="flex h-[26px] w-[26px] flex-none items-center justify-center bg-bg-raised bg-cover bg-center text-[11px] text-ink-dim"
      style={{
        borderRadius: shape === "circle" ? "50%" : "var(--onsen-radius)",
        ...(url === null ? {} : { backgroundImage: `url(${url})` }),
      }}
    >
      {/* The initial is always rendered and the picture sits on top of it, so a
          character with no avatar — `hasAvatar: false`, a 404 from the endpoint
          — shows a letter rather than an empty disc. `MessageDto` does not
          carry `hasAvatar`, and a background image that fails to load simply
          reveals what is underneath, which is the behaviour wanted here. */}
      {speakerName.slice(0, 1)}
    </span>
  );
}

/**
 * What can be done to this turn, on the turn (SPEC §16 §Density rule 3,
 * §20 phase 57).
 *
 * There were fifteen turn-scoped commands and three of them were on screen —
 * behind a hover, passed only when the window was desktop-width. On a phone the
 * other twelve were reachable by a long-press nobody is told about, which is
 * the same defect phase 54 removed from the roleplay list one level up.
 *
 * Glyphs, not an icon library: nothing in this client ships SVG icons and the
 * chrome is mono throughout. Every button carries an accessible name and a
 * `title`, so the row is readable rather than a guessing game.
 *
 * `…` opens the palette on this turn, which is where all fifteen live — so a
 * command added there can never go missing from here.
 */
function TurnRow({
  message,
  actions,
  onReroll,
}: {
  message: MessageDto;
  actions: TurnActions;
  onReroll(): void;
}) {
  const [copied, setCopied] = useState(false);

  const items: { glyph: string; name: string; run(): void; on?: boolean }[] = [
    { glyph: strings.chat.turnReroll, name: strings.chat.reroll, run: onReroll },
    ...(message.siblingCount > 1
      ? [
          {
            glyph: strings.chat.turnVersions,
            name: strings.chat.versions,
            run: actions.onVersions,
          },
        ]
      : []),
    { glyph: strings.chat.turnBranch, name: strings.chat.branch, run: actions.onBranch },
    { glyph: strings.chat.turnEdit, name: strings.chat.edit, run: actions.onEdit },
    {
      glyph: strings.chat.turnCopy,
      name: copied ? strings.chat.turnCopied : strings.chat.copy,
      run: () => {
        actions.onCopy();
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      },
    },
    {
      glyph: message.isHidden ? strings.chat.turnHide : strings.chat.turnShow,
      name: message.isHidden ? strings.chat.unhide : strings.chat.hideFromPrompt,
      run: actions.onHide,
      // Red while it reaches the author, hollow while it does not: the same
      // live/not-live pair the prompt manager uses.
      on: !message.isHidden,
    },
    { glyph: strings.chat.turnMore, name: strings.chat.more, run: actions.onMore },
  ];

  return (
    <span className="turn-actions order-last ml-auto flex flex-none items-center">
      {items.map((item) => (
        <button
          key={item.name}
          type="button"
          onClick={item.run}
          aria-label={item.name}
          title={item.name}
          className="chrome flex items-center justify-center text-[13px] text-ink-muted hover:text-ink-label"
          style={item.on === false ? { color: "var(--onsen-color-text-dim)" } : undefined}
        >
          {item.glyph}
        </button>
      ))}
    </span>
  );
}

export function MessageBlock({
  message,
  actions,
  ordinal,
  speakerName,
  attribution = "stacked",
  style: turnStyle = { bubble: false, avatar: false },
  avatarShape = "circle",
  personaId = null,
  onReroll,
  onOpenVersions,
  onLongPress,
  selected,
  onSelect,
  streamingText,
  recasting,
  onRevert,
  streamingReasoning,
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
      className={`turn group select-none${turnStyle.bubble ? " turn-bubble" : ""}${
        message.isHidden ? " turn-hidden" : ""
      }`}
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
      {/* Wraps: on a phone the name, six actions and the stats do not fit on
          one line, and without this the stats were clipped at the edge. With
          room it stays one row; without, the actions take a second. */}
      <header
        className="mb-[10px] flex flex-wrap items-center gap-x-[10px] gap-y-[4px]"
        hidden={attribution === "inline"}
      >
        {turnStyle.avatar ? (
          <Avatar
            message={message}
            speakerName={speakerName}
            shape={avatarShape}
            personaId={personaId ?? null}
          />
        ) : null}
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
        <span className="h-px flex-1" />
        <TurnRow
          message={message}
          actions={actions}
          onReroll={onReroll}
        />
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
