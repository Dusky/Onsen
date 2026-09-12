import { useRef, type ReactNode } from "react";
import { useModalFocus } from "../lib/modal.ts";

/**
 * A screen, floating over whichever base screen was open (§20 phase 171).
 *
 * Before this, navigating to Settings — or Characters, or a lorebook, or
 * scene setup — fully unmounted whatever was showing: `Routed()` was one flat
 * switch, and a scene's scroll position, its composer draft, an in-flight
 * generation, all went away the instant you looked at something else and came
 * back to nothing you left. Nothing about that was inherent — `client/App.tsx`
 * already keeps the rails and header mounted across every navigation; only
 * the routed content itself was ever torn down.
 *
 * `useShellRoute` (`client/lib/router.ts`) decides which screen is the base
 * (kept mounted, always) and which — if any — is layered on top; this is that
 * layer. It fills exactly the content area `<Routed/>` normally occupies —
 * `absolute inset-0` against a `position: relative` wrapper the shell already
 * gives it — not the whole viewport, so the rails and header stay visible and
 * reachable at every edge. That is what makes "pop up over it" true rather
 * than aspirational: the base screen underneath is not just alive in memory,
 * the app's own navigation around the overlay still works while it is open.
 *
 * The keyboard obligations are `Sheet`'s: focus in, Tab trapped, Escape
 * closing this and not something stacked below it, focus back on whatever
 * opened it. Same `useModalFocus` hook, so a `Sheet` opened *from inside* an
 * overlay screen — the character editor's own confirm dialogs, say — still
 * closes only the topmost on Escape.
 */
export function RouteOverlay({
  label,
  onClose,
  children,
}: {
  /** The accessible name — each overlay screen carries its own visible
   * heading already, but a `role="dialog"` should still name itself. */
  label: string;
  onClose(): void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDivElement | null>(null);
  useModalFocus(dialog, onClose);

  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      // Opaque, matching every screen's own `bg-bg` — there is no dimmed
      // scene to see through behind it, because it covers exactly the box
      // the scene itself renders in. `z-40`: above the routed content it
      // replaces, below `NoticeRegion` and vanish mode's restore handle
      // (both `z-50`), so a notice or the way back out of vanish mode is
      // never hidden behind a settings screen.
      className="absolute inset-0 z-40 flex flex-col overflow-y-auto bg-bg"
    >
      {children}
    </div>
  );
}
