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
    // The log renders beside the screen (§20 phase 149); the screen wires it.
    const log = readFileSync(join(ROOT, "client", "screens", "chat", "MessageLog.tsx"), "utf8");
    // Comments stripped first, as `reachable-fields` does: this file explains
    // the `isDesktop` mistake in prose, and a guard that reads its own
    // explanation as the defect is a guard that cannot be written about.
    const block = readFileSync(join(ROOT, "client", "components", "MessageBlock.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(block).not.toMatch(/isDesktop/);
    // The actions prop is passed unconditionally, not inside a spread ternary.
    expect(log).toMatch(/\n\s*actions=\{\{/);
  });
});

/**
 * Nothing a thumb has to hit is under the floor (§16 §Density rule 4; the
 * accessibility pass).
 *
 * `.btn`, `.field` and `.row` carried it from the start; everything else was
 * left to count its own padding and reach it by accident. A browser drive at
 * 390×844 with `hasTouch` found nineteen controls under 44px — the entire
 * turn-action row at 32px, every screen's back arrow at 34px, a card row's
 * favourite star at 24px square, the wordmark at 42px, both status-bar
 * handles at 18px. None of them decoration: that row of glyphs is how a turn
 * is rerolled, branched and edited on a phone.
 *
 * The fix was one class, `.tap`, and this pins the two halves of it that a
 * later edit could quietly undo.
 */
describe("a thumb can hit it", () => {
  test(".tap sets the floor, and only a pointer relaxes it", () => {
    // Same polarity as `.row` and `.turn-actions`: the floor is the default,
    // and a device reporting a fine pointer is the exception. A device that
    // reports nothing gets the safe answer.
    expect(APP_CSS).toMatch(/\.tap \{\s*min-height: var\(--onsen-tap-target\);\s*min-width: var\(--onsen-tap-target\);/);
    expect(APP_CSS).toMatch(/@media \(pointer: fine\) \{\s*\.tap \{\s*min-height: 0;/);
  });

  test("the turn's action glyphs are at the floor on touch", () => {
    // 32px for eleven phases, which is the pointer figure, applied to the one
    // row a phone reader uses most.
    expect(APP_CSS).toMatch(
      /\.turn-actions > button \{\s*width: var\(--onsen-tap-target\);\s*height: var\(--onsen-tap-target\);/,
    );
  });

  /**
   * The controls the drive measured short now say so in their class list.
   *
   * Structural rather than rendered — this project runs no DOM tests — so it
   * cannot measure a height. What it can do is stop the class being dropped
   * from the specific controls that were found short, which is the way this
   * regresses: somebody rewrites one button's `className` and the floor goes
   * with it.
   */
  test("every control the drive found short still asks for the floor", () => {
    const short: [string, string][] = [
      ["components/TopBar.tsx", "the wordmark and the writing-elsewhere indicator"],
      ["components/StatusBar.tsx", "the prompt-preview and inspector handles"],
      ["components/QuickReplies.tsx", "the quick-reply chips"],
      ["screens/CharactersScreen.tsx", "a card row's favourite star and action menu"],
      ["screens/ChatScreen.tsx", "the Setup chip and the back arrow"],
      ["screens/AuthorsScreen.tsx", "the back arrow"],
      ["screens/SceneSetupScreen.tsx", "the back arrow"],
      ["screens/LoreScreen.tsx", "the back arrow"],
      ["screens/BackgroundsScreen.tsx", "the back arrow"],
      ["screens/CharacterEditorScreen.tsx", "the back arrow"],
      ["screens/SettingsScreen.tsx", "the provider, profile and key rows"],
    ];
    const missing = short.filter(
      // In a class list, not in the prose above it.
      ([file]) => !/className="[^"]*\btap\b/.test(readFileSync(join(ROOT, "client", file), "utf8")),
    );
    expect(missing.map(([file, what]) => `${file} — ${what}`)).toEqual([]);
  });

  /**
   * One exemption, deliberately.
   *
   * A turn's token count doubles as the handle that opens the prompt inspector
   * (§Density rule 2: "a number behind a tap is a number nobody reads"), and it
   * sits inline in a line of 12px mono. Giving it a 44px box would push the
   * meta line apart to serve the rule that put the number there in the first
   * place. The same action is on the turn's `⋯` sheet and in the palette, both
   * at the floor, so nothing is only reachable through it.
   */
  test("the token-count doorway is left inline on purpose", () => {
    const block = readFileSync(join(ROOT, "client", "components", "MessageBlock.tsx"), "utf8");
    expect(block).toContain('className="meta shrink-0 tabular-nums"');
  });
});
