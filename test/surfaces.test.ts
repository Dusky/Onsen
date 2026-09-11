import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILTIN_THEMES } from "../server/themes/builtin.ts";
import { completeTokens } from "../server/themes/index.ts";
import {
  AA_CONTRAST,
  contrastRatio,
  distance,
  isHex6,
  perceivedLightness,
  ratioLabel,
} from "../shared/contrast.ts";

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

/**
 * The maths moved to `shared/contrast.ts` in the ink pass, because the
 * character editor needs the same answer at the moment a reader picks a
 * colour. `perceivedLightness` is the weighted mean this file has always used
 * for surface steps; `contrastRatio` is WCAG's, which is a different
 * calculation and the only one a legibility floor can be stated in.
 */
const luminance = perceivedLightness;

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
    // Red means destructive/error only — delete, stop, boundaries (design
    // review fix 1; "now" is amber). A readout wearing it would read as an
    // alarm rather than as a count.
    for (const hue of HUES) {
      const apart = distance(dark(hue), dark("color-red"));
      expect({ hue, apart: Math.round(apart), ok: apart > 40 }).toMatchObject({ ok: true });
    }
  });
});

/**
 * Ink has to be legible on the ground it is written on (§20, the ink pass).
 *
 * `--onsen-color-text-dim` measured 3.47:1 on the dark ground and 3.31:1 on
 * the light one — under WCAG AA's 4.5:1 — and it is not decorative: `.meta`,
 * `.token-count` and `.screen-kicker` all wear it, so token counts,
 * timestamps and every screen's kicker carried it on nearly every screen at
 * 11–12.5px. Placeholder text was worse, at 2.42:1 in Bone.
 *
 * This is the same class of defect as the surfaces above and needs the same
 * treatment, for the same reason: it is a *relationship* between two values in
 * two different files, so each screen looks deliberate on its own and no
 * screenshot review finds it. Nine palettes have to agree — the three blocks
 * in `tokens.css` and each of the eight builtin themes, every one of which
 * spells out its own ink ramp against its own ground.
 *
 * Two assertions, because the first one alone has a cheap wrong answer:
 *
 *   1. Every ink tier clears 4.5:1 against every ground its theme defines.
 *   2. The four tiers of the ramp stay ordered and separated — dim quieter
 *      than muted, muted than label, label than text. Without this the way to
 *      pass (1) is to make the whole ramp one grey, which would destroy the
 *      hierarchy the ramp exists for.
 *
 * `color-text-prose-muted` is deliberately outside the chain: themes disagree
 * about where it sits (Midnight puts it below `muted`, the warm base above),
 * because it is quiet *prose* rather than a step of chrome. It still has to
 * clear the floor.
 */

/** Tiers that are text. Each one must be readable wherever it lands. */
const INK_TIERS = [
  "color-text",
  "color-text-bright",
  "color-text-label",
  "color-text-muted",
  "color-text-prose-muted",
  "color-text-dim",
  "color-text-placeholder",
] as const;

/** Every surface the app paints text on. */
const GROUND_TOKENS = [
  "color-bg",
  "color-bg-sunken",
  "color-bg-raised",
  "color-bg-inset",
  "color-bg-input",
] as const;

/** Quietest first. A tier must read as a step above the one below it. */
const INK_RAMP = ["color-text-dim", "color-text-muted", "color-text-label", "color-text"] as const;

/**
 * How much of a step. Multiplicative on the contrast ratio, so it means the
 * same thing on a light ground as on a dark one — where a difference in
 * perceived lightness would not.
 */
const RAMP_STEP = 1.12;

/** The three token blocks in `tokens.css`, in source order. */
function cssBlocks(): { name: string; base: "dark" | "light"; tokens: Record<string, string> }[] {
  const mediaAt = TOKENS.indexOf("@media (prefers-color-scheme: light)");
  const explicitAt = TOKENS.indexOf(':root[data-theme="light"]');
  expect({ mediaAt: mediaAt > 0, explicitAt: explicitAt > mediaAt }).toMatchObject({
    mediaAt: true,
    explicitAt: true,
  });
  const named = [
    { name: "tokens.css :root", base: "dark" as const, tokens: {} as Record<string, string> },
    { name: "tokens.css @media light", base: "light" as const, tokens: {} as Record<string, string> },
    { name: "tokens.css [data-theme=light]", base: "light" as const, tokens: {} as Record<string, string> },
  ];
  for (const match of TOKENS.matchAll(/--onsen-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    const at = match.index!;
    const block = named[at < mediaAt ? 0 : at < explicitAt ? 1 : 2]!;
    // First definition wins, the way the cascade reads it.
    if (block.tokens[match[1]!] === undefined) block.tokens[match[1]!] = match[2]!;
  }
  return named;
}

/**
 * What a palette actually resolves to in a browser.
 *
 * A theme names a handful of colours and the rest falls through, in two
 * stages: `completeTokens` derives the ones that follow another
 * (`text-placeholder` follows `text-dim`, `bg-inset` follows `bg-raised`),
 * and whatever is still unnamed comes from the stylesheet block for the
 * theme's base. Measuring the theme's own tokens alone would miss exactly the
 * failures that arrive by inheritance.
 */
function palettes(): { name: string; base: "dark" | "light"; tokens: Record<string, string> }[] {
  const blocks = cssBlocks();
  const darkBase = blocks[0]!.tokens;
  const lightBase = blocks[2]!.tokens;
  return [
    ...blocks,
    ...BUILTIN_THEMES.map((theme) => ({
      name: `theme ${theme.name}`,
      base: theme.base,
      tokens: {
        ...(theme.base === "dark" ? darkBase : lightBase),
        ...completeTokens(theme.tokens),
      },
    })),
  ];
}

describe("ink on its ground", () => {
  test("every palette defines every tier and every ground", () => {
    for (const palette of palettes()) {
      for (const token of [...INK_TIERS, ...GROUND_TOKENS]) {
        const value = palette.tokens[token];
        expect({ palette: palette.name, token, hex: isHex6(value ?? "") }).toMatchObject({
          hex: true,
        });
      }
    }
  });

  test("clears WCAG AA on every surface it can land on", () => {
    for (const palette of palettes()) {
      for (const tier of INK_TIERS) {
        for (const ground of GROUND_TOKENS) {
          const ratio = contrastRatio(palette.tokens[tier]!, palette.tokens[ground]!);
          expect({
            palette: palette.name,
            tier,
            ground,
            measured: ratioLabel(ratio),
            legible: ratio >= AA_CONTRAST,
          }).toMatchObject({ legible: true });
        }
      }
    }
  });

  test("keeps the ramp ordered and separated, so the floor cannot flatten it", () => {
    for (const palette of palettes()) {
      const ground = palette.tokens["color-bg"]!;
      for (const [i, tier] of INK_RAMP.slice(1).entries()) {
        const below = INK_RAMP[i]!;
        const quiet = contrastRatio(palette.tokens[below]!, ground);
        const loud = contrastRatio(palette.tokens[tier]!, ground);
        expect({
          palette: palette.name,
          step: `${below} -> ${tier}`,
          factor: Math.round((loud / quiet) * 100) / 100,
          separated: loud >= quiet * RAMP_STEP,
        }).toMatchObject({ separated: true });
      }
    }
  });
});
