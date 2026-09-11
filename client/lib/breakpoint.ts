import { useEffect, useRef, useState } from "react";
import { useUiStore } from "../state/ui.ts";

/**
 * Whether there is room for the desktop layout (design `4a`, SPEC §16).
 *
 * The design is emphatic that desktop is "the same components, unrolled — not a
 * separate design", and most of that unrolling is CSS: the prose column keeps
 * its 620px measure, the type scale does not change, the palette does not
 * change. But three things genuinely reparent rather than reflow — the cast
 * leaves the composer and becomes a rail, the ops grid flattens into a row that
 * is always visible, and the guides sheet becomes a footer on that rail — and a
 * media query cannot move a component from one parent to another.
 *
 * So: one hook, read in the few places the tree differs, and plain CSS
 * everywhere else.
 *
 * 1144px is *not* "232 + 620 + 292", the old three-column shell's figures —
 * that comment described a shell this codebase no longer has. Under the
 * current shell it is 54 (a rail's icon strip) + 326 (a rail panel) + 720
 * (`--onsen-prose-measure`) + 44 (the other rail's icon strip) = 1144: the
 * width at which the shell can hold one rail's panel open, the log at its
 * full measure, and the other rail still present as an icon strip. Below
 * that, RIGHT_RAIL_MIN_WIDTH and LEFT_PANEL_MIN_WIDTH below are moot — there
 * is no room for either panel — so the shell gives up and hands back the
 * phone layout instead of rendering a squeezed one (design review fix 6).
 */
const DESKTOP = "(min-width: 1144px)";

/**
 * The two rails' auto-collapse bands (design review fix 6).
 *
 * The full shell needs 54 (a rail's icon strip) + 326 (left panel) + 720
 * (`--onsen-prose-measure`) + 352 (right panel) = 1452 to hold both rails
 * open at once without squeezing the log under its measure. Below that the
 * right rail is the first to give way, closing to its own icon strip.
 *
 * Below 1126 — 54 (icon strip) + 720 (prose measure) + the log's own padding
 * — even the left panel costs more than the log can spare once the right
 * rail has already closed, so it collapses to its icon strip too.
 *
 * Named here, next to DESKTOP, so a change to `--onsen-prose-measure` has one
 * obvious place to be reflected in all three figures.
 */
export const RIGHT_RAIL_MIN_WIDTH = 1452;
export const LEFT_PANEL_MIN_WIDTH = 1126;

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    // Set once on mount as well: a resize that crossed the breakpoint before
    // this effect ran would otherwise leave the first render's answer standing.
    setMatches(list.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP);
}

/**
 * Collapses each rail's panel to its icon strip when the window crosses that
 * rail's width band, right first (design review fix 6).
 *
 * A manual toggle is left alone as long as the window stays within the band
 * it was made in — a reader who opens a rail at 1300px keeps it open until
 * they close it themselves. Only a crossing forces the rail back to that
 * band's own default, which is why this tracks the *previous* match rather
 * than reacting to the width itself: an unrelated re-render must not re-open
 * a rail the reader just closed.
 */
export function useAutoCollapseRails(): void {
  const hasRightRoom = useMediaQuery(`(min-width: ${RIGHT_RAIL_MIN_WIDTH}px)`);
  const hasLeftRoom = useMediaQuery(`(min-width: ${LEFT_PANEL_MIN_WIDTH}px)`);
  const setLeftRailOpen = useUiStore((state) => state.setLeftRailOpen);
  const setRightRailOpen = useUiStore((state) => state.setRightRailOpen);

  const prevRight = useRef<boolean | null>(null);
  useEffect(() => {
    if (prevRight.current !== hasRightRoom) {
      setRightRailOpen(hasRightRoom);
      prevRight.current = hasRightRoom;
    }
  }, [hasRightRoom, setRightRailOpen]);

  const prevLeft = useRef<boolean | null>(null);
  useEffect(() => {
    if (prevLeft.current !== hasLeftRoom) {
      setLeftRailOpen(hasLeftRoom);
      prevLeft.current = hasLeftRoom;
    }
  }, [hasLeftRoom, setLeftRailOpen]);
}
