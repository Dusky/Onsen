import { useEffect, useState } from "react";

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
 * 1024px rather than the design's 1440: the three-column shell needs 232 + 620
 * + 292 = 1144 to hold its stated widths, and below that the rail is the first
 * thing to go. A tablet in landscape gets the sidebar and the rail; a tablet in
 * portrait gets the phone layout, which is the right answer for a 768px column.
 */
const DESKTOP = "(min-width: 1144px)";

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(DESKTOP).matches,
  );

  useEffect(() => {
    const query = window.matchMedia(DESKTOP);
    const onChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    // Set once on mount as well: a resize that crossed the breakpoint before
    // this effect ran would otherwise leave the first render's answer standing.
    setIsDesktop(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return isDesktop;
}
