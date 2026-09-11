import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Query functions nothing outside their own file calls (`IMPROVEMENTS.md` 5).
 *
 * The companion to `dead-columns`, and the same defect one layer up. Phase 60
 * counted 21 of 310 exported functions in `server/db/queries/` referenced
 * nowhere else. Two of those were real bugs — a feature whose storage and
 * query existed and whose route did not — and nineteen were never looked at,
 * so the count sat in a plan for a hundred phases.
 *
 * An unused export is not itself a bug. What it is, reliably, is a *question*:
 * either the feature was never wired up, or the function is internal and its
 * `export` is telling the reader otherwise. This asserts the list is empty, so
 * the question gets answered when it appears rather than accumulating.
 *
 * If a genuinely internal helper has to keep its `export` — a test reaching in,
 * say — name it in `DELIBERATE` with the reason, the way `dead-columns` does.
 * The list being empty is the point; an entry in it is not a failure.
 */

const ROOT = join(import.meta.dir, "..");
const QUERIES = join(ROOT, "server", "db", "queries");

/** Exports that are internal on purpose, with the reason they stay exported. */
const DELIBERATE: Record<string, string> = {};

function sources(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (entry === "node_modules") continue;
        walk(path);
        continue;
      }
      if (/\.(ts|tsx)$/.test(entry)) out.push({ path, text: readFileSync(path, "utf8") });
    }
  };
  for (const dir of ["server", "client", "shared", "test", "scripts"]) walk(join(ROOT, dir));
  return out;
}

const SOURCES = sources();

describe("every exported query is called from somewhere else", () => {
  test("the query layer has no export nothing reaches", () => {
    const exported: { name: string; home: string }[] = [];
    for (const entry of readdirSync(QUERIES)) {
      if (!entry.endsWith(".ts")) continue;
      const text = readFileSync(join(QUERIES, entry), "utf8");
      for (const match of text.matchAll(/^export function (\w+)/gm)) {
        exported.push({ name: match[1]!, home: join(QUERIES, entry) });
      }
    }
    // A regression in the other direction is worth catching too: if this
    // stopped finding anything, the assertion below would pass vacuously.
    expect(exported.length).toBeGreaterThan(250);

    const dead = exported
      .filter(({ name, home }) => {
        if (name in DELIBERATE) return false;
        const word = new RegExp(`\\b${name}\\b`);
        return !SOURCES.some((file) => file.path !== home && word.test(file.text));
      })
      .map(({ name, home }) => `${name} (${home.slice(ROOT.length + 1)})`);
    expect(dead).toEqual([]);
  });
});
