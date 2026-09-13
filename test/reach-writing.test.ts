import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The writing is reachable without a mouse (§20 phase 191).
 *
 * A use review pressed Tab from the top of the chat screen and never arrived
 * at the composer — the app's primary action, and the one thing on the screen
 * it exists for. The Prompt rail alone is around seventy-eight tab stops (26
 * blocks × a toggle and two arrows) and it precedes the main content in DOM
 * order, so the composer sat past a hundred stops.
 *
 * Two routes now, because they fail differently: a key, which is fast but has
 * to be known, and a skip link, which is discoverable but only on the first
 * Tab of a fresh load. Structural assertions — the alternative is rendering
 * the whole shell, which this project deliberately does not do.
 */

const COMPOSER = readFileSync("client/components/Composer.tsx", "utf8");
const KEYS = readFileSync("client/screens/chat/useCommandKeys.ts", "utf8");
const APP = readFileSync("client/App.tsx", "utf8");
const COMMANDS = readFileSync("client/lib/commands.ts", "utf8");

describe("the composer can be addressed from outside itself", () => {
  test("it exports an id and a focus helper, and the field carries the id", () => {
    // The textarea's ref is private and the component takes no ref prop, so
    // before this there was no mechanism by which anything *could* focus it.
    expect(COMPOSER).toContain("export const COMPOSER_ID");
    expect(COMPOSER).toContain("export function focusComposer()");
    expect(COMPOSER).toMatch(/<textarea[\s\S]{0,200}id=\{COMPOSER_ID\}/);
  });

  test("the helper puts the caret at the end of an existing draft", () => {
    expect(COMPOSER).toContain("setSelectionRange(field.value.length, field.value.length)");
  });
});

describe("two routes to it", () => {
  test("a key binding calls the helper", () => {
    expect(KEYS).toContain("focusComposer");
    expect(KEYS).toMatch(/event\.key === "c"/);
  });

  test("the key is not already an accelerator", () => {
    // The single-key accelerators are gated on a turn being selected; this one
    // is not, so it must not collide with any of them.
    const claimed = [...COMMANDS.matchAll(/key: "([a-z])"/g)].map((m) => m[1]);
    expect(claimed).not.toContain("c");
  });

  test("it cannot eat a keystroke meant for a field", () => {
    // The guard that makes a bare letter safe at all. Asserted because the
    // binding above is only safe while this is true.
    expect(KEYS).toMatch(/matches\("input, textarea, \[contenteditable\]"\)/);
    expect(KEYS).toMatch(/if \(inField === true\) return;/);
  });

  test("the shell renders a skip link, and renders it first", () => {
    expect(APP).toContain("function SkipToWriting()");
    expect(APP).toContain("<SkipToWriting />");
    /*
     * First in the DOM is the whole point: a skip link that is not the first
     * tab stop is decoration.
     *
     * Anchored on the desktop branch specifically — the phone branch shares
     * the same wrapper class and renders no rails, so it has nothing to skip
     * past and deliberately has no link.
     */
    const shell = APP.slice(APP.indexOf("<SkipToWriting />"));
    const background = shell.indexOf("<Background />");
    const leftRail = shell.indexOf("<LeftRail />");
    expect(background).toBeGreaterThan(0);
    expect(leftRail).toBeGreaterThan(0);
    // Everything it skips past comes after it.
    expect(background).toBeLessThan(leftRail);
  });

  test("the skip link is hidden until focused", () => {
    expect(APP).toMatch(/sr-only focus:not-sr-only/);
  });
});
