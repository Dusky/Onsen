import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Every exported query function is called somewhere (SPEC §2, §20 phase 76).
 *
 * Phase 60 found 21 of 310 exported functions in `server/db/queries/`
 * referenced nowhere outside their own file. Two were behaviourally
 * significant — `findDefaultPersona` (fixed in phase 61) and `findDefaultPreset`
 * — which is the same shape as a dead column: a feature the app has already
 * paid for and cannot reach. This measures it the way `dead-columns` measures
 * storage, with the same two rules: matched by *name*, and a `DELIBERATE` map
 * so an excuse cannot outlive the export it excuses.
 */

const ROOT = join(import.meta.dir, "..");
const QUERIES = join(ROOT, "server", "db", "queries");

/**
 * Comments removed, string literals kept.
 *
 * Phase 76's first run missed `findDefaultPreset` because a comment in this
 * very file named it, and the name-based check read the explanation as a
 * caller — the exact trap HANDOFF warns about for banned-name greps, in
 * reverse. A name in a comment is not a read.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Every source file that could name an export, as one comment-stripped string. */
function source(): string {
  let all = "";
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (entry === "node_modules") continue;
        walk(path);
        continue;
      }
      if (/\.(ts|tsx)$/.test(entry)) all += stripComments(readFileSync(path, "utf8"));
    }
  };
  for (const dir of ["server", "client", "shared", "test"]) walk(join(ROOT, dir));
  return all;
}

const ALL = source();

/**
 * Exports referenced nowhere outside their own file, with the reason. Same
 * shape and discipline as `reachable.test.ts` and `dead-columns.test.ts`.
 */
const DELIBERATE = new Map<string, string>([]);

interface Exported {
  file: string;
  name: string;
}

function exportedFunctions(): Exported[] {
  const out: Exported[] = [];
  for (const file of readdirSync(QUERIES)) {
    if (!file.endsWith(".ts")) continue;
    const text = readFileSync(join(QUERIES, file), "utf8");
    for (const match of text.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)) {
      out.push({ file, name: match[1]! });
    }
  }
  return out;
}

describe("every exported query is called somewhere", () => {
  const exports_ = exportedFunctions();

  test("the sweep found the queries", () => {
    expect(exports_.length).toBeGreaterThan(200);
  });

  test("no export is referenced nowhere outside its own file", () => {
    const orphans = exports_
      .filter(({ file, name }) => !DELIBERATE.has(name))
      .filter(({ file, name }) => {
        const own = stripComments(readFileSync(join(QUERIES, file), "utf8"));
        const inAll = (ALL.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
        const inOwn = (own.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
        // The export's own declaration and any same-file use count against it;
        // a mention anywhere else is a read.
        return inAll <= inOwn;
      })
      .map(({ file, name }) => `${file}: ${name}`);
    expect(orphans).toEqual([]);
  });

  test("the deliberate list has no stale entries", () => {
    const live = new Set(exports_.map((e) => e.name));
    expect([...DELIBERATE.keys()].filter((key) => !live.has(key))).toEqual([]);
  });
});
