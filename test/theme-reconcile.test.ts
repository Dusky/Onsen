import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { openDatabase } from "../server/db/index.ts";
import { migrate } from "../server/db/migrate.ts";
import { listThemes, seedBuiltinThemes } from "../server/db/queries/themes.ts";
import { BUILTIN_THEMES } from "../server/themes/builtin.ts";
import { contrastRatio } from "../shared/contrast.ts";

/**
 * A shipped palette reaches an existing install (§20 phase 195).
 *
 * `test/surfaces.test.ts` has measured every builtin theme against WCAG AA
 * since phase 49, and it reads `server/themes/builtin.ts`. The app reads the
 * `themes` table. `seedBuiltinThemes` inserted-and-skipped by name, so the two
 * agreed exactly once — on a fresh database — and diverged from the next
 * correction onwards.
 *
 * The cost was not theoretical. A phase raised Midnight's `text-dim` to
 * `#808891`, a clean 5.04:1 on its own raised ground; the guard passed, and
 * every database seeded before that day kept rendering `#6f7883` at 4.05:1,
 * below the floor, forever. The reported install was one of them.
 *
 * Executed against a real database, because the thing under test is a write.
 */

let db: ReturnType<typeof openDatabase> | null = null;
afterEach(() => {
  db?.close();
  db = null;
});

function seeded(): ReturnType<typeof openDatabase> {
  db = openDatabase(":memory:");
  migrate(db);
  seedBuiltinThemes(db);
  return db;
}

describe("a corrected palette reaches an install that already exists", () => {
  test("a stale builtin is brought up to what ships", () => {
    const database = seeded();
    const before = listThemes(database).find((t) => t.name === "Midnight")!;

    // Age it, exactly as a pre-correction install holds it. `listThemes`
    // returns rows, so `tokens` is the stored JSON string.
    const stale = {
      ...(JSON.parse(before.tokens) as Record<string, string>),
      "color-text-dim": "#6f7883",
    };
    database
      .query("UPDATE themes SET tokens = $tokens WHERE name = 'Midnight'")
      .run({ tokens: JSON.stringify(stale) });

    seedBuiltinThemes(database);

    const after = listThemes(database).find((t) => t.name === "Midnight")!;
    const shipped = BUILTIN_THEMES.find((t) => t.name === "Midnight")!;
    expect((JSON.parse(after.tokens) as Record<string, string>)["color-text-dim"]).toBe(
      (shipped.tokens as Record<string, string>)["color-text-dim"]!,
    );
  });

  test("re-seeding adds nothing and duplicates nothing", () => {
    const database = seeded();
    const first = listThemes(database).length;
    expect(seedBuiltinThemes(database)).toBe(0);
    expect(listThemes(database).length).toBe(first);
  });

  test("a custom theme is never touched", () => {
    const database = seeded();
    database
      .query(
        `INSERT INTO themes (ulid, name, base, tokens, custom_css, custom_css_pending,
           is_builtin, created_at, updated_at)
         VALUES ('01TESTTESTTESTTESTTESTTEST', 'Mine', 'dark', $tokens, '', '', 0, 1, 1)`,
      )
      .run({ tokens: JSON.stringify({ "color-text-dim": "#123456" }) });

    seedBuiltinThemes(database);

    const mine = listThemes(database).find((t) => t.name === "Mine")!;
    expect((JSON.parse(mine.tokens) as Record<string, string>)["color-text-dim"]).toBe("#123456");
  });

  test("a reader's custom CSS on a builtin survives the reconcile", () => {
    const database = seeded();
    database.query("UPDATE themes SET custom_css = $css WHERE name = 'Midnight'").run({
      css: ".meta { letter-spacing: 0.02em; }",
    });
    seedBuiltinThemes(database);
    const after = listThemes(database).find((t) => t.name === "Midnight")!;
    expect(after.custom_css).toBe(".meta { letter-spacing: 0.02em; }");
  });
});

describe("the quiet tiers have room for the app's own translucency", () => {
  /*
   * AA on a flat token is not AA on the screen. Every chrome surface goes
   * translucent when a background is showing (`app.css`), so a tier that
   * clears 4.5:1 by a hundredth clears nothing once a photograph is behind it:
   * the light themes measured 4.58:1 flat and rendered at 2.63:1 and 4.49:1.
   *
   * A margin, not a new floor. `scripts/rendered-guard.ts` measures the real
   * thing; this keeps a palette from being authored with no room for it.
   */
  const HEADROOM = 4.8;

  test("every builtin's dim tier clears AA with margin on every ground", () => {
    /*
     * The grounds the rails and the log actually paint on. `color-bg-inset` is
     * left to `test/surfaces.test.ts`'s plain AA: it is the most translucent
     * surface of the four (50%), every shipped theme sits at 4.55–4.60:1 on
     * it, and re-tuning eight palettes' insets is a design pass rather than a
     * contrast fix. Named here so it is a known edge rather than an oversight.
     */
    const grounds = ["color-bg", "color-bg-sunken", "color-bg-raised"];
    for (const theme of BUILTIN_THEMES) {
      const tokens = theme.tokens as Record<string, string>;
      const dim = tokens["color-text-dim"];
      if (dim === undefined) continue;
      for (const ground of grounds) {
        const value = tokens[ground];
        if (value === undefined) continue;
        const ratio = contrastRatio(dim, value);
        expect({
          theme: theme.name,
          ground,
          measured: `${ratio.toFixed(2)}:1`,
          clears: ratio >= HEADROOM,
        }).toMatchObject({ clears: true });
      }
    }
  });
});

/**
 * Nothing the rendered guard carries is carried quietly (§20 phase 222).
 *
 * This asserted one thing until phase 222: that `KNOWN_CONTRAST` was the empty
 * array phase 195 left it as. The reasoning was right for the mechanism of the
 * day — an entry was a *blanket pass*, so parking a defect there removed it
 * from the ratchet entirely and the only safe number of entries was zero.
 *
 * Phase 222 changed the mechanism, so this changes with it, and the change is
 * recorded rather than quiet because weakening a guard to let your own work
 * through is the thing this file exists to prevent. An entry is now a
 * **recorded floor with a reason**: a reading below it still fails, an entry
 * that starts passing fails until it is deleted, one that improves fails until
 * its floor is lowered, and one that stops being measured fails too. Nothing
 * is hidden; a deferral is visible in the guard's own output as a KNOWN line
 * with its number.
 *
 * So the rule this keeps is the one that mattered — no defect is parked
 * without being visible, bounded and scheduled — expressed against the shape
 * the list now has.
 */
describe("the rendered guard carries nothing quietly", () => {
  const guard = readFileSync("scripts/rendered-guard.ts", "utf8");

  /** Every entry, as `[label, floor]`. */
  function known(): [string, number][] {
    const block = /const KNOWN_CONTRAST[^=]*=\s*\{([\s\S]*?)\n\};/.exec(guard);
    if (block === null) return [];
    return [...block[1]!.matchAll(/"([^"]+)":\s*\{\s*floor:\s*([\d.]+)/g)].map((m) => [
      m[1]!,
      Number(m[2]),
    ]);
  }

  test("an entry is a floor with a reason, never a blanket pass", () => {
    // The shape is the safety. A bare string list would be the old mechanism
    // back, and a floor with no `why` is a number nobody can act on.
    expect(guard).not.toMatch(/KNOWN_CONTRAST:\s*readonly string\[\]/);
    const entries = [...guard.matchAll(/"[^"]+":\s*\{\s*floor:\s*[\d.]+,\s*why:\s*"/g)];
    expect(entries.length).toBe(known().length);
  });

  test("every floor is a real shortfall, under AA", () => {
    // An entry at or above the floor is not a known failure, it is noise —
    // and the guard itself fails on one, so this is the same rule read twice.
    const wrong = known().filter(([, floor]) => floor >= 4.5);
    expect(wrong).toEqual([]);
  });

  test("the list is bounded, so it cannot grow a defect at a time", () => {
    /*
     * **Zero** since §20 phase 230, which is the shape a list like this should
     * spend most of its life in. It was four — what phase 222 measured when the
     * guard could first see: three ink tokens on translucent panels, across two
     * viewports and two themes — and the ink pass cleared all four.
     *
     * A ceiling rather than a target, and it came down with the work rather
     * than staying at four as slack. An entry now means somebody deferred
     * something without this conversation.
     */
    expect(known().length).toBeLessThanOrEqual(0);
  });

  test("and each one is written down where the next person looks", () => {
    // The original rule's actual demand: "deferred out loud rather than by a
    // passing command". `PHASES.md` is out loud.
    const phases = readFileSync("docs/PHASES.md", "utf8");
    if (known().length > 0) expect(phases).toContain("KNOWN_CONTRAST");
  });
});
