import { useEffect } from "react";

/**
 * Keeping the app the height of the *visible* viewport.
 *
 * `100dvh` accounts for collapsing browser chrome but not for the software
 * keyboard: on iOS the layout viewport does not shrink when the keyboard opens,
 * so a composer pinned to the bottom of the page ends up behind it. The visual
 * viewport does shrink, so its height is published as a custom property and the
 * screens size themselves from it, falling back to 100dvh where the API is
 * absent.
 */
export function useViewportHeight(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (viewport === undefined || viewport === null) return;

    const apply = () => {
      document.documentElement.style.setProperty("--onsen-app-height", `${viewport.height}px`);
      // When the keyboard opens the visual viewport is also offset; without
      // this the app is the right height but scrolled out from under the
      // keyboard.
      document.documentElement.style.setProperty("--onsen-app-offset", `${viewport.offsetTop}px`);
    };

    apply();
    viewport.addEventListener("resize", apply);
    viewport.addEventListener("scroll", apply);
    return () => {
      viewport.removeEventListener("resize", apply);
      viewport.removeEventListener("scroll", apply);
    };
  }, []);
}
