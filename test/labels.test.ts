import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { strings } from "../client/strings.ts";
import { DEFAULT_BLOCK_ORDER } from "../shared/types.ts";

/**
 * The app speaks English everywhere a reader can see (§20 phase 190).
 *
 * Three leaks, one cause between them: somewhere a value that belongs to the
 * database, the wire format or a developer's shorthand reached the screen
 * unchanged. Each was a few characters. Together they are most of what a use
 * review called "amateurish", because they are the places a reader notices the
 * seam.
 *
 * Swept rather than listed. The `TOK` pass is the argument for it: reading the
 * files by hand found six string factories, and sweeping the client found five
 * more hardcoded literals in components nobody thought to open.
 */

/** Every client source file, read as text. */
function clientSources(dir = "client"): { path: string; source: string }[] {
  const out: { path: string; source: string }[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...clientSources(path));
    else if (path.endsWith(".ts") || path.endsWith(".tsx")) {
      out.push({ path, source: readFileSync(path, "utf8") });
    }
  }
  return out;
}

/** Source with comments stripped — a sweep should read code, not prose. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const SOURCES = clientSources();

describe("no prompt block shows its database key", () => {
  test("every block in the default order has a human name", () => {
    // Executed, not read as text: the map is the thing under test.
    for (const id of DEFAULT_BLOCK_ORDER) {
      expect(`${id}: ${strings.settings.blockNameFor(id)}`).not.toBe(`${id}: null`);
    }
  });

  test("a name is never an identifier wearing a label", () => {
    // `dialogue_colour` reached the screen exactly like this.
    for (const name of Object.values(strings.settings.blockNames)) {
      expect(name).not.toMatch(/_/);
      expect(name).toMatch(/^[A-Z]/);
    }
  });

  test("the reader stays string-tolerant, because custom blocks are not in the union", () => {
    // A preset's own blocks arrive `custom:`-prefixed. Widening the map to
    // Record<string, string> to allow that is what hid the missing label, so
    // the looseness lives in the reader instead.
    expect(strings.settings.blockNameFor("custom:01ABC")).toBe(null);
  });
});

describe("one casing for one unit", () => {
  test("no client source shouts TOK", () => {
    for (const { path, source } of SOURCES) {
      expect(`${path}: ${/\bTOK\b/.test(codeOf(source))}`).toBe(`${path}: false`);
    }
  });

  test("nor the other all-caps chrome that came with it", () => {
    for (const { path, source } of SOURCES) {
      const code = codeOf(source);
      for (const shouted of ["OF CTX", "BOOK TOTAL", "ENTRIES", "PINNED"]) {
        expect(`${path}/${shouted}: ${code.includes(shouted)}`).toBe(`${path}/${shouted}: false`);
      }
    }
  });

  test("the token unit is spelled one way wherever it is abbreviated", () => {
    const spellings = new Set<string>();
    for (const { source } of SOURCES) {
      for (const m of codeOf(source).matchAll(/\$\{[^}]*\}\s*(tok|TOK|Tok)\b/g)) {
        spellings.add(m[1]!);
      }
    }
    expect([...spellings].sort()).toEqual(["tok"]);
  });
});

describe("controls look like controls", () => {
  test("no box-drawing glyph is the visible content of a button", () => {
    /*
     * The rail toggles were the half-blocks U+258E and U+2595 — labelled and
     * tooltipped the whole time, and still reading as a font fault beside
     * neighbours that are words.
     *
     * Scoped to buttons on purpose, and the first draft was not: swept across
     * the whole client it caught U+258C in `MessageBlock.tsx`, which is the
     * streaming cursor — an `aria-hidden` half-block used as a text caret,
     * which is exactly what that character is for. A guard that cannot tell a
     * caret from a mislabelled control is one that gets weakened the first
     * time it is inconvenient.
     */
    const BUTTON = /<button[\s\S]{0,900}?<\/button>/g;
    const GLYPH = /\\u25[89][0-9a-fA-F]|[▀-▟]/;
    for (const { path, source } of SOURCES) {
      for (const [button] of codeOf(source).matchAll(BUTTON)) {
        expect(`${path}: ${GLYPH.test(button)}`).toBe(`${path}: false`);
      }
    }
  });
});
describe("no wire-format role reaches a reader", () => {
  test("the cast-less placeholder is not named after a chat role", () => {
    const source = readFileSync("server/generation/context.ts", "utf8");
    const block = source.slice(source.indexOf("export const PLACEHOLDER_SPOTLIGHT"));
    expect(block.slice(0, 200)).not.toMatch(/name: "(Assistant|User|System)"/);
  });
});

/**
 * Two controls side by side never read the same (§20 phase 223).
 *
 * The assistant's "Runs on" row renders a hardcoded default, then one button
 * per connection profile. An install whose only profile is *named* Default put
 * two adjacent buttons on screen reading the same word and meaning different
 * things — the app's own routing, and a profile that happens to share the name
 * — with no `aria-label` or `title` to tell them apart either.
 *
 * The same family as this file's other findings: a value that belongs to one
 * layer surfacing where a reader cannot tell which layer they are looking at.
 */
describe("the assistant's routing row", () => {
  test("the app's own default is not just called Default", () => {
    const label = strings.assistant.profileDefault;
    expect(label.toLowerCase()).not.toBe("default");
    // It still has to *say* default, or it stops naming what it is.
    expect(label.toLowerCase()).toContain("default");
  });
});

/**
 * No text on screen is smaller than the scale (§20 phase 223).
 *
 * `.btn` sets its own size from `--onsen-text-button`, and three buttons in the
 * cast rail overrode it inline to 8.5px — the smallest text in the app by
 * 2.5px, in the rail a reader looks at every turn. Phase 194 gave the chrome
 * two owners and swept the literals it knew about; 8.5 was not among them,
 * which is the argument for sweeping rather than listing.
 */
describe("the type scale has no stragglers under it", () => {
  test("no inline font-size in the client is below 11px", () => {
    const offenders: string[] = [];
    for (const { path, source } of SOURCES) {
      const code = codeOf(source);
      for (const match of code.matchAll(/fontSize:\s*"([\d.]+)px"/g)) {
        if (Number(match[1]) < 11) offenders.push(`${path}: ${match[1]}px`);
      }
      for (const match of code.matchAll(/text-\[([\d.]+)px\]/g)) {
        if (Number(match[1]) < 11) offenders.push(`${path}: ${match[1]}px`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
