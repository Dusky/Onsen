import { useEffect, useRef, type ReactNode } from "react";
import { strings } from "../strings.ts";

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
  onGenerate(): void;
  disabled: boolean;
  /** Initials of the speaker the send button will produce. */
  speakerInitials: string;
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
}

export function Composer({
  onSend,
  onGenerate,
  disabled,
  speakerInitials,
  draft,
  onDraftChange,
  opsOpen,
  onToggleOps,
  ops,
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
      {/* Progressive disclosure: the ops drawer sits above the input row and is
          closed by default, so the resting composer stays two rows tall. */}
      {ops === undefined ? null : <div className="mb-[11px]">{ops}</div>}

      <div className="flex items-end gap-[8px]">
        <textarea
          ref={field}
          rows={1}
          className="field min-h-[46px] flex-1 resize-none py-[13px]"
          placeholder={strings.chat.composerPlaceholder}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends on a keyboard; Shift+Enter is a newline. On a phone
            // the on-screen return key inserts a newline as it should, because
            // the software keyboard does not report a shift state.
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
        />

        {/* The ops key. Takes the red active treatment while the drawer is open. */}
        <button
          type="button"
          onClick={onToggleOps}
          aria-pressed={opsOpen}
          // The label follows the state: a button that says "close" to the eye
          // and "ops" to a screen reader is two different buttons.
          aria-label={opsOpen ? strings.chat.opsClose : strings.chat.ops}
          className="chrome flex h-[46px] w-[46px] flex-none items-center justify-center border text-[9px] tracking-[0.10em] uppercase"
          style={{
            borderColor: opsOpen ? "var(--onsen-color-red)" : "var(--onsen-color-border-quiet)",
            color: opsOpen ? "var(--onsen-color-red)" : "var(--onsen-color-text-muted)",
          }}
        >
          {opsOpen ? strings.chat.opsClose : strings.chat.ops}
        </button>

        {/* Send posts the message and asks for a reply. */}
        <button
          type="button"
          onClick={send}
          disabled={disabled || draft.trim() === ""}
          aria-label={strings.chat.send}
          className="btn btn-primary flex h-[46px] w-[46px] flex-none flex-col items-center justify-center gap-[1px] px-0"
        >
          <span className="text-[9px] leading-none font-semibold tracking-[0.06em]">
            {speakerInitials}
          </span>
          <span className="text-[12px] leading-none">↑</span>
        </button>
      </div>

      {/* Asking for a reply without saying anything is how you let a scene run on. */}
      <button
        type="button"
        onClick={onGenerate}
        disabled={disabled}
        className="chrome mt-[10px] w-full border border-border-quiet py-[11px] text-[9.5px] tracking-[0.14em] text-ink-muted uppercase disabled:opacity-40"
      >
        {strings.chat.continueWithout}
      </button>
    </div>
  );
}
