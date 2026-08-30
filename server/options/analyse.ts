/**
 * Finding what a scene keeps reaching for (SPEC §13.6).
 *
 * §13.6's instruction is the design: "recurrence is measurable, so measure it
 * rather than guessing." So the counting is code — exact, free, and repeatable
 * — and the model is only asked the part that actually needs judgement, which
 * is whether a phrase that recurs is a tic or is simply the story: a character's
 * name, a place, a thing they say on purpose.
 *
 * Asking a model to read twenty messages and report its impression of the
 * repetition would get both halves wrong. It cannot count, and it has no way to
 * know which repetitions the author wanted.
 */

/** Word runs of this length are what read as a phrase rather than a collocation. */
const MIN_WORDS = 3;
const MAX_WORDS = 6;
/** Seen this many times before it is worth anybody's attention. */
const MIN_HITS = 3;

export interface PhraseCount {
  phrase: string;
  hits: number;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    // Punctuation splits a phrase: something said across a comma is two
    // phrases, not one six-word one.
    .split(/[^a-z0-9'’-]+/)
    .filter((word) => word !== "");
}

/**
 * Word runs that appear at least `minHits` times across the given texts.
 *
 * Only the longest form of an overlapping run is kept. "the air hung heavy" and
 * "air hung heavy" recur exactly as often as each other, and proposing both
 * would put two versions of one problem in front of the user.
 */
export function repeatedPhrases(
  texts: string[],
  { minHits = MIN_HITS }: { minHits?: number } = {},
): PhraseCount[] {
  const counts = new Map<string, number>();

  for (const text of texts) {
    const tokens = words(text);
    // Counted once per message: a phrase used twice in one turn is a stylistic
    // choice within it, where the same phrase in five turns is a habit.
    const seen = new Set<string>();
    for (let size = MIN_WORDS; size <= MAX_WORDS; size += 1) {
      for (let at = 0; at + size <= tokens.length; at += 1) {
        const phrase = tokens.slice(at, at + size).join(" ");
        if (seen.has(phrase)) continue;
        seen.add(phrase);
        counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
      }
    }
  }

  const kept = [...counts.entries()]
    .filter(([, hits]) => hits >= minHits)
    .map(([phrase, hits]) => ({ phrase, hits }))
    // Longest first, so a shorter run contained in one already kept can be
    // recognised and dropped.
    .sort((a, b) => b.phrase.length - a.phrase.length || b.hits - a.hits);

  const result: PhraseCount[] = [];
  for (const candidate of kept) {
    const swallowed = result.some(
      (chosen) => chosen.hits === candidate.hits && chosen.phrase.includes(candidate.phrase),
    );
    if (!swallowed) result.push(candidate);
  }
  return result.sort((a, b) => b.hits - a.hits);
}

/** The question put to a model about candidates the counter found. */
export function analyseQuestion(template: string, candidates: PhraseCount[]): string {
  return template.replace(
    "{{candidates}}",
    candidates.map((item) => `- "${item.phrase}" (${item.hits} turns)`).join("\n"),
  );
}

/**
 * Read the model's answer back.
 *
 * Tolerant in the same way the classifier is: a list is what was asked for, and
 * a model that numbers it, bullets it, or quotes the phrases has still answered.
 * Anything that is not one of the candidates is dropped rather than trusted —
 * a phrase the model invented is not evidence of anything.
 */
export function parseAnalysis(text: string, candidates: PhraseCount[]): PhraseCount[] {
  const byPhrase = new Map(candidates.map((item) => [item.phrase.toLowerCase(), item]));
  const chosen: PhraseCount[] = [];

  for (const raw of text.split("\n")) {
    const line = raw
      .trim()
      .replace(/^[-*\d.)\s]+/, "")
      .replace(/^["'“”]|["'“”]$/g, "")
      .trim()
      .toLowerCase();
    if (line === "") continue;
    const hit = byPhrase.get(line);
    if (hit !== undefined && !chosen.includes(hit)) chosen.push(hit);
  }
  return chosen;
}

/**
 * Phrases the ban list already covers, matched the way the scan matches.
 *
 * Case-insensitive substring, because that is what a ban means to a reader:
 * "the air hung heavy" and "The air hung heavy with" are the same offence.
 */
export function findBanned(text: string, bans: string[]): string[] {
  const haystack = text.toLowerCase();
  return bans.filter((phrase) => {
    const needle = phrase.trim().toLowerCase();
    return needle !== "" && haystack.includes(needle);
  });
}
