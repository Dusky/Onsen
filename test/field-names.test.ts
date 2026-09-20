import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A field with a visible label has that label (§20 phase 226).
 *
 * Driving the app against a live provider found four fields on the
 * add-a-provider form that a screen reader announced as "edit, blank" — Name,
 * Kind, Address and API key. The visible text was there the whole time, as a
 * sibling `<p className="section-label">`, which labels nothing: a `<p>` is not
 * a `<label>`, and nothing tied it to the control beside it.
 *
 * The browser drive found thirteen such controls across the screens it opened.
 * **This sweep found forty more**, in the sheets it never opened — the script,
 * trigger, webhook and API-key editors, narrative memory, the media services,
 * the pack sheets and the preset's reasoning fields. That gap is the argument
 * for the sweep: a drive sees what it thought to open, and half this app's
 * forms live behind a button somebody has to remember to press.
 *
 * ## What is swept, and why it is not everything
 *
 * Only the house pattern: a `section-label` paragraph *immediately* followed by
 * an `<input>`, `<select>` or `<textarea>`. That pair is unambiguous — a
 * visible label with a control under it and nothing joining them — so the rule
 * has no exceptions to list and no allow-list to fall out of date.
 *
 * A wider sweep over every control in `client/` was tried first and abandoned:
 * it returned 102 hits of which every single one was a false positive (a
 * `<label>` wrapper, an `id` with a matching `for`, a hidden file input, a
 * checkbox inside its own label). A guard nobody can read the output of is a
 * guard nobody keeps passing. The real answer for the rest is
 * `scripts/rendered-guard.ts` measuring accessible names on a rendered page,
 * which is phase 222's job and is named here so this is not mistaken for
 * complete coverage.
 */

const ROOT = join(import.meta.dir, "..");

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...tsxFiles(path));
    else if (path.endsWith(".tsx")) out.push(path);
  }
  return out;
}

/** The opening tag starting at `from`, with braces and quotes respected. */
function openingTag(source: string, from: number): string {
  let depth = 0;
  let quote = "";
  for (let at = from; at < source.length; at++) {
    const char = source[at]!;
    if (quote !== "") {
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "{") depth++;
    else if (char === "}") depth--;
    else if (char === ">" && depth === 0) return source.slice(from, at + 1);
  }
  return source.slice(from);
}

/** Every `section-label` + control pair in the client, named or not. */
function labelledPairs(): { file: string; line: number; label: string; named: boolean }[] {
  const pattern = /<p className="section-label[^"]*">\s*\{([^}]+)\}\s*<\/p>\s*<(input|select|textarea)/g;
  const out: { file: string; line: number; label: string; named: boolean }[] = [];
  for (const file of tsxFiles(join(ROOT, "client"))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(pattern)) {
      const tagAt = match.index! + match[0].length - `<${match[2]!}`.length;
      const tag = openingTag(source, tagAt);
      out.push({
        file: file.slice(ROOT.length + 1),
        line: source.slice(0, match.index!).split("\n").length,
        label: match[1]!.trim(),
        named: /aria-label|aria-labelledby|placeholder/.test(tag),
      });
    }
  }
  return out;
}

describe("a visible label is a real label", () => {
  test("every section-label paragraph's control carries the name it shows", () => {
    const pairs = labelledPairs();
    // The sweep is worth nothing if it stops finding the pattern — a rename of
    // the class would empty it silently and it would pass forever.
    expect(pairs.length).toBeGreaterThan(50);

    const unnamed = pairs
      .filter((pair) => !pair.named)
      .map((pair) => `${pair.file}:${pair.line} ${pair.label}`);
    expect(unnamed).toEqual([]);
  });

  test("and it is the same string, not a second one written out by hand", () => {
    /*
     * The failure this heads off is the one a copied label always becomes: the
     * visible text is reworded and the announced one is not, so a screen reader
     * reads the old name for as long as nobody notices. Asserting the
     * expressions match is what makes them one string with two renderings.
     */
    const pattern =
      /<p className="section-label[^"]*">\s*\{([^}]+)\}\s*<\/p>\s*<(?:input|select|textarea)\s+aria-label=\{([^}]+)\}/g;
    const mismatched: string[] = [];
    let checked = 0;
    for (const file of tsxFiles(join(ROOT, "client"))) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(pattern)) {
        checked++;
        if (match[1]!.trim() !== match[2]!.trim()) {
          mismatched.push(`${file.slice(ROOT.length + 1)}: ${match[1]!} vs ${match[2]!}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(30);
    expect(mismatched).toEqual([]);
  });
});

describe("a row's name is its parts, not its parts run together", () => {
  test("the Models lists name themselves rather than letting the DOM do it", () => {
    /*
     * `"DeepSeekOpenAI-compatible · keyed›"` is what a screen reader read out:
     * three stacked spans and a chevron, concatenated with no separator. Phase
     * 190 fixed this class in the header, where the controls were icon-only;
     * its sweep did not reach a list whose buttons have text.
     */
    const panel = readFileSync(join(ROOT, "client", "components", "ModelsPanel.tsx"), "utf8");
    expect(panel).toContain("function rowName(");
    // Each of the three row kinds: the in-use radio, the provider, the profile.
    expect([...panel.matchAll(/aria-label=\{rowName\(/g)].length).toBe(3);
  });

  test("the chevron is not part of any name — aria-expanded already says it", () => {
    const panel = readFileSync(join(ROOT, "client", "components", "ModelsPanel.tsx"), "utf8");
    expect(panel).not.toMatch(/aria-label=\{[^}]*[›▾]/);
  });
});
