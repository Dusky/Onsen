/**
 * Name and keyword matching for SPEC §6's `mention` turn strategy.
 *
 * Pure and separate from `director.ts` for the same reason the director is
 * separate from `turn.ts`: the rule for "was this character addressed?" is
 * fiddly enough to deserve its own tests, and the director stays a function of
 * plain data.
 */
import type { DirectorCandidate } from "./director.ts";

/** What a candidate answers to: their name, plus whatever the card configures. */
export interface MentionTerms {
  candidate: DirectorCandidate;
  terms: string[];
}

/**
 * Everything a candidate answers to.
 *
 * The card carries "Mira Vance" and the reader types "Mira", so the first word
 * of a multi-word name counts as naming them — otherwise the strategy would
 * fire only for people who address the cast by their full names, which is
 * nobody. Two characters sharing a first name both match and the later position
 * in the sentence wins, which is the same rule as everywhere else here; a
 * keyword is how you tell them apart on purpose.
 */
export function termsFor(candidate: DirectorCandidate): MentionTerms {
  const given = candidate.name.trim().split(/\s+/)[0] ?? "";
  const terms = [candidate.name, ...(candidate.mentionKeywords ?? [])];
  if (given !== "" && given.toLowerCase() !== candidate.name.trim().toLowerCase()) {
    terms.push(given);
  }
  return { candidate, terms };
}

/**
 * Regex-escape, because a name is user data. A character called "Dr. J" would
 * otherwise compile "." into "match any character" and answer to "DrXJ".
 */
function escape(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Where a term last appears in the text, or -1.
 *
 * Whole-word, because the alternative is a strategy that fires on fragments:
 * "Al" would be addressed by "already", and every scene with a short name in it
 * would look broken. `\b` is wrong at the edges of a term that starts or ends
 * with punctuation ("Dr." ends on a non-word character, where `\b` needs a word
 * one), so the boundary is asserted by lookaround on word characters instead —
 * which degrades to "no boundary needed on that side" exactly when the term
 * itself supplies one.
 */
function lastIndexOfTerm(text: string, term: string): number {
  const trimmed = term.trim();
  if (trimmed === "") return -1;

  const before = /^\w/.test(trimmed) ? "(?<!\\w)" : "";
  const after = /\w$/.test(trimmed) ? "(?!\\w)" : "";
  const pattern = new RegExp(`${before}${escape(trimmed)}${after}`, "giu");

  let found = -1;
  for (const match of text.matchAll(pattern)) found = match.index;
  return found;
}

/** Who was addressed, and by which word — the director quotes it as its reason. */
export interface Mention {
  candidate: DirectorCandidate;
  term: string;
}

/**
 * Who the text addresses, or null.
 *
 * The *last* match wins. "Ana, ask Bell about it" names two people and is
 * addressed to Bell; reading left to right would hand it to Ana, which is the
 * wrong half of the sentence. Ties — the same position can only come from the
 * same match — fall to the earlier candidate in display order, which is the
 * order the caller supplies.
 */
export function mentionedIn(text: string, candidates: MentionTerms[]): Mention | null {
  let best: Mention | null = null;
  let bestAt = -1;

  for (const { candidate, terms } of candidates) {
    for (const term of terms) {
      const at = lastIndexOfTerm(text, term);
      if (at > bestAt) {
        best = { candidate, term: term.trim() };
        bestAt = at;
      }
    }
  }

  return best;
}
