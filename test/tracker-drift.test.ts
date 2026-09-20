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
 * So this is the rule as a test. It is deliberately narrow — numbers, a sequence,
 * and one exact string match, nothing about prose — because a guard that tried to
 * check whether an entry was any *good* would be the kind nobody can keep
 * passing.
 *
 * **A fourth drift, and a different shape (§20 phase 232).** The numbers all
 * agreed while the *queue* did not: `NEXT.md` still listed "The rendered guard
 * measures the whole app" and "The leaks in the new screens" as open work,
 * months after they shipped as phases 222 and 223 — with the queue entry's
 * title word-for-word identical to the `PHASES.md` heading. Nothing here looked
 * at the queue, so nothing failed. `a shipped item is struck through` below is
 * that hole closed.
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

  /**
   * A queue item whose work has shipped is struck through.
   *
   * The fourth drift was not a number, it was an entry: two items sat open in
   * `NEXT.md`'s queue whose titles are *word for word* the headings of phases
   * 222 and 223 in `PHASES.md`. Somebody reading the queue to decide what to
   * build next would have picked up finished work.
   *
   * Matched on the title alone, so it catches the cheap and common case — the
   * same sentence written in both files — and nothing else. It cannot tell that
   * an open entry describes shipped work in *different* words, and it does not
   * pretend to: the convention this enforces is that closing a queue item means
   * striking it and naming its phase, which is what every closed entry above
   * item 3 already does.
   */
  test("a shipped item is struck through in the queue", () => {
    const next = read("docs/NEXT.md");
    // Every `## Phase N — Title` heading, by its title.
    const shipped = new Map(
      [...read("docs/PHASES.md").matchAll(/^## Phase (\d+) — (.+)$/gm)].map((m) => [
        m[2]!.trim().toLowerCase().replace(/\.$/, ""),
        Number(m[1]),
      ]),
    );
    // Every numbered queue entry's bolded title, and whether it is struck.
    const open: string[] = [];
    for (const entry of next.matchAll(/^\d+\. (~~)?\*\*(.+?)\.?\*\*/gm)) {
      if (entry[1] !== undefined) continue;
      const title = entry[2]!.trim().toLowerCase().replace(/\.$/, "");
      const phase = shipped.get(title);
      if (phase !== undefined) open.push(`"${entry[2]}" shipped as phase ${phase}`);
    }
    expect(open).toEqual([]);
  });
});
