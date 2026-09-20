import { useEffect, useRef, useState } from "react";
import { DOCK_DEFAULTS } from "@shared/types.ts";
import { useDock, useSetPreferences } from "./queries.ts";
import { useShellRoute } from "./router.ts";
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

/**
 * The same two bands, fed the dock's *current* panel widths instead of the
 * two literals above (§20 phase 173's rail dock rework made those widths a
 * preference, `DockDto.leftWidth`/`rightWidth`, rather than a constant).
 *
 * Expressed as this constant plus however far each width has moved from its
 * own default, not re-derived from scratch: at the shipped widths (326/352)
 * both deltas are zero and this returns exactly `RIGHT_RAIL_MIN_WIDTH` and
 * `LEFT_PANEL_MIN_WIDTH`, so nothing about today's behaviour changes until a
 * reader actually opens the dock editor and drags a width. Past that point
 * the relationship is the same one already commented above: a rail a reader
 * has made wider needs that many more px of window to still fit alongside
 * the log's own measure, and a rail made narrower needs that many fewer.
 */
export function autoCollapseBands(leftWidth: number, rightWidth: number): {
  rightRailMinWidth: number;
  leftPanelMinWidth: number;
} {
  const leftDelta = leftWidth - DOCK_DEFAULTS.leftWidth;
  const rightDelta = rightWidth - DOCK_DEFAULTS.rightWidth;
  return {
    rightRailMinWidth: RIGHT_RAIL_MIN_WIDTH + leftDelta + rightDelta,
    // The right rail is already closed to its icon strip by the time this
    // band matters, so only the left panel's own width is still in play.
    leftPanelMinWidth: LEFT_PANEL_MIN_WIDTH + leftDelta,
  };
}

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
 *
 * Phase 225 adds a second input of the same shape: whether a roleplay is
 * mounted behind the shell. Off a scene both rails start as their icon strip,
 * unless the reader has said otherwise and that is stored in `DockDto`. Same
 * discipline — only a *change* of the answer forces a rail, so a rail opened by
 * hand on Characters survives every re-render until the reader leaves.
 */
export function useAutoCollapseRails(): void {
  const dock = useDock();
  const { rightRailMinWidth, leftPanelMinWidth } = autoCollapseBands(dock.leftWidth, dock.rightWidth);
  const hasRightRoom = useMediaQuery(`(min-width: ${rightRailMinWidth}px)`);
  const hasLeftRoom = useMediaQuery(`(min-width: ${leftPanelMinWidth}px)`);
  const setLeftRailOpen = useUiStore((state) => state.setLeftRailOpen);
  const setRightRailOpen = useUiStore((state) => state.setRightRailOpen);
  const onScene = useSceneBehind();

  // What each rail should be, given the room and what is behind the shell.
  // Width still wins: a rail that does not fit cannot open, whichever screen
  // the reader is on.
  const wantRight = hasRightRoom && (onScene || dock.rightOpenOffScene);
  const wantLeft = hasLeftRoom && (onScene || dock.leftOpenOffScene);

  const prevRight = useRef<boolean | null>(null);
  useEffect(() => {
    if (prevRight.current !== wantRight) {
      setRightRailOpen(wantRight);
      prevRight.current = wantRight;
    }
  }, [wantRight, setRightRailOpen]);

  const prevLeft = useRef<boolean | null>(null);
  useEffect(() => {
    if (prevLeft.current !== wantLeft) {
      setLeftRailOpen(wantLeft);
      prevLeft.current = wantLeft;
    }
  }, [wantLeft, setLeftRailOpen]);
}

/**
 * Whether a roleplay is mounted behind the shell (§20 phase 225).
 *
 * The *base* route, not the visible one, and that is the whole point. Since
 * phase 171 an overlay screen fills only the content box and the base screen
 * stays mounted underneath — so a reader who opens Settings from a chat still
 * has that chat behind it and is going back to it. Collapsing its rails on the
 * way in and re-opening them on the way out is churn nobody asked for. A reader
 * who reaches Settings from the Roleplays list has no scene behind them, and
 * that is the case the measurement was about.
 */
function useSceneBehind(): boolean {
  return useShellRoute().base.name === "chat";
}

/**
 * The two rail toggles, which also remember an off-scene choice (§20 phase 225).
 *
 * One hook rather than three components reaching into the store, because the
 * write has to happen wherever the reader flips a rail and a seventh call site
 * added later is exactly how that would be forgotten. On the chat these are the
 * plain store toggles they have always been: there is no off-scene decision to
 * record, and the rails stay chrome.
 */
export function useRailToggles(): { toggleLeft(): void; toggleRight(): void } {
  const dock = useDock();
  const save = useSetPreferences();
  const onScene = useSceneBehind();
  const leftRailOpen = useUiStore((state) => state.leftRailOpen);
  const rightRailOpen = useUiStore((state) => state.rightRailOpen);
  const toggleLeftRail = useUiStore((state) => state.toggleLeftRail);
  const toggleRightRail = useUiStore((state) => state.toggleRightRail);

  return {
    toggleLeft: () => {
      toggleLeftRail();
      if (!onScene) save.mutate({ dock: { leftOpenOffScene: !leftRailOpen } });
    },
    toggleRight: () => {
      toggleRightRail();
      if (!onScene) save.mutate({ dock: { rightOpenOffScene: !rightRailOpen } });
    },
  };
}
