import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Every screen that can be empty says what it is for (SPEC §16, §20 phase 51).
 *
 * The design handoff's open question 5 — "empty states beyond 'no messages
 * yet' aren't drawn" — was answered, screen by screen, with the same 11.5px
 * uppercase mono line floating above nothing while the button that would fix
 * it sat in a footer at the other end of the page. Eight copies of it. The
 * copy was fine; the treatment made the app read as a shrug.
 *
 * The rule is checked rather than trusted, because the failure is not a bug in
 * any one screen: it is the next screen doing what the last eight did.
 */

const CLIENT = join(import.meta.dir, "..", "client");

function read(path: string): string {
  return readFileSync(join(CLIENT, path), "utf8");
}

function tsxFiles(dir = CLIENT): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...tsxFiles(path));
    else if (entry.endsWith(".tsx")) out.push(path.slice(CLIENT.length + 1));
  }
  return out;
}

/** Screens whose whole content can be nothing. */
const CAN_BE_EMPTY = [
  "screens/ScenesScreen.tsx",
  "screens/CharactersScreen.tsx",
  "screens/AuthorsScreen.tsx",
  "screens/LorebooksScreen.tsx",
  "screens/LorebookEditorScreen.tsx",
  "screens/SceneSetupScreen.tsx",
  "screens/ChatScreen.tsx",
];

describe("empty screens", () => {
  for (const screen of CAN_BE_EMPTY) {
    test(`${screen} has one`, () => {
      expect(read(screen)).toContain("<EmptyState");
    });
  }

  test("names what is missing and offers the way out", () => {
    /*
     * `title` and `actions`, not a paragraph. Phase 51 wrote a teaching body
     * for every empty screen; phase 53 deleted them, because an empty screen
     * that explains the concept is the app talking about itself — which was
     * the single thing about this app that read as machine-written. `body`
     * survives as optional and is used almost nowhere.
     */
    const source = read("components/EmptyState.tsx");
    expect(source).toContain("title: string;");
    expect(source).toContain("body?: string;");
  });

  test("almost no empty screen still carries a body", () => {
    const bodies = tsxFiles().filter((file) => /\bbody=\{/.test(read(file)));
    expect({ files: bodies, count: bodies.length }).toMatchObject({ count: 0 });
  });

  test("no screen still whispers an empty state in tracked uppercase mono", () => {
    /*
     * The exact shape that was there eight times: a chrome line, tracked,
     * uppercased, dim, and small. It is a fine treatment for a label beside
     * something; it is the wrong one for the only thing on the page.
     */
    const offending = tsxFiles().filter((file) => {
      const source = read(file);
      return [...source.matchAll(/className="([^"]*)"/g)].some((match) => {
        const classes = match[1]!.split(/\s+/);
        const size = classes.find((c) => /^text-\[[\d.]+px\]$/.test(c));
        return (
          classes.includes("chrome") &&
          classes.includes("uppercase") &&
          classes.includes("text-ink-dim") &&
          classes.some((c) => c.startsWith("tracking-[0.1")) &&
          size !== undefined &&
          Number(/[\d.]+/.exec(size)![0]) <= 11.5 &&
          // Only the ones that stand alone as a whole state, which is what the
          // `mb`/`mt` spacing on a bare paragraph gives away.
          /<p className="[^"]*chrome[^"]*uppercase[^"]*">\s*\{strings\.[\w.]*[Ee]mpty/.test(source)
        );
      });
    });
    expect(offending).toEqual([]);
  });
});
