import { useEffect, useRef, type ReactNode } from "react";

/**
 * Which sheets are open, and in what order they opened.
 *
 * Two things need it. Escape used to be a bare `window` listener per sheet, so
 * a confirmation opened from *inside* a sheet — which is the normal shape here,
 * `ConfirmSheet` says so in its own comment and `Checkpoints` renders it inside
 * the sheet it belongs to — closed both at once on one press. And the focus
 * trap has the same problem in reverse: every open sheet hears the Tab, and
 * only the top one should act on it.
 *
 * The number is taken at first render rather than on mount, because React runs
 * a child's effects before its parent's: a sheet nested inside another in the
 * same commit would otherwise register first and be mistaken for the one
 * underneath. Render order is parent first, which is the order they stack in.
 */
let opened = 0;
const OPEN_SHEETS = new Set<number>();

function isTopmost(order: number): boolean {
  return Math.max(...OPEN_SHEETS) === order;
}

/**
 * What Tab can reach. The backdrop is a focusable `<button aria-label="Close">`
 * and is deliberately not in here: it sits outside the dialog element, so
 * querying within the dialog excludes it, and a trap that included it would
 * send the first Tab to a control that looks like nothing.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A bottom sheet over the dimmed scene.
 *
 * One of the three places the design allows a rounded corner (`16px 16px 0 0`);
 * everything else in the system is square. There is no shadow — the scene
 * dimming behind it is what separates the layers.
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
   * design's 2px blue top border rather than the usual hairline.
   */
  tone?: "default" | "blue";
  onClose(): void;
  children: ReactNode;
}) {
  const blue = tone === "blue";
  const dialog = useRef<HTMLDivElement | null>(null);
  const order = useRef<number | null>(null);
  const trigger = useRef<Element | null>(null);
  if (order.current === null) {
    order.current = ++opened;
    /*
     * Both of these are taken on the first render, and both have to be.
     *
     * `order` for the stacking reason in OPEN_SHEETS above. `trigger` because
     * the first render is the last moment at which focus is still on whatever
     * opened the sheet — and because an effect is the wrong place to read it:
     * React's development double-invoke runs effects twice, and the second
     * pass would capture the sheet's own dialog as its trigger, so the restore
     * on close aimed at a node that no longer existed. The browser drive found
     * that; nothing else would have, since it only misbehaves in development.
     */
    trigger.current = document.activeElement;
  }

  /*
   * Focus belongs to the sheet while it is open, and goes back where it came
   * from when it closes.
   *
   * The comment here used to claim this and the code did none of it: a
   * keyboard user could Tab straight out of an open sheet and into the log
   * underneath, invisibly, and on close was left with focus on `<body>`.
   *
   * The trigger is whatever had focus when the sheet first rendered, which is
   * the right answer however distant the button is — `ChatSheets` drives a
   * dozen of these from `ChatScreen`'s state, so the component holding the
   * open flag is nowhere near the control that set it. The restore is guarded
   * by `isConnected` because some triggers do not survive their sheet: a row's
   * `⋯` button, when the sheet deletes the row.
   */
  useEffect(() => {
    const self = order.current!;
    OPEN_SHEETS.add(self);
    const opener = trigger.current;
    const node = dialog.current;
    // Only if nothing inside claimed it first: several call sites `autoFocus`
    // a field (renaming a scene, naming a checkpoint), React applies that
    // during the commit — before effects run — and the sheet must not take it
    // back off them.
    if (node !== null && !node.contains(document.activeElement)) node.focus();
    return () => {
      OPEN_SHEETS.delete(self);
      if (!(opener instanceof HTMLElement)) return;
      /*
       * A frame later, and only if nobody else has claimed focus.
       *
       * This cleanup runs mid-commit: the sheet's own DOM is still in the
       * document, and a sheet that closed *into* another one — Manage a
       * roleplay → Rename, which swaps both in one commit — has not mounted
       * its replacement yet. Asking "has anyone else taken focus" right here
       * has no real answer, and answering it wrongly is visible: the browser
       * drive caught this version stealing focus off the rename field the
       * instant it opened.
       *
       * By the next frame both have settled. Focus sitting on `<body>` is
       * what an ordinary close leaves behind — the sheet's DOM went away
       * under it — and is the one case worth restoring from.
       */
      requestAnimationFrame(() => {
        if (!opener.isConnected) return;
        const active = document.activeElement;
        if (active === null || active === document.body || active === document.documentElement) {
          opener.focus();
        }
      });
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Every open sheet hears this. Only the top one acts: a confirmation
      // opened from inside a sheet used to close both on one Escape.
      if (!isTopmost(order.current!)) return;
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const node = dialog.current;
      if (node === null) return;
      const stops = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (stops.length === 0) {
        // Nothing to land on, so hold focus on the dialog rather than letting
        // Tab escape to the log.
        event.preventDefault();
        node.focus();
        return;
      }
      const first = stops[0]!;
      const last = stops[stops.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === node)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (!node.contains(active)) {
        // Focus is somewhere behind the sheet — the backdrop, or the log.
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
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
        // Capped and centred on a wide screen. A bottom sheet is a phone shape;
        // stretched across 1440px it stops reading as a sheet and starts
        // reading as the page having been replaced.
        className="relative mx-auto w-full max-w-[var(--onsen-prose-measure)]"
        style={{
          borderRadius: "16px 16px 0 0",
          borderTop: blue
            ? "2px solid var(--onsen-color-blue)"
            : "1px solid var(--onsen-color-rule-strong)",
          background: blue ? "var(--onsen-color-blue-bg-sheet)" : "var(--onsen-color-bg-raised)",
          paddingBottom: "calc(14px + env(safe-area-inset-bottom))",
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
