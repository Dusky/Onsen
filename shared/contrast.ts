/**
 * Colour measurement, shared because two callers need the same answer.
 *
 * `test/surfaces.test.ts` has measured surface separation since phase 49, for
 * a reason worth restating: each screen looked deliberate on its own, and the
 * defect — two hex values two points apart — was a *relationship*, which no
 * screenshot review finds. The same argument applies to ink on a ground, and
 * to a colour the reader picks for a character: a warning at the moment of
 * picking is worth more than a legibility bug discovered a week later.
 *
 * So the maths lives here rather than in the test, and the character editor
 * calls it at runtime.
 *
 * Two different lightness functions, deliberately:
 *
 *   - `perceivedLightness` is a plain weighted mean in 0–255. It answers "can
 *     the eye find this step", which is what the surface and hairline steps
 *     are about, and the thresholds those tests use were chosen against it.
 *   - `relativeLuminance` is WCAG 2.1's definition, with the sRGB transfer
 *     curve undone first. It is the only one that feeds a legal contrast
 *     ratio, and it disagrees with the mean sharply in the dark end — which
 *     is exactly where this app's grounds sit.
 *
 * Everything takes `#rrggbb`. Tokens are written that way throughout
 * `tokens.css` and `server/themes/builtin.ts`; `color-mix()` values and
 * gradients are not colours this module can read, and callers filter them out.
 */

/** True for the one input shape every function here accepts. */
export function isHex6(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

/** The three 0–255 channels of `#rrggbb`. */
export function channels(hex: string): [number, number, number] {
  const value = hex.trim().replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
  return [r!, g!, b!];
}

/** Perceived lightness, 0–255. Weighted, because #00f is not #ff0. */
export function perceivedLightness(hex: string): number {
  const [r, g, b] = channels(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Straight-line distance in RGB. Crude, but enough to tell two hues apart. */
export function distance(a: string, b: string): number {
  const [x, y] = [channels(a), channels(b)];
  return Math.sqrt(x.reduce((sum, value, i) => sum + (value - y[i]!) ** 2, 0));
}

/**
 * WCAG 2.1 relative luminance, 0–1.
 *
 * The channel values in a hex colour are gamma-encoded; averaging them
 * directly overstates how light a dark colour is. Undoing the sRGB transfer
 * curve first is the whole difference between this and `perceivedLightness`.
 */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/**
 * WCAG 2.1 contrast ratio, 1–21. Symmetric: argument order does not matter.
 */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

/** WCAG AA for body text, and the floor this app holds its ink to. */
export const AA_CONTRAST = 4.5;

/** WCAG AA for text at 24px+, or 19px+ bold. Not used as an excuse for ink. */
export const AA_LARGE_CONTRAST = 3;

/** Rounded the way a reader would quote it: "4.5:1". */
export function ratioLabel(ratio: number): string {
  return `${Math.round(ratio * 100) / 100}:1`;
}
