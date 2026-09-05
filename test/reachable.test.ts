import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every endpoint is reachable from a screen.
 *
 * Three features shipped built, tested and invisible: checkpoints (a full
 * server half from phase 2 that nothing ever called), hiding a message from
 * the prompt, and preset export. §10 records a fourth — `scenario_override`
 * surviving seventeen migrations unwired.
 *
 * Passing tests are what made those feel done. An API test proves the endpoint
 * works; nothing proved anyone could get to it. This is that test.
 *
 * It is deliberately structural rather than clever: read the routes, read the
 * client, and require that each path shape appears somewhere. It cannot tell a
 * reachable button from an unreachable one, which is fine — the failure it
 * catches is a whole feature with no caller at all.
 */

const ROOT = join(import.meta.dir, "..");

/**
 * Endpoints with no client caller on purpose, each with the reason.
 *
 * Adding to this list is a decision, which is the point of it being here rather
 * than a pattern in the matcher.
 */
const DELIBERATE = new Map<string, string>([
  [
    "POST /v1/chat/completions",
    "§19: the outbound API is for other people's clients, not ours. Mounted at the root rather than under /api for the same reason.",
  ],
  ["GET /v1/models", "§19: an outside client asks what this install serves."],
  [
    "POST /documents/retrieve",
    "A retrieval probe for tests and debugging. The prompt path calls the store directly.",
  ],
  [
    "GET /webhooks/events",
    "Redundant with the shared WEBHOOK_EVENTS constant, which the editor uses instead.",
  ],
]);

interface Endpoint {
  method: string;
  path: string;
  file: string;
}

function mountPrefixes(): Map<string, string> {
  const app = readFileSync(join(ROOT, "server/app.ts"), "utf8");
  const byFactory = new Map<string, string>();
  // Both mount points: `api` is everything under /api, and `app` is §19's
  // outbound surface, which is deliberately mounted at the root.
  for (const match of app.matchAll(/\b(?:api|app)\.route\(\s*\n?\s*"([^"]*)",\s*\n?\s*(\w+)\(/g)) {
    byFactory.set(match[2]!, match[1]!);
  }
  const byFile = new Map<string, string>();
  for (const match of app.matchAll(/import \{ (\w+) \} from "\.\/routes\/([\w-]+)\.ts"/g)) {
    const prefix = byFactory.get(match[1]!);
    if (prefix !== undefined) byFile.set(match[2]!, prefix);
  }
  return byFile;
}

function endpoints(): Endpoint[] {
  const prefixes = mountPrefixes();
  const found: Endpoint[] = [];
  for (const name of readdirSync(join(ROOT, "server/routes"))) {
    if (!name.endsWith(".ts")) continue;
    const base = name.replace(/\.ts$/, "");
    const prefix = prefixes.get(base);
    // A routes file nothing mounts is its own kind of dead code, and the
    // mounted-ness test below is where that is reported.
    if (prefix === undefined) continue;
    const text = readFileSync(join(ROOT, "server/routes", name), "utf8");
    for (const match of text.matchAll(/app\.(get|post|patch|put|delete)\(\s*"([^"]*)"/g)) {
      found.push({
        method: match[1]!.toUpperCase(),
        path: `${prefix}${match[2]!}`.replace(/\/+/g, "/"),
        file: base,
      });
    }
  }
  return found;
}

function clientSource(): string {
  let all = "";
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      // `.html` because not every caller is JavaScript: the theme stylesheet is
      // a <link> in the document, which is a real caller and was invisible here
      // until it existed (phase 45).
      else if (/\.(ts|tsx|html)$/.test(entry.name)) all += readFileSync(path, "utf8");
    }
  };
  walk(join(ROOT, "client"));
  return all;
}

/** The path as the client would write it, with `:params` as interpolations. */
function pathPattern(path: string): RegExp {
  const body = path
    .split("/")
    .filter((segment) => segment !== "")
    .map((segment) =>
      segment.startsWith(":")
        ? "[^/`\"']+"
        : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  return new RegExp(`/${body}\\b`);
}

describe("every endpoint has a caller", () => {
  const all = endpoints();
  const client = clientSource();

  test("the scan found the API", () => {
    // A refactor that moves routes elsewhere must not turn this suite into a
    // test that passes by checking nothing.
    expect(all.length).toBeGreaterThan(150);
  });

  test("nothing is built and unreachable", () => {
    const orphans = all
      .filter((row) => !DELIBERATE.has(`${row.method} ${row.path}`))
      .filter((row) => !pathPattern(row.path).test(client))
      .map((row) => `${row.method} ${row.path}  (${row.file}.ts)`);

    // Checkpoints, hidden messages and preset export all sat here, each behind
    // a passing API test. If this list is not empty, either wire the endpoint
    // up or add it to DELIBERATE with the reason.
    expect(orphans).toEqual([]);
  });

  test("the deliberate list has no stale entries", () => {
    const live = new Set(all.map((row) => `${row.method} ${row.path}`));
    // An allowlist that outlives its endpoint quietly excuses the next one that
    // takes the same path.
    expect([...DELIBERATE.keys()].filter((key) => !live.has(key))).toEqual([]);
  });
});
