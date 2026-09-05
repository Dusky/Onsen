import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Every field the server accepts has somewhere to set it (SPEC §16, §20 phase 54).
 *
 * `reachable.test.ts` asks whether an endpoint has a caller. This asks the
 * question one level down, which is where this codebase actually goes wrong:
 * the endpoint is called, and half the fields it accepts are unreachable. The
 * survey that prompted this phase found the pattern everywhere —
 * `UpdatePersonaRequest.description` reaches the prompt builder and no screen
 * could set it; a lore entry's `insertionRole` decides which role the injected
 * text lands in and had zero client hits; three of four lorebook binding scopes
 * were display-only.
 *
 * The contract is checked against the **request interfaces** rather than the
 * handlers. Handlers read a body four different ways here — `body["x"]`,
 * `input.x`, `"x" in input`, a cast to the DTO — so a regex over them would be
 * noise, while `shared/types.ts` says exactly what the server takes and is the
 * thing the client is written against.
 */

const ROOT = join(import.meta.dir, "..");

/** Every field name on every `*Request` interface, with its interface. */
function requestFields(): { request: string; field: string }[] {
  const source = readFileSync(join(ROOT, "shared", "types.ts"), "utf8");
  const out: { request: string; field: string }[] = [];
  for (const match of source.matchAll(/export interface (\w*Request)\b[^{]*\{([\s\S]*?)\n\}/g)) {
    const request = match[1]!;
    // Strip comments first: a field named in prose is not a field.
    const body = match[2]!
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    for (const field of body.matchAll(/^\s{2}(\w+)\??\s*:/gm)) {
      out.push({ request, field: field[1]! });
    }
  }
  return out;
}

function clientSource(): string {
  let all = "";
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name)) all += readFileSync(path, "utf8");
    }
  };
  walk(join(ROOT, "client"));
  return all;
}

/**
 * Fields no screen sets, and why. Same shape and same discipline as
 * `reachable.test.ts`: a reason each, checked for staleness below, so an excuse
 * cannot outlive the field it excuses.
 */
const DELIBERATE = new Map<string, string>([
  [
    "UpdateLorebookRequest.recursionDepth",
    "§10: book-level recursion depth. Phase 55, with the book's description.",
  ],
  [
    "UpdateCharacterRequest.depthPromptRole",
    "§9: the depth prompt has a control for its text and its depth but not its role. Phase 55.",
  ],
  [
    "UpdateCharacterRequest.characterVersion",
    "§9: round-tripped through import and export and never shown. Phase 55.",
  ],
]);

describe("every field the server accepts", () => {
  const fields = requestFields();
  const client = clientSource();

  test("the scan found the contracts", () => {
    // A refactor that moves the request types elsewhere must not turn this into
    // a test that passes by checking nothing.
    expect(new Set(fields.map((f) => f.request)).size).toBeGreaterThan(20);
    expect(fields.length).toBeGreaterThan(100);
  });

  test("has somewhere to set it", () => {
    const orphans = fields
      .filter(({ request, field }) => !DELIBERATE.has(`${request}.${field}`))
      // A field is reachable if the client names it at all — as a key it sets,
      // a prop it passes, or a DTO field it reads back. Deliberately loose: it
      // can miss an alarm, never raise a false one.
      .filter(({ field }) => !new RegExp(`\\b${field}\\b`).test(client))
      .map(({ request, field }) => `${request}.${field}`);
    expect(orphans).toEqual([]);
  });

  test("the deliberate list has no stale entries", () => {
    const live = new Set(fields.map((f) => `${f.request}.${f.field}`));
    expect([...DELIBERATE.keys()].filter((key) => !live.has(key))).toEqual([]);
  });
});
