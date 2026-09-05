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
  /*
   * The assistant's whole surface, §25. Phase 46 shipped the server half and
   * said so; the client is its own phase. These are listed one by one rather
   * than excused by a prefix, so building that client deletes eight lines from
   * here and nothing silently keeps passing.
   *
   * They were not reported as orphans until phase 47, because the mount scan
   * above could not read past the comment on their `api.route` call.
   */
  ["GET /agent/tools", "§25: the assistant's client is its own phase."],
  ["GET /agent/undo", "§25: the assistant's client is its own phase."],
  ["GET /agent/threads", "§25: the assistant's client is its own phase."],
  ["POST /agent/threads", "§25: the assistant's client is its own phase."],
  ["GET /agent/threads/:threadId", "§25: the assistant's client is its own phase."],
  ["PATCH /agent/threads/:threadId", "§25: the assistant's client is its own phase."],
  ["DELETE /agent/threads/:threadId", "§25: the assistant's client is its own phase."],
  [
    "POST /agent/threads/:threadId/messages",
    "§25: the assistant's client is its own phase.",
  ],
]);

interface Endpoint {
  method: string;
  /** Every prefix this file is mounted at. Reachable under any of them. */
  paths: string[];
  file: string;
}

function mountPrefixes(): Map<string, string[]> {
  const app = readFileSync(join(ROOT, "server/app.ts"), "utf8");
  const byFactory = new Map<string, string>();
  // Both mount points: `api` is everything under /api, and `app` is §19's
  // outbound surface, which is deliberately mounted at the root.
  // Comments and line breaks are skipped between the path and the factory: a
  // mount worth explaining is the most likely one to be explained, and the
  // agent's was — which made its eight endpoints invisible to this whole file
  // until phase 47 went looking for why they were not reported as orphans.
  const SKIP = String.raw`(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*`;
  const mount = new RegExp(
    String.raw`\b(?:api|app)\.route\(${SKIP}"([^"]*)",${SKIP}(\w+)\(`,
    "g",
  );
  for (const match of app.matchAll(mount)) {
    byFactory.set(match[2]!, match[1]!);
  }
  /*
   * A routes file may export more than one factory, mounted at more than one
   * prefix — authors.ts is /authors and /personas, generation.ts is
   * /generations and /scenes, api-keys.ts is /api-keys and /scene-api. Matching
   * a single import name skipped all three files outright; keeping a single
   * prefix per file would be worse, silently filing half of each file's
   * endpoints under the wrong path. So a file carries every prefix it is
   * mounted at, and an endpoint counts as reachable under any of them.
   *
   * That is looser than tying each `app.get` to its enclosing factory, which
   * would need a parser rather than a regex. It cannot produce a false alarm,
   * only miss one — the right way round for a test nobody will read again
   * until it fails.
   */
  const byFile = new Map<string, string[]>();
  for (const match of app.matchAll(/import \{([^}]*)\} from "\.\/routes\/([\w-]+)\.ts"/g)) {
    for (const name of match[1]!.split(",").map((part) => part.trim())) {
      const prefix = byFactory.get(name);
      if (prefix === undefined) continue;
      const already = byFile.get(match[2]!) ?? [];
      if (!already.includes(prefix)) byFile.set(match[2]!, [...already, prefix]);
    }
  }
  return byFile;
}

function endpoints(): Endpoint[] {
  const prefixes = mountPrefixes();
  const found: Endpoint[] = [];
  for (const name of readdirSync(join(ROOT, "server/routes"))) {
    if (!name.endsWith(".ts")) continue;
    const base = name.replace(/\.ts$/, "");
    const mounts = prefixes.get(base);
    // A routes file nothing mounts is its own kind of dead code. It is skipped
    // here and reported by "every routes file is mounted" below — which for a
    // long time this comment claimed existed and did not.
    if (mounts === undefined) continue;
    const text = readFileSync(join(ROOT, "server/routes", name), "utf8");
    for (const match of text.matchAll(/app\.(get|post|patch|put|delete)\(\s*"([^"]*)"/g)) {
      found.push({
        method: match[1]!.toUpperCase(),
        paths: mounts.map((prefix) => `${prefix}${match[2]!}`.replace(/\/+/g, "/")),
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

  test("every routes file is mounted", () => {
    /*
     * The hole this file had until phase 47: `endpoints()` skips any routes
     * file it cannot find a mount for, so a file that is never mounted — or
     * one whose mount the scan simply fails to parse — leaves this suite
     * quietly checking less than it says it does. Two of the three endpoint
     * tests here are counts, and a count cannot notice what it never saw.
     */
    const mounted = mountPrefixes();
    const unmounted = readdirSync(join(ROOT, "server/routes"))
      .filter((name) => name.endsWith(".ts"))
      .map((name) => name.replace(/\.ts$/, ""))
      .filter((base) => !mounted.has(base));
    expect(unmounted).toEqual([]);
  });

  test("the scan found the API", () => {
    // A refactor that moves routes elsewhere must not turn this suite into a
    // test that passes by checking nothing.
    expect(all.length).toBeGreaterThan(150);
  });

  test("nothing is built and unreachable", () => {
    const orphans = all
      .filter((row) => !row.paths.some((path) => DELIBERATE.has(`${row.method} ${path}`)))
      .filter((row) => !row.paths.some((path) => pathPattern(path).test(client)))
      .map((row) => `${row.method} ${row.paths.join(" | ")}  (${row.file}.ts)`);

    // Checkpoints, hidden messages and preset export all sat here, each behind
    // a passing API test. If this list is not empty, either wire the endpoint
    // up or add it to DELIBERATE with the reason.
    expect(orphans).toEqual([]);
  });

  test("the deliberate list has no stale entries", () => {
    const live = new Set(all.flatMap((row) => row.paths.map((path) => `${row.method} ${path}`)));
    // An allowlist that outlives its endpoint quietly excuses the next one that
    // takes the same path.
    expect([...DELIBERATE.keys()].filter((key) => !live.has(key))).toEqual([]);
  });
});
