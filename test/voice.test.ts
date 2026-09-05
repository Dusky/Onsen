import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * How much the app says, and how loudly (SPEC §16, §20 phase 53).
 *
 * Two habits, one cause. Every label was mono, uppercase and letter-spaced —
 * 164 of them, at nine different tracking values — and every field carried a
 * sentence explaining itself, 178 of those. Together they meant that almost
 * everything on screen was the app talking about itself rather than the
 * reader's material, which is what "feels shallow" and "reads as AI" were both
 * describing.
 *
 * The chosen chat direction had said so in a comment all along:
 * *"Labels are readable, not decorative: 11px, sentence case, no tracking."*
 * Its mockup, and Quiet's, and Broadsheet's, use no uppercase and no
 * letter-spacing between them. The only mockup that does is the one drawn of
 * what shipped.
 *
 * These are ceilings, not preferences: the failure mode is a distribution, and
 * a distribution is invisible to any review that reads one file at a time.
 */

const CLIENT = join(import.meta.dir, "..", "client");

function tsxFiles(dir = CLIENT): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...tsxFiles(path));
    else if (entry.endsWith(".tsx")) {
      out.push({ name: path.slice(CLIENT.length + 1), text: readFileSync(path, "utf8") });
    }
  }
  return out;
}

const strings = readFileSync(join(CLIENT, "strings.ts"), "utf8");
const css = readFileSync(join(CLIENT, "styles", "app.css"), "utf8");
const tokens = readFileSync(join(CLIENT, "styles", "tokens.css"), "utf8");

describe("labels are readable, not decorative", () => {
  test("nothing in the client is uppercased by a utility", () => {
    // The ops keys are capitals in the data (N, S, I — proofreading marks),
    // which is why even they need no transform.
    const offending = tsxFiles()
      .filter((file) =>
        [...file.text.matchAll(/className="([^"]*)"/g)].some((m) =>
          m[1]!.split(/\s+/).includes("uppercase"),
        ),
      )
      .map((file) => file.name);
    expect(offending).toEqual([]);
  });

  test("nor by a stylesheet", () => {
    expect(css).not.toContain("text-transform: uppercase");
  });

  test("there is one tracking value, and components do not set their own", () => {
    expect(tokens.match(/--onsen-tracking-[\w-]+:/g) ?? []).toEqual([
      "--onsen-tracking-label:",
    ]);
    const offending = tsxFiles()
      .filter((file) => /tracking-\[[\d.]+em\]/.test(file.text))
      .map((file) => file.name);
    expect(offending).toEqual([]);
  });
});

describe("the app does not explain itself", () => {
  /*
   * The rule, from the phase this file was written for: an explanation earns
   * its place only if its absence would cause a mistake that cannot be undone.
   * Confirmations, secrets shown once, and a handful of genuinely obscure
   * machine settings qualify. Definitions do not.
   */
  /*
   * Counted on the strings, not on the render sites. `.explain` carries two
   * jobs — the app explaining itself, and the app reporting state ("Nothing
   * installed", "No key", "Nothing matches that") — and only the first is
   * governed here. There were 178; there are 37, and every one of them is a
   * confirmation, a secret shown once, or a machine setting whose label
   * genuinely cannot carry it.
   */
  const CEILING = 45;

  /** Keys whose value is an explanation rather than a label or a state. */
  function explanatoryKeys(): string[] {
    return [...strings.matchAll(/(\w*(?:Hint|Body|explainer|intro))\s*:/g)].map((m) => m[1]!);
  }

  test("prose is capped, and the cap is the point", () => {
    const count = explanatoryKeys().length;
    expect({ count, underCeiling: count <= CEILING }).toMatchObject({ underCeiling: true });
  });

  test("nothing defines a noun at the reader", () => {
    /*
     * "A lorebook is world info the author can draw on — places, history, who
     * knows what." Eight of these shipped and they are the tell: the shape an
     * encyclopedia uses, aimed at somebody who is looking at the thing itself.
     *
     * Scoped to explanatory values, because a webhook event named "A beat is
     * split by speaker" has the same grammar and is not the same thing.
     */
    const offending = [...strings.matchAll(/(\w*(?:Hint|Body|explainer|intro))\s*:\s*\n?\s*"(An?) \w+ is [^"]{10,}"/g)]
      .map((m) => m[0]);
    expect(offending).toEqual([]);
  });

  test("an explanation is never also chrome", () => {
    const offending = tsxFiles()
      .filter((file) =>
        [...file.text.matchAll(/className="([^"]*)"/g)].some((m) => {
          const classes = m[1]!.split(/\s+/);
          return classes.includes("explain") && classes.includes("chrome");
        }),
      )
      .map((file) => file.name);
    expect(offending).toEqual([]);
  });
});
