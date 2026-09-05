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

/**
 * Publishing the reader's prose settings as custom properties (§20 phase 55).
 *
 * The three values are the only part of the type system the reader controls
 * (SPEC §16 §Density), and they are applied here rather than baked into
 * `tokens.css` so a change takes effect on the frame it is made — a font-size
 * control you have to reload to see is a control nobody trusts.
 *
 * Set on `documentElement` for the same reason `--onsen-app-height` is: it is
 * above every theme's `:root` block in the cascade, so a theme cannot pin the
 * reader's size by accident.
 */
export function useReadingVariables(reading: {
  scale: number;
  measure: number;
  leading: number;
}): void {
  const { scale, measure, leading } = reading;
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--onsen-prose-scale", String(scale));
    root.setProperty("--onsen-prose-measure", `${measure}px`);
    root.setProperty("--onsen-leading-prose", String(leading));
  }, [scale, measure, leading]);
}
