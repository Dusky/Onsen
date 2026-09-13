import { useEffect, useRef, type ReactNode } from "react";
import { ArrowUp, ImagePlus, Play } from "lucide-react";
import { strings } from "../strings.ts";
import { CHARS_PER_TOKEN } from "@shared/types.ts";
import type { SendKey } from "@shared/types.ts";
import { wrapSelection } from "../lib/marks.ts";

/**
 * The composer stack.
 *
 * At this phase it is the resting two-row state minus the cast strip: a text
 * field and a send button. The send button shows the initials of who will
 * speak, so the user never sends blind — the design's phrase, and the reason
 * the initials are a prop rather than a constant.
 *
 * The keyboard handling is the fiddly part. `100dvh` and `visualViewport` are
 * both required: on iOS the layout viewport does not shrink when the keyboard
 * opens, so a composer positioned against the bottom of the page ends up
 * behind the keyboard.
 */

interface ComposerProps {
  onSend(text: string): void;
  /** An empty composer is "let the scene run on", not a disabled button. */
  onContinue(): void;
  disabled: boolean;
  /**
   * Who will reply next, shown in the footer opposite the model — never
   * crammed onto the send button, which stays a fixed icon (§149).
   */
  speakerName?: string | null;
  /** The model that answers, beside the input (§20 phase 101). */
  model?: { label: string; hasModel: boolean };
  /**
   * The draft lives above this component because the ops read it: "no reply"
   * posts it, and "as me" replaces it with a turn written from it.
   */
  draft: string;
  onDraftChange(value: string): void;
  /** The ops drawer, rendered above the input row when something is open. */
  opsOpen: boolean;
  onToggleOps(): void;
  ops?: ReactNode;
  /** Quick replies (SPEC §7, §20 phase 65): a row of saved nudges. */
  quickReplies?: ReactNode;
  /**
   * With room, the ops are a row above this and always visible, so the key
   * that opens them is a button onto something already open (design `4a`).
   * The composer also aligns to the prose column rather than the window.
   */
  wide?: boolean;
  /**
   * Attaching a picture (§20 phase 41).
   *
   * Always offered where a scene can take one. Describing it needs a model that
   * can see, but a picture nobody described is still worth having: the two
   * switches on it mean a reader can keep one for themselves that the story
   * never learns about.
   */
  onAttach?(file: File): void;
  attaching?: boolean;
  /** Pictures waiting to go with the next line, as thumbnails. */
  pending?: { id: string; url: string }[];
  /**
   * What Return does (§20 phase 166). Defaults to `enter`, which is what this
   * component did unconditionally for twenty phases.
   */
  sendKey?: SendKey;
  /** ⌘/Ctrl+B and +I wrap the selection in the marks the log now renders. */
  marks?: boolean;
}

/**
 * The composer's field, addressable from outside it (§20 phase 191).
 *
 * The textarea's ref is private and the component takes no `ref`, no `id` and
 * no focus callback — so nothing in the app *could* put the cursor in it. That
 * is how the app's primary action ended up unreachable by keyboard: a use
 * review pressed Tab ninety times from the top of the chat screen and never
 * arrived, because the Prompt rail alone is some seventy-eight tab stops and it
 * precedes the main content in DOM order.
 *
 * An id rather than a passed ref, because two unrelated callers need it — a
 * key binding registered on the window, and the skip link in the shell — and
 * threading a ref through both would put the composer's internals in two
 * components that otherwise know nothing about it.
 */
export const COMPOSER_ID = "onsen-composer";

/** Put the cursor where the writing happens. False if there is no composer. */
export function focusComposer(): boolean {
  const field = document.getElementById(COMPOSER_ID);
  if (!(field instanceof HTMLTextAreaElement)) return false;
  field.focus();
  // The caret goes to the end, not the start: a draft is resumed far more
  // often than it is rewritten from the front.
  field.setSelectionRange(field.value.length, field.value.length);
  return true;
}

export function Composer({
  onSend,
  onContinue,
  disabled,
  speakerName,
  model,
  draft,
  onDraftChange,
  onAttach,
  attaching,
  pending,
  opsOpen,
  onToggleOps,
  ops,
  quickReplies,
  wide = false,
  sendKey = "enter",
  marks = true,
}: ComposerProps) {
  const field = useRef<HTMLTextAreaElement>(null);

  // Grow with the text, up to a cap, so a long message is visible while it is
  // being written without eating the whole log.
  useEffect(() => {
    const element = field.current;
    if (element === null) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, [draft]);

  function send() {
    const text = draft.trim();
    if (text === "" || disabled) return;
    onDraftChange("");
    onSend(text);
  }

  return (
    <div
      className="flex-none border-t border-rule bg-bg-raised px-[16px] pt-[11px]"
      style={{ paddingBottom: "calc(10px + env(safe-area-inset-bottom))" }}
    >
      {/* Aligned to the prose it is answering rather than to the window: a
          composer stretched to 900px under a 620px column reads as two
          different documents. */}
      <div className={wide ? "mx-auto w-full max-w-[var(--onsen-prose-measure)]" : undefined}>
      {/* Progressive disclosure: the ops drawer sits above the input row and is
          closed by default, so the resting composer stays two rows tall. */}
      {ops === undefined ? null : <div className="mb-[11px]">{ops}</div>}

      {/* Quick replies stay above the field even while the ops drawer is open:
          their whole point is one tap, and a button that hides when the
          keyboard does is a button that never fires. But a nudge is a *start*;
          once a turn is half-written they are noise, so they fold away while
          the draft is not empty (§149). */}
      {quickReplies === undefined || draft.trim() !== "" ? null : (
        <div className="mb-[9px]">{quickReplies}</div>
      )}

      {/* What is going with the next line (§20 phase 41). Above the field
          rather than inside it: a picture is not text, and the row it sits in
          has to stay one line tall on a phone. */}
      {pending !== undefined && pending.length > 0 ? (
        <div className="mb-[9px] flex flex-wrap gap-[6px]">
          {pending.map((image) => (
            <img
              key={image.id}
              src={image.url}
              alt=""
              className="h-[46px] w-[46px] object-cover"
              style={{ border: "1px solid var(--onsen-color-rule)" }}
            />
          ))}
        </div>
      ) : null}

      <div className="flex items-end gap-[8px]">
        <textarea
          ref={field}
          id={COMPOSER_ID}
          rows={1}
          className={`field flex-1 resize-none py-[13px] ${wide ? "min-h-[62px]" : "min-h-[46px]"}`}
          placeholder={strings.chat.composerPlaceholder}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;

            /*
             * What Return does is the reader's (§20 phase 166). It was Enter
             * unconditionally, and the comment here said why the phone is not
             * affected either way: a software keyboard does not report a shift
             * state, so its return key has to stay a newline. That is still
             * true of all three settings — none of them can reach the phone's
             * return key, and the send button is how a phone sends.
             *
             * `modEnter` takes either modifier rather than sniffing the
             * platform. A keyboard that sends on ⌘+Return and refuses
             * Ctrl+Return is a keyboard arguing about which machine it is on.
             */
            if (event.key === "Enter") {
              const modified = event.metaKey || event.ctrlKey;
              const sends =
                sendKey === "enter"
                  ? !event.shiftKey && !modified
                  : sendKey === "modEnter"
                    ? modified
                    : false;
              if (sends) {
                event.preventDefault();
                send();
              }
              return;
            }

            /*
             * The two marks the log renders (§20 phase 161), on the two keys
             * every editor binds them to.
             *
             * Only with a modifier and only for `b`/`i`, so nothing here can
             * swallow a character. The selection is put back around the text it
             * wrapped rather than collapsed, because the next thing a writer
             * does after emphasising a phrase is often to emphasise it
             * differently.
             */
            if (marks && (event.metaKey || event.ctrlKey) && !event.altKey) {
              const mark =
                event.key === "b" || event.key === "B"
                  ? "**"
                  : event.key === "i" || event.key === "I"
                    ? "*"
                    : null;
              if (mark === null) return;
              const element = event.currentTarget;
              const next = wrapSelection(draft, element.selectionStart, element.selectionEnd, mark);
              if (next === null) return;
              event.preventDefault();
              onDraftChange(next.text);
              // After React has written the new value, or the browser puts the
              // caret back where the old string ended.
              requestAnimationFrame(() => {
                element.setSelectionRange(next.start, next.end);
              });
            }
          }}
        />

        {/* Attach a picture (§20 phase 41). A label rather than a button,
            because the input it drives has to be a real file input and a
            styled one of those is a label every time. */}
        {onAttach === undefined ? null : (
          <label
            className="chrome flex h-[46px] w-[46px] flex-none cursor-pointer items-center justify-center border text-[15px]"
            style={{
              borderColor: "var(--onsen-color-border-quiet)",
              color: attaching === true
                ? "var(--onsen-color-red)"
                : "var(--onsen-color-text-muted)",
            }}
            aria-label={strings.media.attach}
            title={strings.media.attach}
          >
            {attaching === true ? "…" : <ImagePlus size={18} strokeWidth={1.75} />}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                // Cleared so choosing the same file twice fires again, which a
                // file input otherwise refuses to do.
                event.target.value = "";
                if (file !== undefined) onAttach(file);
              }}
            />
          </label>
        )}

        {/* The ops key. A toggle, not a destruction, so it takes the blue
            active treatment while the drawer is open — and is absent where
            the ops are already a visible row. */}
        {wide ? null : (
        <button
          type="button"
          onClick={onToggleOps}
          aria-pressed={opsOpen}
          // The label follows the state: a button that says "close" to the eye
          // and "ops" to a screen reader is two different buttons.
          aria-label={opsOpen ? strings.chat.opsClose : strings.chat.ops}
          className="chrome flex h-[46px] w-[46px] flex-none items-center justify-center border text-ui"
          style={{
            borderColor: opsOpen ? "var(--onsen-color-blue)" : "var(--onsen-color-border-quiet)",
            color: opsOpen ? "var(--onsen-color-blue)" : "var(--onsen-color-text-muted)",
          }}
        >
          {opsOpen ? strings.chat.opsClose : strings.chat.ops}
        </button>
        )}

        {/* Send posts the message and asks for a reply; an empty composer
            instead lets the scene run on — the placeholder promises it, so the
            button must honour it (§149). */}
        <button
          type="button"
          onClick={draft.trim() === "" ? onContinue : send}
          disabled={disabled}
          aria-label={draft.trim() === "" ? strings.chat.opRunOn : strings.chat.send}
          title={draft.trim() === "" ? strings.chat.opRunOn : strings.chat.send}
          className={`flex flex-none items-center justify-center ${wide ? "h-[62px] w-[62px]" : "h-[46px] w-[46px]"}`}
          style={{ background: "var(--onsen-color-blue)", color: "#0b1219" }}
        >
          {draft.trim() === "" ? <Play size={20} strokeWidth={2} /> : <ArrowUp size={20} strokeWidth={2} />}
        </button>
      </div>

      {/* The bottom footer: who answers (the model) left; who replies next,
          the draft's cost, and the keyboard hints right — the hints sit
          opposite the provider, where the send affordance lives (§149). */}
      {model === undefined && draft.trim() === "" && speakerName == null && !wide ? null : (
        <div className="mt-[8px] flex items-baseline justify-between gap-[10px] border-t border-rule pt-[7px]">
          {model === undefined ? (
            <span />
          ) : (
            <span
              className="chrome flex items-center gap-[6px] text-[11.5px]"
              style={{ color: "var(--onsen-color-text-muted)" }}
            >
              <span
                aria-hidden="true"
                className="h-[6px] w-[6px] flex-none"
                style={{
                  background: model.hasModel
                    ? "var(--onsen-color-green)"
                    : "var(--onsen-color-red)",
                }}
              />
              {model.label}
            </span>
          )}
          <span className="flex items-baseline gap-[8px]">
            {speakerName === null || speakerName === undefined || speakerName === "" ? null : (
              <span className="chrome text-[11.5px] text-ink-muted">
                {strings.chat.willReply(speakerName)}
              </span>
            )}
            {draft.trim() === "" ? null : (
              <span className="meta tabular-nums">
                {strings.chat.draftTokens(Math.max(1, Math.ceil(draft.length / CHARS_PER_TOKEN)))}
              </span>
            )}
            {wide ? (
              <span className="chrome pl-[4px] text-[11.5px] text-ink-dim">
                {strings.chat.keyboardHints}
              </span>
            ) : null}
          </span>
        </div>
      )}

      {/* Asking for a reply without saying anything is the `→ CONTINUE` op
          (§149), not a permanent row here — the composer's resting state stays
          two rows, per the design handoff. */}
      </div>
    </div>
  );
}
