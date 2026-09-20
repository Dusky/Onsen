import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  AA_CONTRAST,
  channels,
  contrastRatio,
  distance,
  isHex6,
  readableOn,
  relativeLuminance,
} from "../shared/contrast.ts";
import { BUILTIN_THEMES } from "../server/themes/builtin.ts";
import { CAST_PALETTE } from "../server/db/queries/authors.ts";
import { PAINT_FLOOR, proseGround, resolveCastColours } from "../client/lib/speaker-colour.ts";
import type { SceneMemberDto } from "../shared/types.ts";

/**
 * A speaker's colour is legible wherever it is painted (§20 phase 220).
 *
 * The defect, measured on composited pixels at 1600×950 in the light theme:
 * coloured dialogue at **2.07:1, 1.99:1 and 2.34:1** against AA's 4.5:1, with
 * the name and spine failing the same way since phase 185. Phase 218 put the
 * colour on the spoken words, which is what made a fifth of the prose on screen
 * illegible instead of just a label.
 *
 * The fix is not a better palette, because there is no such palette. To clear
 * 4.5:1 against `#e5eaee` a colour needs relative luminance at or below 0.143;
 * against `#0a0d18` it needs 0.194 or above. The windows do not overlap, so
 * **no single stored hex is legible in both theme bases** — the first test
 * below states that as arithmetic so nobody tries again.
 *
 * What is guarded instead is the *resolved* colour, which is what a reader
 * actually sees, against every ground every shipped theme defines. The stored
 * hex stays the reader's own.
 */

const GROUND_KEYS = ["color-bg", "color-bg-raised", "color-bg-sunken", "color-bg-inset"] as const;

/** Every ground a shipped theme paints text on, as `{theme, key, hex}`. */
function grounds(): { theme: string; key: string; hex: string }[] {
  const out: { theme: string; key: string; hex: string }[] = [];
  for (const theme of BUILTIN_THEMES) {
    for (const key of GROUND_KEYS) {
      const hex = (theme.tokens as Record<string, string | undefined>)[key];
      // A theme names only what it changes; the rest falls through to
      // `tokens.css`, and a ground it does not define is one it does not own.
      if (hex !== undefined && isHex6(hex)) out.push({ theme: theme.name, key, hex });
    }
  }
  return out;
}

describe("one stored colour cannot serve both theme bases", () => {
  test("the luminance windows do not overlap, which is why resolving exists", () => {
    const lightest = grounds().reduce((a, b) =>
      relativeLuminance(a.hex) > relativeLuminance(b.hex) ? a : b,
    );
    const darkest = grounds().reduce((a, b) =>
      relativeLuminance(a.hex) < relativeLuminance(b.hex) ? a : b,
    );

    // The most luminous a colour may be to clear the floor on the lightest
    // ground, and the least it may be on the darkest.
    const ceiling = (relativeLuminance(lightest.hex) + 0.05) / AA_CONTRAST - 0.05;
    const floor = AA_CONTRAST * (relativeLuminance(darkest.hex) + 0.05) - 0.05;

    expect(ceiling).toBeLessThan(floor);
  });
});

describe("every palette colour, resolved, clears the floor everywhere", () => {
  test("on every ground of every shipped theme", () => {
    const failures: string[] = [];
    for (const ground of grounds()) {
      for (const colour of CAST_PALETTE) {
        const painted = readableOn(colour, ground.hex);
        const ratio = contrastRatio(painted, ground.hex);
        if (ratio < AA_CONTRAST) {
          failures.push(
            `${colour} -> ${painted} on ${ground.theme}/${ground.key} ${ratio.toFixed(2)}:1`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  test("and the eight stay tellable apart after resolving", () => {
    /*
     * The point of eight colours is that a cast of eight reads as eight
     * voices. Deepening them all toward black could collapse them into one
     * dark smudge, which would trade one defect for another — so the spread is
     * asserted, not assumed.
     *
     * 20 in straight RGB distance is about the step at which two swatches stop
     * being the same colour at a glance. The stored palette's own tightest pair
     * is 28, so this allows some compression and no more.
     */
    for (const ground of grounds()) {
      const painted = CAST_PALETTE.map((colour) => readableOn(colour, ground.hex));
      let closest = Infinity;
      let pair = "";
      for (let i = 0; i < painted.length; i++) {
        for (let j = i + 1; j < painted.length; j++) {
          const apart = distance(painted[i]!, painted[j]!);
          if (apart < closest) {
            closest = apart;
            pair = `${painted[i]} / ${painted[j]}`;
          }
        }
      }
      expect({ ground: `${ground.theme}/${ground.key}`, closest: closest >= 20, pair }).toEqual({
        ground: `${ground.theme}/${ground.key}`,
        closest: true,
        pair,
      });
    }
  });

  test("a dark theme moves nothing, because it never failed", () => {
    // The app's default is dark and the palette was chosen against it, which is
    // exactly why this went unnoticed. A fix that repainted the case that
    // already worked would be a regression dressed as a repair.
    const midnight = BUILTIN_THEMES.find((theme) => theme.name === "Midnight")!;
    const ground = (midnight.tokens as Record<string, string>)["color-bg"]!;
    for (const colour of CAST_PALETTE) {
      expect(readableOn(colour, ground)).toBe(colour);
    }
  });
});

describe("readableOn", () => {
  test("leaves a colour that already passes exactly alone", () => {
    expect(readableOn("#ffffff", "#000000")).toBe("#ffffff");
    expect(readableOn("#c77ba9", "#0e0f11")).toBe("#c77ba9");
  });

  test("clears the floor for hostile inputs, including ones with no headroom", () => {
    const hostile: [string, string][] = [
      ["#ffffff", "#ffffff"],
      ["#eeeeee", "#f1f1f1"],
      ["#ffff00", "#fafafa"],
      ["#000000", "#0e0f11"],
      // The ground that looks hopeless: mid grey, where both black and white
      // are near the floor and neither is under it.
      ["#808080", "#808080"],
      ["#767676", "#767676"],
    ];
    for (const [colour, ground] of hostile) {
      const painted = readableOn(colour, ground);
      expect({ colour, ground, ok: contrastRatio(painted, ground) >= AA_CONTRAST }).toEqual({
        colour,
        ground,
        ok: true,
      });
    }
  });

  test("moves as little as it can, and no further", () => {
    // The nearest legible version, not a safe default: a reader who picked a
    // colour should get their colour wherever the floor allows it.
    const ground = "#f1f1f1";
    const painted = readableOn("#c77ba9", ground);
    expect(contrastRatio(painted, ground)).toBeGreaterThanOrEqual(AA_CONTRAST);
    // One channel step back toward the original drops below the floor, which is
    // what "as little as it can" means.
    const [r, g, b] = channels(painted);
    const nudged = `#${[r + 2, g + 2, b + 2]
      .map((v) => Math.min(255, v).toString(16).padStart(2, "0"))
      .join("")}`;
    expect(contrastRatio(nudged, ground)).toBeLessThan(AA_CONTRAST);
  });

  test("returns the input unchanged when either end is not a colour it reads", () => {
    // `color-mix()` and gradients reach this module as themselves; the header
    // says callers filter them out, and this is the behaviour if one slips.
    expect(readableOn("color-mix(in oklab, red, blue)", "#f1f1f1")).toBe(
      "color-mix(in oklab, red, blue)",
    );
    expect(readableOn("#c77ba9", "var(--nope)")).toBe("#c77ba9");
  });

  test("a floor it cannot reach gets the most legible thing available", () => {
    // 7:1 on a mid-grey ground is impossible — the best any colour can do is
    // about 4.6:1 — so it answers with the end rather than a colour that
    // silently fails.
    const painted = readableOn("#808080", "#767676", 7);
    expect(["#000000", "#ffffff"]).toContain(painted);
  });
});

describe("the palette and its backfill migration agree", () => {
  test("migration 0081 wrote exactly the colours the live palette hands out", () => {
    /*
     * The palette is in two places and the migration's own comment asks a human
     * to "keep the two in step" — which is the kind of request that gets
     * honoured until it does not. A migration is frozen history and must not be
     * edited, so the guard is the other direction: the live palette must still
     * be what 0081 actually wrote, and parting from it is a new migration's job
     * rather than a quiet edit.
     */
    const sql = readFileSync("server/db/migrations/0081_character_colour_backfill.sql", "utf8");
    const written = [...sql.matchAll(/'(#[0-9a-f]{6})'/g)].map((m) => m[1]!);
    expect(written).toEqual([...CAST_PALETTE]);
  });
});

describe("the client resolves once, for every surface at once", () => {
  const member = (characterId: string, colour: string | null) =>
    ({ characterId, colour }) as unknown as SceneMemberDto;

  test("the floor it paints at is above AA, because the token is not the ground", () => {
    /*
     * Prose sits on a translucent panel over the reader's photograph, so the
     * composited pixel is not the token any theme names. Resolving to exactly
     * 4.5:1 against the token landed at 4.07:1 and 3.99:1 on screen — measured,
     * after the first version of this shipped. The headroom is the answer, and
     * it has to stay above AA or the measurement comes back.
     */
    expect(PAINT_FLOOR).toBeGreaterThan(AA_CONTRAST);
  });

  test("a colourless member is absent rather than present-and-null", () => {
    const resolved = resolveCastColours(
      [member("a", null), member("b", "#c77ba9")],
      "#f1f1f1",
    );
    expect(resolved.has("a")).toBe(false);
    expect(resolved.get("b")).toBeDefined();
  });

  test("every member clears the painting floor against the ground", () => {
    const ground = "#f1f1f1";
    const cast = CAST_PALETTE.map((colour, at) => member(`c${at}`, colour));
    for (const [id, painted] of resolveCastColours(cast, ground)) {
      expect({ id, ok: contrastRatio(painted, ground) >= PAINT_FLOOR }).toEqual({ id, ok: true });
    }
  });

  test("with no ground to read, the stored colour is passed through untouched", () => {
    // Server-rendered, or a theme naming no ground at all. Painting the
    // reader's own choice is the right failure: it is what shipped before, and
    // it is never worse than refusing to paint.
    const resolved = resolveCastColours([member("a", "#c77ba9")], null);
    expect(resolved.get("a")).toBe("#c77ba9");
    expect(proseGround()).toBeNull();
  });

  test("resolving is idempotent — painting a painted colour changes nothing", () => {
    // The map is rebuilt on every cast change, so a second pass over an
    // already-resolved value must not walk it further into black.
    const ground = "#e5eaee";
    const once = resolveCastColours([member("a", "#c77ba9")], ground).get("a")!;
    const twice = resolveCastColours([member("a", once)], ground).get("a")!;
    expect(twice).toBe(once);
  });
});
