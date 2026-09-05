import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Density is a feature, and it is a distribution (SPEC §16 §Density, §20 phase
 * 55).
 *
 * The design handoff said "the default view of every screen is clean… when in
 * doubt, hide it". That sentence was written in a design session rather than
 * briefed, it was wrong about the audience — the installs this replaces run
 * 139 chats and an eighteen-block prompt — and six phases were built against
 * it before anybody said so. `docs/PHASES.md` carries the amendment.
 *
 * Measured rather than reviewed for the same reason `surfaces.test.ts` is: no
 * screenshot pass catches a rule that holds on every screen individually and
 * fails across the set.
 */

const ROOT = join(import.meta.dir, "..");
const TOKENS = readFileSync(join(ROOT, "client", "styles", "tokens.css"), "utf8");
const APP_CSS = readFileSync(join(ROOT, "client", "styles", "app.css"), "utf8");

describe("the reader owns the reading surface", () => {
  /**
   * Every prose size multiplies by the reader's scale.
   *
   * A prose token that forgets the factor is a control that silently does not
   * reach part of the app — and silently is the operative word: the setting
   * still moves, the text still resizes, and one paragraph somewhere stays
   * where it was. That is not something a screenshot review finds.
   */
  test("every prose size scales", () => {
    const unscaled = [...TOKENS.matchAll(/^\s*(--onsen-text-prose[\w-]*|--onsen-text-field|--onsen-text-explain):\s*([^;]+);/gm)]
      .filter((match) => !match[2]!.includes("--onsen-prose-scale"))
      .map((match) => match[1]!);
    expect(unscaled).toEqual([]);
  });

  /**
   * The three reader-owned properties are not frozen literals.
   *
   * `--onsen-prose-scale` shipped as a hardcoded `1` for ten phases and was
   * deferred out of three of them. This asserts the wiring exists, so a later
   * phase cannot quietly re-freeze it: the token file may define a default, but
   * something has to set it at runtime.
   */
  test("scale, measure and leading are set at runtime", () => {
    const viewport = readFileSync(join(ROOT, "client", "lib", "viewport.ts"), "utf8");
    for (const property of ["--onsen-prose-scale", "--onsen-prose-measure", "--onsen-leading-prose"]) {
      expect(viewport).toContain(property);
    }
  });
});

describe("rows scale with the input device", () => {
  /**
   * 44px is a thumb rule, not a taste. A pointer gets a tighter row, and the
   * same install is often both, so it is a media query.
   */
  test("a pointer gets a denser row", () => {
    expect(APP_CSS).toMatch(/@media \(pointer: fine\)/);
  });

  /**
   * List rows go through `.row` rather than hand-rolling their padding.
   *
   * A screen that writes its own `py-[15px]` opts out of the density rule
   * without saying so — which is exactly how the app ended up uniformly airy.
   * The ceiling is deliberately loose: it catches a *list row*, not the
   * generous padding a piece of prose or a panel legitimately wants.
   */
  test("no list row hand-rolls padding above the touch budget", () => {
    const screens = join(ROOT, "client", "screens");
    const offenders: string[] = [];
    for (const file of new Bun.Glob("*.tsx").scanSync({ cwd: screens })) {
      const source = readFileSync(join(screens, file), "utf8");
      for (const match of source.matchAll(/className="([^"]*border-b border-rule[^"]*)"/g)) {
        const cls = match[1]!;
        const padding = /py-\[(\d+)px\]/.exec(cls);
        if (padding !== null && Number(padding[1]) > 12) offenders.push(`${file}: ${cls}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("every turn command is reachable", () => {
  /**
   * The defect this phase removed: fifteen turn-scoped commands, three of them
   * on screen, behind a hover passed only when the window was desktop-width.
   * On a phone the other twelve were reachable by a long-press nobody is told
   * about.
   *
   * Reachability here means one of two things, and both count: the turn's own
   * action row names it, or the palette sheet the row's `…` opens carries it.
   * The row deliberately shows a handful — the sheet is the full list — so this
   * asserts nothing is stranded, not that everything is inline.
   */
  test("no turn-scoped command is stranded", () => {
    const commands = readFileSync(join(ROOT, "client", "lib", "commands.ts"), "utf8");
    const chat = readFileSync(join(ROOT, "client", "screens", "ChatScreen.tsx"), "utf8");
    const ids = [...commands.matchAll(/\{ id: "([\w-]+)",[^}]*scope: "turn"/g)].map((m) => m[1]!);
    expect(ids.length).toBeGreaterThan(10);
    // `runCommand`'s handler map is the one place a turn command is executed;
    // the row and the palette both go through it.
    const stranded = ids.filter((id) => !new RegExp(`"${id}":`).test(chat));
    expect(stranded).toEqual([]);
  });

  /**
   * The action row is not conditional on a breakpoint.
   *
   * One `isDesktop` hid twelve commands from every phone for six phases, and
   * nothing caught it because each half looked correct: the component took the
   * prop it was given, and the screen passed a prop conditionally.
   */
  test("the turn's actions are not gated on a width", () => {
    const chat = readFileSync(join(ROOT, "client", "screens", "ChatScreen.tsx"), "utf8");
    // Comments stripped first, as `reachable-fields` does: this file explains
    // the `isDesktop` mistake in prose, and a guard that reads its own
    // explanation as the defect is a guard that cannot be written about.
    const block = readFileSync(join(ROOT, "client", "components", "MessageBlock.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(block).not.toMatch(/isDesktop/);
    // The actions prop is passed unconditionally, not inside a spread ternary.
    expect(chat).toMatch(/\n\s*actions=\{\{/);
  });
});
