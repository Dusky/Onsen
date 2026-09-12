import { useRef, type ReactNode } from "react";
import { useModalFocus } from "../lib/modal.ts";
import { useIsDesktop } from "../lib/breakpoint.ts";

/**
 * A sheet over the dimmed scene: a bottom sheet on a phone, a centred dialog
 * on a desktop (§20 phase 173).
 *
 * It shipped bottom-anchored only, at every width — a phone shape stretched
 * across a 1600px desktop screen, sliding up from an edge that is not where a
 * mouse-and-keyboard reader's attention is. `CommandPalette`, the app's other
 * modal, already solved this for itself (top-anchored, a plain square border,
 * no radius); a desktop `Sheet` now matches that rather than inventing a
 * third treatment. Nothing about the phone shape changes: a bottom sheet is
 * still the right gesture where a thumb is doing the reaching.
 *
 * One of the two places the design allows a rounded corner on a phone
 * (`16px 16px 0 0`); square everywhere else, on a phone and on a desktop
 * alike. There is no shadow — the scene dimming behind it is what separates
 * the layers.
 */
export function Sheet({
  title,
  meta,
  tone = "default",
  onClose,
  children,
}: {
  title: string;
  /** Right-aligned on the header row. A cost, usually. */
  meta?: string | undefined;
  /**
   * Which pencil the sheet is in. `blue` is the author talking about their own
   * machinery — the guides panel, and nothing else so far — and it takes the
   * design's 2px blue border rather than the usual hairline.
   */
  tone?: "default" | "blue";
  onClose(): void;
  children: ReactNode;
}) {
  const blue = tone === "blue";
  const isDesktop = useIsDesktop();
  const dialog = useRef<HTMLDivElement | null>(null);

  /*
   * The keyboard's side of a modal: focus in on open, Tab trapped, Escape
   * closing this sheet and not the one underneath, focus back on the control
   * that opened it. All of it in `useModalFocus`, because `CommandPalette` is
   * the app's other modal and needs exactly the same thing.
   *
   * This used to be a bare Escape listener and a comment describing focus
   * handling that did not exist.
   */
  useModalFocus(dialog, onClose);

  return (
    <div
      className={
        isDesktop
          ? // `items-start` matters: a row flex stretches its children on the
            // cross axis by default, which made the dialog run all the way to
            // the bottom edge of the window — the exact thing being fixed.
            "fixed inset-0 z-50 flex items-start justify-center px-[16px] pt-[64px]"
          : "fixed inset-0 z-50 flex flex-col justify-end"
      }
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/70"
      />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // Focusable only by script, so the sheet itself can hold focus when it
        // opens and when it contains nothing to Tab to.
        tabIndex={-1}
        // Capped and centred either way. On a phone the width still stretches
        // to the reading measure; on a desktop the whole dialog is that width,
        // never the viewport's.
        className={
          isDesktop
            ? "relative flex w-full max-w-[var(--onsen-prose-measure)] flex-col"
            : "relative mx-auto w-full max-w-[var(--onsen-prose-measure)]"
        }
        style={{
          borderRadius: isDesktop ? "0" : "16px 16px 0 0",
          background: blue ? "var(--onsen-color-blue-bg-sheet)" : "var(--onsen-color-bg-raised)",
          /*
           * Spread rather than `undefined` per key, and the reason is a bug
           * this had: React writes a key whose value is `undefined` as an
           * empty string, which *removes* that longhand — so pairing
           * `border` with `borderTop: undefined` expanded the shorthand and
           * then cleared the top edge, and the desktop dialog rendered with
           * three borders and an open top. An absent key is absent.
           *
           * The safe-area allowance is a phone concern too: a dialog
           * floating clear of every edge has no notch to clear.
           */
          ...(isDesktop
            ? { border: `1px solid var(--onsen-color-${blue ? "blue" : "rule-strong"})` }
            : {
                borderTop: blue
                  ? "2px solid var(--onsen-color-blue)"
                  : "1px solid var(--onsen-color-rule-strong)",
                paddingBottom: "calc(14px + env(safe-area-inset-bottom))",
              }),
        }}
      >
        <div
          className="flex items-baseline justify-between px-[22px] pt-[16px] pb-[12px]"
          style={{ borderBottom: `1px solid var(--onsen-color-${blue ? "blue-border" : "rule"})` }}
        >
          <p
            className="section-label"
            style={blue ? { color: "var(--onsen-color-blue-text)" } : undefined}
          >
            {title}
          </p>
          {meta === undefined ? null : (
            <p
              className="chrome text-[12.5px]"
              style={{ color: `var(--onsen-color-${blue ? "blue-text-muted" : "text-dim"})` }}
            >
              {meta}
            </p>
          )}
        </div>
        <div className="max-h-[70dvh] overflow-y-auto px-[22px] py-[10px]">{children}</div>
      </div>
    </div>
  );
}

/** A row in an action sheet. Destructive rows take the red pencil. */
export function SheetAction({
  label,
  onClick,
  destructive = false,
  disabled = false,
}: {
  label: string;
  onClick(): void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="chrome flex w-full items-center border-b border-rule py-[15px] text-left text-[13.5px] disabled:opacity-40"
      style={{ color: destructive ? "var(--onsen-color-red)" : "var(--onsen-color-text-label)" }}
    >
      {label}
    </button>
  );
}
