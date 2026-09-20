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

/** Mix `hex` toward `end` by `t` in 0–1. `t = 0` is `hex`, `t = 1` is `end`. */
function mix(hex: string, end: string, t: number): string {
  const [a, b] = [channels(hex), channels(end)];
  const channel = (i: number) => Math.round(a[i]! + (b[i]! - a[i]!) * t);
  return (
    "#" +
    [0, 1, 2]
      .map((i) => Math.max(0, Math.min(255, channel(i))).toString(16).padStart(2, "0"))
      .join("")
  );
}

/**
 * The nearest version of a colour that is legible on a given ground
 * (§20 phase 220).
 *
 * A character's colour is a *choice* — the reader picks it, or the palette
 * hands them one — and the same choice has to read on a near-black ground and
 * on a near-white one. It cannot: to clear 4.5:1 against `#e5eaee` a colour
 * needs relative luminance at or below 0.143, and against `#0a0d18` at or above
 * 0.194. The windows do not overlap, so **no single stored hex is legible in
 * both theme bases**, and any attempt to pick one that is has already failed
 * before it starts. That is why this exists: the stored colour is identity, and
 * what gets painted is resolved against the ground in front of it.
 *
 * Phase 218 is what made this urgent. Per-character colour had been on the
 * speaker's name and spine since phase 185, measuring 2.14–2.94:1 on the four
 * light grounds; 218 put the same colour on the spoken words, so a fifth of the
 * prose on screen was below AA and below the 3:1 large-text floor as well.
 *
 * How it moves: toward whichever end — black or white — has the most contrast
 * headroom against the ground, by the *smallest* amount that clears the floor,
 * found by bisection so the answer is deterministic and as close to the
 * reader's colour as the floor allows. Darkening mixes toward black, which
 * preserves hue exactly; lightening mixes toward white, which preserves hue and
 * loses saturation, and is the direction dark themes need, where the palette
 * already passes and nothing moves.
 *
 * At the default floor it always succeeds, and the arithmetic says why: black
 * against a ground of relative luminance L gives `(L + 0.05) / 0.05` and white
 * gives `1.05 / (L + 0.05)`, and the two cross at L ≈ 0.179 where both are
 * 4.58:1. The worse of the two ends is never below 4.5:1 for any ground at all,
 * so there is no colour and no ground this cannot answer — including a reader's
 * own theme, and including mid-grey, which is the case that looks hopeless and
 * is not.
 *
 * A caller asking for more than AA can outrun that: a 7:1 floor is impossible
 * on a ground near L = 0.18. There it returns the better end rather than
 * pretending, so the result is always the most legible thing available and a
 * caller that cares can measure it.
 */
export function readableOn(colour: string, ground: string, floor = AA_CONTRAST): string {
  if (!isHex6(colour) || !isHex6(ground)) return colour;
  if (contrastRatio(colour, ground) >= floor) return colour;

  const end =
    contrastRatio(ground, "#000000") >= contrastRatio(ground, "#ffffff") ? "#000000" : "#ffffff";
  if (contrastRatio(end, ground) < floor) return end;

  // Bisection on the mix amount. Sixteen steps resolves finer than a channel
  // step, so the result is stable rather than merely close.
  let low = 0;
  let high = 1;
  for (let i = 0; i < 16; i++) {
    const middle = (low + high) / 2;
    if (contrastRatio(mix(colour, end, middle), ground) >= floor) high = middle;
    else low = middle;
  }
  const answer = mix(colour, end, high);
  // Rounding to a channel can land a hair under; step the last fraction if so.
  return contrastRatio(answer, ground) >= floor ? answer : end;
}
