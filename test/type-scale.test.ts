import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The chrome type sizes have one owner each (§20 phase 194).
 *
 * `tokens.css` has named, documented, considered sizes — and components copied
 * the *numbers* out of it instead of referencing them. 151 `text-[12.5px]`
 * literals and 52 `text-[13.5px]` against tokens that only `.btn` and one
 * heading rule actually read. The tokens looked load-bearing and were not:
 * changing `--onsen-text-button` would have moved the buttons and left two
 * hundred elements at the old size.
 *
 * That is the defect this guards, and it is not "too many distinct sizes".
 * Fourteen sizes with one owner each is a design; fourteen sizes with two
 * hundred owners is a coincidence.
 */

const TOKENS = readFileSync("client/styles/tokens.css", "utf8");
const APP_CSS = readFileSync("client/styles/app.css", "utf8");

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

const SOURCES = clientSources();

describe("a size a token names is never written as a number", () => {
  test("no component spells the chrome sizes out", () => {
    for (const { path, source } of SOURCES) {
      for (const literal of ["text-[12.5px]", "text-[13.5px]"]) {
        expect(`${path} ${literal}: ${source.includes(literal)}`).toBe(`${path} ${literal}: false`);
      }
    }
  });

  test("nor does a stylesheet rule", () => {
    // `.screen-kicker` hardcoded 12.5px, which is how a one-line token change
    // moved two hundred elements and left one behind.
    const rules = APP_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(rules).not.toMatch(/font-size:\s*12\.5px/);
    expect(rules).not.toMatch(/font-size:\s*13\.5px/);
  });
});

describe("the tokens are load-bearing", () => {
  test("one declaration owns each chrome size", () => {
    expect(TOKENS).toMatch(/--onsen-text-ui:\s*12\.5px/);
    expect(TOKENS).toMatch(/--onsen-text-ui-loose:\s*13\.5px/);
  });

  test("the role tokens read the size tokens rather than repeating them", () => {
    expect(TOKENS).toMatch(/--onsen-text-button:\s*var\(--onsen-text-ui\)/);
    expect(TOKENS).toMatch(/--onsen-text-group-heading:\s*var\(--onsen-text-ui-loose\)/);
  });

  test("they are exposed as utilities, the way the colours already are", () => {
    expect(APP_CSS).toMatch(/--text-ui:\s*var\(--onsen-text-ui\)/);
    expect(APP_CSS).toMatch(/--text-ui-loose:\s*var\(--onsen-text-ui-loose\)/);
  });

  test("components use the utilities", () => {
    const uses = SOURCES.filter(({ source }) => /\btext-ui(-loose)?\b/.test(source));
    // Two hundred-odd call sites across the client; a handful would mean the
    // migration was reverted piecemeal.
    expect(uses.length).toBeGreaterThan(40);
  });
});

describe("the spread cannot quietly grow", () => {
  test("the set of hand-written text sizes is the one recorded here", () => {
    /*
     * A ratchet, not a target. These are the sizes still written as literals
     * after phase 194 — each one a value no token names yet. Adding to this
     * list should be a deliberate act with a reason, which is exactly what
     * failing this test forces.
     */
    const allowed = new Set([
      "11px", "11.5px", "12px", "13px", "14px", "15px", "16px", "17px", "18px", "19px",
    ]);
    const found = new Set<string>();
    for (const { source } of SOURCES) {
      for (const m of source.matchAll(/text-\[([0-9.]+px)\]/g)) found.add(m[1]!);
    }
    const added = [...found].filter((size) => !allowed.has(size));
    expect(added).toEqual([]);
  });
});
