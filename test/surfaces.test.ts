import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Surfaces have to be far enough apart to see (SPEC §16, §20 phase 49).
 *
 * The handoff's dark palette put the page at `#14120f` and everything raised
 * onto it at `#16130f` — two points of lightness per channel, which the eye
 * does not find. Every sheet, composer and footer in the app is `bg-raised`,
 * so for forty-odd phases nothing that was meant to sit *on* the page looked
 * like it did. The report, when it came, was "a lot of dark on dark".
 *
 * No screenshot review catches this: each screen looks deliberate on its own,
 * and the defect is a relationship between two hex values in one file. So it
 * is measured.
 */

const TOKENS = readFileSync(join(import.meta.dir, "..", "client", "styles", "tokens.css"), "utf8");

/** Perceived lightness, 0–255. Weighted, because #00f is not #ff0. */
function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Every definition of a token, one per theme block. */
function valuesOf(token: string): string[] {
  return [...TOKENS.matchAll(new RegExp(`--onsen-${token}:\\s*(#[0-9a-fA-F]{6})`, "g"))].map(
    (match) => match[1]!,
  );
}

/** The dark block is the first `:root`, before any light override. */
function dark(token: string): string {
  const value = valuesOf(token)[0];
  expect(value).toBeDefined();
  return value!;
}

/**
 * Below this a step is decoration rather than information. Chosen from the
 * failure it was written for: the old ground-to-raised step measured about 2
 * and was invisible; the replacement measures about 9.
 */
const MIN_STEP = 5;

describe("the dark palette", () => {
  test("has the tokens this file checks", () => {
    for (const token of ["color-bg", "color-bg-raised", "color-bg-inset", "color-rule"]) {
      expect(valuesOf(token).length).toBeGreaterThan(0);
    }
  });

  test("lifts a raised surface clear of the page", () => {
    const step = luminance(dark("color-bg-raised")) - luminance(dark("color-bg"));
    expect({ step: Math.round(step), enough: step >= MIN_STEP }).toMatchObject({ enough: true });
  });

  test("lifts an inset surface clear of a raised one", () => {
    const step = luminance(dark("color-bg-inset")) - luminance(dark("color-bg-raised"));
    expect({ step: Math.round(step), enough: step >= MIN_STEP }).toMatchObject({ enough: true });
  });

  test("keeps a hairline visible on the surface it divides", () => {
    // Raising the surfaces without raising the rules would hide every divider
    // inside the panels they are drawn in — the same bug, one layer up.
    const step = luminance(dark("color-rule")) - luminance(dark("color-bg-raised"));
    expect({ step: Math.round(step), enough: step >= 3 }).toMatchObject({ enough: true });
  });
});

/**
 * The subsystem hues (SPEC §16, §20 phase 50).
 *
 * Instrument's deck states what four systems are holding at once, and the
 * whole argument for it is that four figures in one colour read as one figure.
 * So the hues have to be far enough apart to tell apart — and far enough from
 * red, which stays the colour of *now* and must not be mistaken for a status.
 */

function distance(a: string, b: string): number {
  const channels = (hex: string) => {
    const v = hex.replace("#", "");
    return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
  };
  const [x, y] = [channels(a), channels(b)];
  return Math.sqrt(x.reduce((sum, value, i) => sum + (value - y[i]!) ** 2, 0));
}

describe("the deck's hues", () => {
  const HUES = ["color-blue", "color-green", "color-amber"] as const;

  test("exist in every theme block", () => {
    // Three blocks: the dark base, the light media query, the explicit light.
    for (const hue of [...HUES, "color-green-text", "color-amber-text"]) {
      expect({ hue, blocks: valuesOf(hue).length }).toMatchObject({ blocks: 3 });
    }
  });

  test("are far enough apart to read as different systems", () => {
    for (const [i, a] of HUES.entries()) {
      for (const b of HUES.slice(i + 1)) {
        const apart = distance(dark(a), dark(b));
        expect({ a, b, apart: Math.round(apart), ok: apart > 40 }).toMatchObject({ ok: true });
      }
    }
  });

  test("none of them is the red pencil", () => {
    // Red means "now" — the cued speaker, streaming, stop. A readout wearing
    // it would read as an alarm rather than as a count.
    for (const hue of HUES) {
      const apart = distance(dark(hue), dark("color-red"));
      expect({ hue, apart: Math.round(apart), ok: apart > 40 }).toMatchObject({ ok: true });
    }
  });
});
