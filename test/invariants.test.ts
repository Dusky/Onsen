import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The ten non-negotiables, checked rather than trusted (SPEC §20 phase 60).
 *
 * `HANDOFF.md` opens with ten rules and calls them load-bearing. Six of them
 * already had a test standing behind them and nobody had said which; four were
 * held by nothing but the reading of whoever came next. That asymmetry is the
 * whole reason this file exists — a rule a document asserts and no test
 * measures is a rule that survives exactly as long as the memory of it does,
 * and this project has sixty phases of evidence that memory is not the thing
 * to bet on. Phases 54 through 58 each turned up a feature the app had paid
 * for and could not reach, the oldest dating to migration 0001.
 *
 * So the document names its own guard on every rule, and this file reads the
 * document back. Two halves:
 *
 * 1. **The list and the guards agree.** Every numbered non-negotiable carries
 *    a `Guarded by` line, and every file it names exists. A new rule cannot be
 *    added without either a test or an explicit, written admission that it has
 *    none.
 * 2. **The four that had nothing** — no native modules, no browser storage,
 *    the client never calling a backend, and extensions never reaching a
 *    credential — are measured here, because they are all structural questions
 *    a text sweep can answer honestly.
 *
 * What this file deliberately does not do is re-prove the six that are already
 * proven. `prompt-purity` owns purity, `history-tree` owns the tree,
 * `prompt-builder` owns the prefix and the user-lock, `generation` owns abort
 * and resume. Duplicating an assertion is how two guards end up disagreeing.
 */

const ROOT = join(import.meta.dir, "..");
const HANDOFF = readFileSync(join(ROOT, "docs", "HANDOFF.md"), "utf8");

/** Source under a directory, by extension. Node modules are never source. */
function sourcesUnder(dir: string, extensions: RegExp): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) {
        if (entry === "node_modules") continue;
        walk(path);
        continue;
      }
      if (extensions.test(entry)) out.push({ path: path.slice(ROOT.length + 1), text: readFileSync(path, "utf8") });
    }
  };
  walk(join(ROOT, dir));
  return out;
}

/**
 * Comments removed, string literals kept.
 *
 * Phase 57 learned this the hard way: a guard forbidding `isDesktop` in a file
 * read the comment *explaining* the fix as the defect, which makes the rule
 * impossible to write about. Every check below that greps for a banned name
 * runs on stripped source, so this file and the code it polices can both say
 * `localStorage` out loud while neither one calls it.
 */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("the document names its own guards", () => {
  /** `1. **Claim.** body…` up to the next number or heading. */
  function nonNegotiables(): { number: number; claim: string; body: string }[] {
    const section = HANDOFF.split(/^## Non-negotiables$/m)[1] ?? "";
    const end = section.search(/^## /m);
    const text = end === -1 ? section : section.slice(0, end);
    return text
      .split(/^(?=\d+\.\s+\*\*)/m)
      .map((entry) => /^(\d+)\.\s+\*\*(.+?)\*\*([\s\S]*)$/.exec(entry))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => ({ number: Number(match[1]), claim: match[2]!, body: match[3]! }));
  }

  test("there are ten of them, numbered in order", () => {
    expect(nonNegotiables().map((rule) => rule.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test("every one says what guards it", () => {
    const unguarded = nonNegotiables()
      .filter((rule) => !/Guarded by/.test(rule.body))
      .map((rule) => `${rule.number}. ${rule.claim}`);
    expect(unguarded).toEqual([]);
  });

  test("every test file a rule names exists", () => {
    const named = [...HANDOFF.matchAll(/`(test\/[\w.-]+\.test\.ts)`/g)].map((match) => match[1]!);
    expect(named.length).toBeGreaterThan(8);
    const missing = [...new Set(named)].filter((path) => !existsSync(join(ROOT, path)));
    expect(missing).toEqual([]);
  });
});

describe("7. no native modules", () => {
  /** Every installed package root, including nested and scoped ones. */
  function packageRoots(): string[] {
    const out: string[] = [];
    const scan = (modules: string) => {
      if (!existsSync(modules)) return;
      for (const entry of readdirSync(modules)) {
        if (entry.startsWith(".")) continue;
        const path = join(modules, entry);
        if (!statSync(path).isDirectory()) continue;
        if (entry.startsWith("@")) {
          for (const scoped of readdirSync(path)) {
            const inner = join(path, scoped);
            if (!statSync(inner).isDirectory()) continue;
            out.push(inner);
            scan(join(inner, "node_modules"));
          }
          continue;
        }
        out.push(path);
        scan(join(path, "node_modules"));
      }
    };
    scan(join(ROOT, "node_modules"));
    return out;
  }

  const ROOTS = packageRoots();

  test("there are dependencies installed to check", () => {
    expect(ROOTS.length).toBeGreaterThan(20);
  });

  /**
   * `bun install` must not compile anything.
   *
   * The rule's own words are "if a dependency needs node-gyp, find another one"
   * — and node-gyp runs from an install script. A package with no install
   * hook and no `binding.gyp` has nothing to build, whatever it ships.
   */
  test("no installed package builds at install time", () => {
    // Install hooks that are a harmless no-op script rather than a build step.
    // The rule is about node-gyp; a hook that only prints a warning does not
    // violate it.
    const HARMLESS_HOOKS = new Set(["protobufjs"]);
    const building: string[] = [];
    for (const root of ROOTS) {
      if (existsSync(join(root, "binding.gyp"))) building.push(`${root.slice(ROOT.length + 1)} (binding.gyp)`);
      const manifest = join(root, "package.json");
      if (!existsSync(manifest)) continue;
      let scripts: Record<string, string> = {};
      try {
        scripts = (JSON.parse(readFileSync(manifest, "utf8")) as { scripts?: Record<string, string> }).scripts ?? {};
      } catch {
        continue;
      }
      const name = root.split("/").at(-1) ?? "";
      for (const hook of ["preinstall", "install", "postinstall"]) {
        if (scripts[hook] !== undefined && !HARMLESS_HOOKS.has(name)) {
          building.push(`${root.slice(ROOT.length + 1)} (${hook})`);
        }
      }
    }
    expect(building).toEqual([]);
  });

  /**
   * The server loads no native code.
   *
   * Distinct from the check above, and the distinction is the honest part:
   * there *are* `.node` files under `node_modules` — Vite's bundler and
   * Tailwind's oxide ship prebuilt platform binaries, and prebuilt is not a
   * compile step. But they are build-time devDependencies. What the rule
   * actually protects is `bun server/index.ts` on someone else's machine, so
   * the closure that must stay clean is the runtime one.
   */
  test("nothing in the runtime dependency closure is a native binary", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const closure = new Set<string>();
    const queue = Object.keys(manifest.dependencies ?? {});
    while (queue.length > 0) {
      const name = queue.shift()!;
      if (closure.has(name)) continue;
      closure.add(name);
      const path = join(ROOT, "node_modules", name, "package.json");
      if (!existsSync(path)) continue;
      const pkg = JSON.parse(readFileSync(path, "utf8")) as {
        dependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
      };
      for (const dependency of [
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.optionalDependencies ?? {}),
      ]) {
        if (!closure.has(dependency)) queue.push(dependency);
      }
    }
    expect(closure.size).toBeGreaterThan(5);

    const native: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (entry.endsWith(".node")) native.push(path.slice(ROOT.length + 1));
      }
    };
    for (const name of closure) {
      const dir = join(ROOT, "node_modules", name);
      if (existsSync(dir)) walk(dir);
    }
    expect(native).toEqual([]);
  });
});

describe("8. no browser storage", () => {
  /**
   * `caches` is not on this list on purpose. The service worker keeps the
   * build's own shell in the Cache API, which is the offline story rather than
   * a place UI state hides — and phase 44's `pwa.test.ts` already asserts it
   * caches nothing under `/api`. The four names below have no such reading:
   * every one of them is state surviving a reload in the browser instead of in
   * SQLite, which is the thing the rule forbids.
   */
  const BANNED = [/\blocalStorage\b/, /\bsessionStorage\b/, /\bindexedDB\b/i, /\bdocument\.cookie\b/];

  test("the client stores nothing in the browser", () => {
    const offenders: string[] = [];
    for (const file of sourcesUnder("client", /\.(ts|tsx|js)$/)) {
      const source = withoutComments(file.text);
      for (const pattern of BANNED) {
        if (pattern.test(source)) offenders.push(`${file.path}: ${String(pattern)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("there is client source to check", () => {
    expect(sourcesUnder("client", /\.(ts|tsx)$/).length).toBeGreaterThan(30);
  });
});

describe("6. the server owns generation", () => {
  /**
   * Every request the client makes goes to this app's own API.
   *
   * The rule is that the client never calls an inference backend, and the
   * shape that would break it is a fetch to an absolute URL — a base URL from
   * settings, a provider's endpoint "just for the model list". Requiring every
   * target to be a `/api` path is stricter than the rule and much easier to
   * read than a blocklist of provider hostnames, which would only ever name
   * the providers somebody had already thought of.
   *
   * Note what this deliberately allows: the settings screen holds a provider's
   * API key, because the reader types it there. Handling a credential on its
   * way to this app's own server is the feature. Sending one anywhere else is
   * the violation, and that is a question about the target, not the value.
   */
  test("every client fetch targets this app's own API", () => {
    const offenders: string[] = [];
    for (const file of sourcesUnder("client", /\.(ts|tsx)$/)) {
      for (const match of withoutComments(file.text).matchAll(/\bfetch\(\s*([\s\S]{0,16})/g)) {
        const argument = match[1]!;
        const literal = /^(["'`])\/api/.test(argument);
        if (!literal) offenders.push(`${file.path}: fetch(${argument.split("\n")[0]!.trim()}…`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("9. extensions never see provider credentials", () => {
  /**
   * The extensibility tiers are data (SPEC §15): regex scripts, packs and
   * webhook subscriptions. None of them runs code, and none of them has any
   * business reaching a provider's key — a pack that exported one would put a
   * credential in an archive people trade.
   *
   * The check is on imports rather than on the word `secret`, because the
   * webhook sender legitimately decrypts one: its own HMAC signing secret,
   * which is what makes a delivery verifiable. Naming the two query modules
   * that hold provider credentials says what is actually forbidden.
   */
  const FORBIDDEN = /from\s+"[^"]*db\/queries\/api-keys\.ts"/;

  for (const area of ["scripts", "packs", "webhooks"]) {
    test(`${area} reaches no credential`, () => {
      const files = sourcesUnder(join("server", area), /\.ts$/);
      expect(files.length).toBeGreaterThan(0);
      const offenders = files
        .filter((file) => FORBIDDEN.test(file.text) || /\bapiKey\b/.test(withoutComments(file.text)))
        .map((file) => file.path);
      expect(offenders).toEqual([]);
    });
  }

  /**
   * A pack cannot carry a provider, by construction.
   *
   * The import check above names `api-keys.ts` alone rather than the whole
   * connections module, because a preset is a legitimate pack artifact and
   * presets live in that module beside the provider rows. Which makes the kind
   * list the load-bearing statement: an archive people trade has no directory
   * a credential could go in.
   */
  test("no pack kind is a provider", () => {
    const manifest = readFileSync(join(ROOT, "server", "packs", "manifest.ts"), "utf8");
    const kinds = [...(manifest.match(/PACK_KINDS = \[([\s\S]*?)\]/)?.[1] ?? "").matchAll(/"([\w-]+)"/g)].map(
      (match) => match[1]!,
    );
    expect(kinds.length).toBeGreaterThan(4);
    expect(kinds.filter((kind) => /provider|connection|key|credential/.test(kind))).toEqual([]);
  });
});
