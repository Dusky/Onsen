import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

const ROOT = join(import.meta.dir, "..");
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
      "touchTargets",
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

/**
 * And it measures the whole app, not the part that happened to be reachable
 * (§20 phase 222).
 *
 * As shipped, the scene route and *every contrast sample* were gated on an
 * `ONSEN_SCENE` environment variable nobody set. Run the documented way,
 * `bun run guard:rendered` printed "all within budget" having measured no
 * transcript and no colour — and said so in a parenthesis at the bottom of a
 * wall of `ok` lines. A guard doing the thing it exists to catch.
 *
 * These assertions are the ones that would have failed then.
 */
describe("the guard cannot pass by measuring nothing", () => {
  test("the scene is discovered from the app, not read from the environment", () => {
    // The header still names it, which is the point — the gate is described
    // as the defect it was. What must be gone is the *read*, so this matches
    // an assignment rather than the word.
    expect(GUARD).not.toMatch(/=\s*process\.env\["ONSEN_SCENE"\]/);
    expect(GUARD).toContain("async function firstScene");
    expect(GUARD).toContain("/api/scenes?limit=");
  });

  test("a run that measured no transcript is a failure, not a note", () => {
    expect(GUARD).toContain("sceneRoutesMeasured === 0");
    expect(GUARD).toContain("no transcript was measured");
  });

  test("a sample that matches nothing fails rather than being skipped", () => {
    // The silent no-match is how the gate above survived: it reported its own
    // silence and exited zero.
    expect(GUARD).toContain("sample matched nothing");
    expect(GUARD).toMatch(/failures\.push\(\.\.\.missing\.map/);
  });

  test("samples are selectors, not coordinates", () => {
    // Four hardcoded rectangles were only ever valid at one viewport with the
    // rails in one state, and measured whatever was at those coordinates.
    expect(GUARD).not.toMatch(/\{\s*name:\s*"[^"]+",\s*x:\s*\d+,\s*y:\s*\d+/);
    expect(GUARD).toContain('selector: "[data-prose]"');
    expect(GUARD).toContain('selector: "[data-rail] .section-label"');
  });
});

describe("the DOM contract the selectors rely on", () => {
  /*
   * Both ends, in one place. A guard that matches on Tailwind classes is
   * guessing, and a guess that stops matching is silent — so the components
   * carry an attribute and this is what keeps them carrying it.
   */
  test("the prose paragraphs are marked", () => {
    const block = readFileSync(join(ROOT, "client", "components", "MessageBlock.tsx"), "utf8");
    expect([...block.matchAll(/data-prose/g)].length).toBeGreaterThanOrEqual(3);
  });

  test("both rails are marked, open and collapsed", () => {
    const left = readFileSync(join(ROOT, "client", "components", "LeftRail.tsx"), "utf8");
    const right = readFileSync(join(ROOT, "client", "components", "RightRail.tsx"), "utf8");
    // Two each: the icon strip and the open panel are different elements, and
    // measuring only one of them is measuring half the rail.
    expect([...left.matchAll(/data-rail="left"/g)].length).toBe(2);
    expect([...right.matchAll(/data-rail="right"/g)].length).toBe(2);
  });
});

describe("the probes this review built by hand now live here", () => {
  test("controls with no accessible name are counted, with a floor of zero", () => {
    // The one budget that is not a ratchet on an excess: a control a screen
    // reader announces as "edit, blank" has no acceptable quantity.
    expect(GUARD).toMatch(/unlabelled:\s*0/);
    expect(GUARD).toContain("controls with no accessible name");
  });

  /**
   * The 44px floor is swept, not listed (§20 phase 229).
   *
   * `test/density.test.ts` held it with an allow-list of named files and
   * passed while eleven controls sat between 18px and 33px on a phone. Three
   * properties make the replacement a sweep rather than a longer list, and
   * each one is a thing a later edit could quietly take back.
   */
  describe("the thumb floor", () => {
    test("it is measured on the touch viewport only, at zero", () => {
      // `.tap` relaxes under `(pointer: fine)` on purpose, so counting a
      // desktop's 28px row would be counting the rule working.
      expect(GUARD).toMatch(/touchTargets:\s*0/);
      expect(GUARD).toContain("controls under the 44px thumb floor");
      expect(GUARD).toContain("if (touch) for (const control of probe.short)");
    });

    test("a short control is reported with where it is", () => {
      // "Seven controls are short" is a number; "the trackers strip is 24px"
      // is a defect somebody can fix.
      expect(GUARD).toContain("short: ");
      expect(GUARD).toContain("aria-label");
    });

    /**
     * Keyed by class, not by name.
     *
     * The name carries a roleplay's own title — "Favourite: The Last Inn" —
     * so a budget keyed on it moves when somebody adds a roleplay, and a
     * budget that moves when you add data is a budget that gets deleted.
     */
    test("the count does not move when the install's data does", () => {
      expect(GUARD).toContain("el.className || el.tagName");
      expect(GUARD).toContain("shortTargets.has(control.key)");
    });

    /**
     * The exemptions are a named list, not a slack number.
     *
     * Same contract as `KNOWN_CONTRAST`: an entry that stops matching fails
     * the run until it is deleted. A budget of "2" would let a third control
     * take a fixed one's place in silence, which is the allow-list failure
     * this whole phase was written about.
     */
    test("an exemption that stops applying fails the run", () => {
      expect(GUARD).toContain("EXEMPT_TARGETS");
      expect(GUARD).toContain("drop it from EXEMPT_TARGETS");
      // Counted against zero, not against the size of the list.
      expect(GUARD).toContain("offenders.size, BUDGET.touchTargets");
    });

    /**
     * A skip link is not a small target.
     *
     * `sr-only` is 1×1 with `clip-path: inset(50%)` until it is focused. The
     * first version of this counted one on every route of every viewport of
     * every theme — sixteen "small targets" that are not targets at all, and
     * more than half of what `smallTargets` was recording.
     */
    test("a control clipped to a pixel is not counted as a small one", () => {
      expect(GUARD).toContain("isOffscreen");
      expect(GUARD).toMatch(/cs\.clip !== "auto" \|\| cs\.clipPath !== "none"/);
      // Both budgets, not just the new one.
      expect(GUARD).toContain("el.closest(\"p\") === null && !offscreen");
    });
  });

  test("the rails' share of a screen is measured by the marker, not by geometry", () => {
    /*
     * A first pass counted everything left of x=390 and read 78% on a screen
     * whose rails were both collapsed — the roleplay list starts at x=54 once
     * they are. Measuring "the rails" by where they usually sit is the same
     * mistake as the rectangles above.
     */
    expect(GUARD).toContain('el.closest("[data-rail]")');
    expect(GUARD).not.toContain("railEdge");
  });
});
