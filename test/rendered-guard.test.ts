import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The rendered-screen guard exists and is reachable (§20 phase 193).
 *
 * `scripts/rendered-guard.ts` drives a real browser and cannot run inside this
 * suite — the suite is hermetic and three minutes long, and the house doctrine
 * is structural, source-as-text, zero DOM rendering. That doctrine is right;
 * the gap it leaves is that nothing in it can see a *composited* colour, which
 * is how `test/surfaces.test.ts` passes while the light theme renders rail
 * metadata at 2.63:1.
 *
 * So this is the small piece that can live here: the guard is wired to a
 * command, and the measurements it takes are named. It stops the guard being
 * deleted, or quietly hollowed out, without anybody noticing.
 */

const GUARD = readFileSync("scripts/rendered-guard.ts", "utf8");
const PACKAGE = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe("the guard is wired up", () => {
  test("there is a command to run it", () => {
    expect(PACKAGE.scripts["guard:rendered"]).toBe("bun run scripts/rendered-guard.ts");
  });

  test("its browser is a devDependency, not a runtime one", () => {
    // `playwright-core` rather than `playwright`: no browser download, and the
    // executable path is supplied. It must never reach the shipped bundle.
    expect(PACKAGE.devDependencies["playwright-core"]).toBeDefined();
    expect((PACKAGE as { dependencies?: Record<string, string> }).dependencies?.["playwright-core"]).toBeUndefined();
  });
});

describe("it still measures what it was written to measure", () => {
  test("every budget is present", () => {
    for (const key of [
      "contrast",
      "fontSizes",
      "controlHeights",
      "gaps",
      "smallTargets",
      "overflowing",
    ]) {
      expect(`${key}: ${GUARD.includes(key + ":")}`).toBe(`${key}: true`);
    }
  });

  test("contrast is sampled from pixels, not from tokens", () => {
    // The entire point. Reading `tokens.css` is what the existing guard does.
    expect(GUARD).toContain("getImageData");
    expect(GUARD).toContain("page.screenshot()");
    expect(GUARD).toContain("contrastRatio");
  });

  test("the AA floor is not quietly lowered", () => {
    expect(GUARD).toMatch(/contrast:\s*4\.5/);
  });

  test("a known failure that gets fixed must be removed from the list", () => {
    // Otherwise KNOWN_CONTRAST becomes a place defects go to be forgotten.
    expect(GUARD).toContain("drop it from KNOWN_CONTRAST");
  });

  test("it walks both widths and both themes", () => {
    expect(GUARD).toContain("1600");
    expect(GUARD).toContain("390");
    expect(GUARD).toMatch(/"dark", "light"/);
  });
});
