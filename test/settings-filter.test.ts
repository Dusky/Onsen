import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CATEGORIES } from "../client/screens/settings-categories.ts";
import { strings } from "../client/strings.ts";

/**
 * Settings tells the truth about what it is showing (§20 phase 226).
 *
 * Three reproductions from the fourth review, and a fourth the sweep below
 * found on its own.
 *
 * 1. Typing `zzzznomatch` printed "Nothing here matches that." above a fully
 *    rendered Models panel — Providers, Profiles, Anthropic and the account
 *    buttons, all still on screen under a line saying there was nothing. The
 *    tab row narrowed; the body did not.
 * 2. Change password and Sign out were not "filed under Models", which is what
 *    it looked like: they sat *outside every* `show()` call, so they were the
 *    last two controls of every category, including the empty one.
 * 3. `picture` matched two drawers, and so did `api key`.
 * 4. And so did `import`, which nobody had looked for — which is the argument
 *    for the sweep rather than three assertions.
 */

const SCREEN = readFileSync("client/screens/SettingsScreen.tsx", "utf8");

/** What the filter compares a reader's typing against, per category. */
function haystack(entry: (typeof CATEGORIES)[number]): string[] {
  const label = strings.settings.categories[entry.id] ?? entry.id;
  return [label.toLowerCase(), ...entry.words.map((word) => word.toLowerCase())];
}

/** Which categories a needle survives to, by the screen's own rule. */
function matches(needle: string): string[] {
  return CATEGORIES.filter((entry) =>
    haystack(entry).some((candidate) => candidate.includes(needle)),
  ).map((entry) => entry.id);
}

describe("no search term reaches two drawers", () => {
  test("every word in the table lands in exactly one category", () => {
    /*
     * The sweep. Each word is typed as a reader would type it and has to come
     * back with one answer. Three collisions were known when this was written
     * and the fourth — Background's `picture` against the *name* "Pictures &
     * voices" — is the one that says why this is a sweep: the filter matches
     * names as well as words, so a word list can collide with something that
     * is not a word list.
     */
    const ambiguous: string[] = [];
    for (const entry of CATEGORIES) {
      for (const word of entry.words) {
        const found = matches(word.toLowerCase());
        if (found.length > 1) ambiguous.push(`${word} → ${found.join(", ")}`);
      }
    }
    expect(ambiguous).toEqual([]);
  });

  test("and so does every word of every category's own name", () => {
    // A reader who remembers a drawer's name types the drawer's name. "Models"
    // and "Moving in" must not both answer to one of them.
    const ambiguous: string[] = [];
    for (const entry of CATEGORIES) {
      const label = strings.settings.categories[entry.id] ?? entry.id;
      for (const part of label.toLowerCase().split(/[^a-z]+/).filter((p) => p.length > 3)) {
        const found = matches(part);
        if (found.length > 1) ambiguous.push(`${part} (from "${label}") → ${found.join(", ")}`);
      }
    }
    expect(ambiguous).toEqual([]);
  });

  test("every category has a name of its own", () => {
    const unnamed = CATEGORIES.filter(
      (entry) => (strings.settings.categories[entry.id] ?? "") === "",
    ).map((entry) => entry.id);
    expect(unnamed).toEqual([]);
  });
});

describe("nothing matching shows nothing", () => {
  test("the body is gated on there being a match at all, not just on the active id", () => {
    /*
     * The defect was `show = (id) => id === active`, where `active` falls back
     * to the *current* category when nothing survives — correct for keeping a
     * category open, and the reason the panel stayed rendered under a line
     * saying it was empty.
     */
    expect(SCREEN).toContain("const show = (id: CategoryId) => matching.length > 0 && id === active;");
  });

  test("the empty state is the only thing that renders in that case", () => {
    // Every pane goes through `show(...)`. A pane rendered outside it is the
    // bug this phase fixed, in a new place.
    const panes = [...SCREEN.matchAll(/\{show\("(\w+)"\)/g)].map((m) => m[1]!);
    expect(new Set(panes).size).toBe(panes.length);
    // Every category the table names, except the one a desktop hides.
    for (const entry of CATEGORIES) {
      expect({ id: entry.id, gated: panes.includes(entry.id) }).toEqual({
        id: entry.id,
        gated: true,
      });
    }
  });
});

describe("the account actions have a home", () => {
  test("they are inside a category, not beneath every one", () => {
    const account = SCREEN.indexOf('{show("account")');
    expect(account).toBeGreaterThan(-1);
    for (const marker of ["strings.settings.changePassword", "strings.settings.signOut"]) {
      // Every occurrence in the panel body is after the gate that owns them.
      // (`PasswordSheet`'s own title is above it and is the sheet, not a row.)
      const inBody = SCREEN.lastIndexOf(marker);
      expect({ marker, afterGate: inBody > account }).toEqual({ marker, afterGate: true });
    }
  });

  test("the bigger hammer says so in its name, not in a paragraph above it", () => {
    /*
     * Changing the password is the only revocation this install has: it bumps
     * a generation counter every outstanding cookie is checked against, so it
     * signs out every other device. A reader in Account needs that before they
     * click, and this started as an explanatory line above the two buttons —
     * which `test/voice.test.ts` failed, correctly. A name carries it and a
     * paragraph only explains it.
     */
    expect(strings.settings.changePasswordAction).toMatch(/other devices/);
    expect(SCREEN).toContain("strings.settings.changePasswordAction");
    // And the sheet keeps the short title, because a dialog heading is a name
    // for what is inside it rather than for what pressing it did.
    expect(strings.settings.changePassword).toBe("Change password");
  });
});
