import { useEffect, useRef, type RefObject } from "react";

/**
 * What an open modal owes a keyboard.
 *
 * Written for `Sheet`, the app's only modal primitive — 56 usages across 32
 * files plus every `useConfirm()` question — which had no focus code at all,
 * and a comment claiming it did. It lives here rather than in that file
 * because `CommandPalette` is the app's *other* modal and had the same holes:
 * Tab walked straight out of it into the log behind, and its Escape was on the
 * search input rather than on the dialog.
 *
 * Three obligations, and the sheet met none of them:
 *
 *   1. Focus starts inside the modal — but not on top of a field that already
 *      claimed it, since several call sites `autoFocus` one.
 *   2. Tab and Shift+Tab stay inside it.
 *   3. Escape closes it, and closes *only* it. Focus goes back to whatever
 *      opened it.
 */

/**
 * Which modals are open, and in what order they opened.
 *
 * Escape used to be a bare `window` listener per modal, so a confirmation
 * opened from *inside* a sheet — the normal shape here, `ConfirmSheet` says so
 * in its own comment and `Checkpoints` renders it inside the sheet it belongs
 * to — closed both at once on one press. The trap has the same problem in
 * reverse: every open modal hears the Tab, and only the top one should act.
 *
 * The number is taken at first render rather than on mount, because React runs
 * a child's effects before its parent's: a modal nested inside another in the
 * same commit would otherwise register first and be mistaken for the one
 * underneath. Render order is parent first, which is how they stack.
 */
let opened = 0;
const OPEN_MODALS = new Set<number>();

function isTopmost(order: number): boolean {
  return Math.max(...OPEN_MODALS) === order;
}

/**
 * What Tab can reach. A backdrop is deliberately unreachable: `Sheet`'s is a
 * focusable `<button aria-label="Close">` that precedes the dialog, so the
 * stops are queried from the dialog element and it falls outside — a trap
 * including it would send the first Tab to a control that looks like nothing.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Give a `role="dialog"` element the keyboard behaviour of a modal.
 *
 * The element needs `tabIndex={-1}` so it can hold focus itself — when it
 * opens, and when it contains nothing to Tab to.
 */
export function useModalFocus(dialog: RefObject<HTMLElement | null>, onClose: () => void): void {
  const order = useRef<number | null>(null);
  const trigger = useRef<Element | null>(null);
  if (order.current === null) {
    order.current = ++opened;
    /*
     * Both of these are taken on the first render, and both have to be.
     *
     * `order` for the stacking reason above. `trigger` because the first
     * render is the last moment at which focus is still on whatever opened the
     * modal — and because an effect is the wrong place to read it: React's
     * development double-invoke runs effects twice, and the second pass would
     * capture the modal's own dialog as its trigger, so the restore on close
     * aimed at a node that no longer existed. The browser drive found that;
     * nothing else would have, since it only misbehaves in development.
     */
    trigger.current = document.activeElement;
  }

  useEffect(() => {
    const self = order.current!;
    OPEN_MODALS.add(self);
    const opener = trigger.current;
    const node = dialog.current;
    // Only if nothing inside claimed it first: several call sites `autoFocus`
    // a field (renaming a scene, naming a checkpoint, the palette's own search
    // box), React applies that during the commit — before effects run — and
    // the modal must not take it back off them.
    if (node !== null && !node.contains(document.activeElement)) node.focus();
    return () => {
      OPEN_MODALS.delete(self);
      if (!(opener instanceof HTMLElement)) return;
      /*
       * A frame later, and only if nobody else has claimed focus.
       *
       * This cleanup runs mid-commit: the modal's own DOM is still in the
       * document, and one that closed *into* another — Manage a roleplay →
       * Rename, which swaps both in one commit — has not mounted its
       * replacement yet. Asking "has anyone else taken focus" right here has
       * no real answer, and answering it wrongly is visible: the browser drive
       * caught this version stealing focus off the rename field the instant it
       * opened.
       *
       * By the next frame both have settled. Focus sitting on `<body>` is what
       * an ordinary close leaves behind — the modal's DOM went away under it —
       * and is the one case worth restoring from.
       */
      requestAnimationFrame(() => {
        if (!opener.isConnected) return;
        const active = document.activeElement;
        if (active === null || active === document.body || active === document.documentElement) {
          opener.focus();
        }
      });
    };
    // Deliberately once: the ref identity is stable, and re-running this would
    // re-register the modal and re-read the trigger.
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Every open modal hears this. Only the top one acts.
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
        // Tab escape to whatever is behind.
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
        // Focus is somewhere behind the modal — a backdrop, or the log.
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, onClose]);
}
