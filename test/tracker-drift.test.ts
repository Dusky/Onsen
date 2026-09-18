import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The trackers cannot drift again (§20 phase 219).
 *
 * `docs/NEXT.md` opens by complaining about a seventeen-phase drift. It was
 * twenty-three when this was written: the README said phase 195, `NEXT.md` said
 * phase 195 and 1929 tests, `SPEC.md` §20's list ended at item 195, and the
 * tree stood at phase 218 — with phase 211 missing from `PHASES.md` entirely,
 * so the file jumped 210 → 212 and a shipped feature had no entry anywhere.
 *
 * Both times it was caught the same way: somebody asked what was next and the
 * answer had to be re-derived from `PHASES.md` by hand.
 *
 * `NEXT.md` step 5 has said since phase 60 that §20, `PHASES.md`, `GAPS.md` and
 * the README move in the same commit, and saying it has now failed three times.
 * So this is the rule as a test. It is deliberately narrow — three numbers and a
 * sequence, nothing about prose — because a guard that tried to check whether an
 * entry was any *good* would be the kind nobody can keep passing.
 *
 * `GAPS.md` is not in here on purpose: it is evidence rather than a count, and
 * asserting anything about its contents would be asserting a number that is
 * supposed to move on its own.
 */

const read = (path: string) => readFileSync(path, "utf8");

/**
 * Every build-order phase `PHASES.md` has an entry for, in file order.
 *
 * Integers only. A fraction — "Phase 31½ — The completion sweep" — is the
 * repo's own convention for a maintenance pass that rides between two
 * build-order phases, and counting one as its floor would read as a duplicate.
 */
function phaseNumbers(): number[] {
  return [...read("docs/PHASES.md").matchAll(/^## Phase (\d+) — /gm)].map((m) => Number(m[1]));
}

/**
 * The one number two entries share, and why it is allowed to.
 *
 * "Phase 31 — Structured trackers" is the feature; "Phase 31 — Schema
 * reconciliation" is a maintenance pass that describes itself as "not a feature
 * phase" and belongs to the same between-phases convention as 31½ — it simply
 * did not take a fraction. Renumbering it now would falsify the two documents
 * that cite it by number (`SPEC.md` §2's "settled while building phase 31" and
 * the same sentence in `HANDOFF.md`), and every other reference to phase 31 in
 * the tree means the trackers. So the history stands and the exemption is
 * named, the way `KNOWN_CONTRAST` names its own — and like that list, this one
 * fails if the entry stops being needed.
 */
const SHARED_BY_HISTORY = [31];

/**
 * Every item number in `SPEC.md` §20's numbered list.
 *
 * Matched on a numbered line whose text is bold, which is the shape every §20
 * item has and which ordinary numbered prose elsewhere in the spec does not.
 */
function specItems(): number[] {
  return [...read("docs/SPEC.md").matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]));
}

describe("the phase list, the spec and the README agree", () => {
  test("PHASES.md numbers every phase once, with no gaps", () => {
    const numbers = phaseNumbers();
    expect(numbers.length).toBeGreaterThan(200);

    const duplicates = [...new Set(numbers.filter((n, at) => numbers.indexOf(n) !== at))];
    expect(duplicates).toEqual(SHARED_BY_HISTORY);

    // A hole is how phase 211 went missing: it shipped a feature and four
    // documents, wrote no entry, and nobody noticed for seven phases.
    const sorted = [...numbers].sort((a, b) => a - b);
    const holes = [];
    for (let n = sorted[0]!; n < sorted[sorted.length - 1]!; n++) {
      if (!numbers.includes(n)) holes.push(n);
    }
    expect(holes).toEqual([]);
  });

  test("§20's list reaches the phase PHASES.md reaches", () => {
    const highestPhase = Math.max(...phaseNumbers());
    const items = specItems();
    // §20 items only exist from the phase the list started at, so the check is
    // on the top of it: the newest phase must have said what it did in the
    // spec, which is the half that kept slipping.
    expect(Math.max(...items)).toBe(highestPhase);
  });

  test("the README badge says the phase the tree is at", () => {
    const highestPhase = Math.max(...phaseNumbers());
    const badge = /\*\*Status: phase (\d+)\b/.exec(read("README.md"));
    expect(badge).not.toBeNull();
    expect(Number(badge![1])).toBe(highestPhase);
  });

  test("NEXT.md's state line says the same phase", () => {
    // The file whose whole job is telling the next person where they are.
    const state = /\*\*State:\*\* phase (\d+)\b/.exec(read("docs/NEXT.md"));
    expect(state).not.toBeNull();
    expect(Number(state![1])).toBe(Math.max(...phaseNumbers()));
  });
});
