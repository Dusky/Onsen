/**
 * Noticing a character the scene keeps returning to (SPEC §11, §20 phase 32).
 *
 * A dossier is for "the innkeeper who turned out to matter", which means
 * something has to notice that they did. This is that: a pure pass over the
 * transcript that returns capitalised names appearing often enough to be worth
 * a sheet, minus everyone who already has one.
 *
 * Deliberately not a model call. Asking a model "who recurs here" costs a
 * request per turn to answer a question about string frequency, and it would be
 * wrong in a way nobody could debug. The model is asked one question — what
 * this character is like — and only once a name has earned it.
 *
 * The whole thing is heuristic and will have false positives; that is why
 * nothing is written without the reader accepting it (§9's proposal pattern).
 */

/**
 * Words that begin a sentence and are capitalised for that reason alone.
 *
 * Not a stopword list of English — a list of the words that actually survive
 * the name filter and are not names. Sentence-initial capitals are the whole
 * problem with finding names this way.
 */
const NOT_NAMES = new Set([
  "the", "a", "an", "and", "but", "or", "so", "then", "when", "where", "what", "who",
  "why", "how", "if", "as", "at", "by", "for", "from", "in", "into", "of", "on", "to",
  "with", "he", "she", "it", "they", "you", "i", "we", "his", "her", "their", "your",
  "my", "our", "its", "this", "that", "these", "those", "there", "here", "now", "not",
  "no", "yes", "one", "two", "three", "first", "last", "next", "still", "again", "just",
  "only", "even", "after", "before", "over", "under", "up", "down", "out", "off", "back",
  "something", "nothing", "someone", "nobody", "everything", "anyone",
]);

export interface RecurringName {
  name: string;
  /** How many separate messages mentioned it. */
  mentions: number;
}

export interface RecurrenceInput {
  /** The messages to read, oldest first. Prose only — asides are not the story. */
  messages: string[];
  /** Names that already have a card or a dossier, case-insensitive. */
  known: string[];
  /**
   * How many separate messages must mention a name. Counted in messages rather
   * than occurrences: a name said three times in one line is one moment, and a
   * name said once in three turns is a character who keeps coming back.
   */
  threshold: number;
}

/** Capitalised words, with possessives and trailing punctuation removed. */
function candidatesIn(text: string): Set<string> {
  const found = new Set<string>();
  // Words that start with a capital and continue in lower case. Deliberately
  // not matching ALL-CAPS: the transcript's own speaker labels are uppercase,
  // and every one of them would be a false positive.
  const pattern = /\b([A-Z][a-z]{2,})(?:'s)?\b/g;
  let match = pattern.exec(text);
  while (match !== null) {
    const word = match[1]!;
    if (!NOT_NAMES.has(word.toLowerCase())) found.add(word);
    match = pattern.exec(text);
  }
  return found;
}

/**
 * Names mentioned in at least `threshold` separate messages and not already
 * known, most-mentioned first.
 */
export function recurringNames(input: RecurrenceInput): RecurringName[] {
  const known = new Set(input.known.map((name) => name.trim().toLowerCase()));
  const counts = new Map<string, { name: string; mentions: number }>();

  for (const message of input.messages) {
    for (const candidate of candidatesIn(message)) {
      const key = candidate.toLowerCase();
      if (known.has(key)) continue;
      const entry = counts.get(key) ?? { name: candidate, mentions: 0 };
      entry.mentions += 1;
      counts.set(key, entry);
    }
  }

  return [...counts.values()]
    .filter((entry) => entry.mentions >= input.threshold)
    .sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name));
}
