/**
 * The lorebook activation model (SPEC §10).
 *
 * Pure, and deliberately so: given entries, a transcript window, a cast, and
 * the timed-effect state, it decides what fires and why. No database, no
 * randomness of its own, no clock. That is what makes the hardest part of this
 * feature — six interacting rules that each individually look simple — testable
 * at all.
 *
 * The rules run in a fixed order, and the order *is* the behaviour:
 *
 *   1. **Enabled, delayed, cooling down.** An entry that cannot fire at all
 *      never reaches the matcher.
 *   2. **Constant, or matched.** Constants skip scanning entirely.
 *   3. **Secondary keys**, which qualify a primary match rather than causing
 *      one.
 *   4. **Character filter** — §10 calls this essential for a shared group
 *      lorebook, and it is: it is the only way two characters in one scene can
 *      know different things.
 *   5. **Sticky, then probability.** Sticky bypasses probability by design; an
 *      entry that rolled well once should not have to keep rolling well for the
 *      duration it was granted.
 *   6. **Inclusion groups**, applied last, because a group picks a winner from
 *      whatever survived everything else.
 *
 * Recursion then re-runs the whole thing over the text just injected, level by
 * level, until nothing new fires or the cap is reached.
 */

import type { LoreInsertionPosition, PromptRole } from "../prompt/types.ts";

export type SecondaryLogic = "and_any" | "and_all" | "not_any" | "not_all";
export type GroupSelection = "weight" | "prioritize" | "score";
export type DelayFrom = "scene_start" | "branch_point";

/** One entry, as the engine sees it. Ids are ULIDs; nothing here is a row. */
export interface LoreCandidate {
  id: string;
  title: string;
  content: string;
  enabled: boolean;

  keys: string[];
  secondaryKeys: string[];
  secondaryLogic: SecondaryLogic;
  caseSensitive: boolean;
  matchWholeWords: boolean;
  useRegex: boolean;
  probability: number;
  isConstant: boolean;
  /** Null falls back to the book's depth. */
  scanDepth: number | null;
  /** Character ULIDs. Empty means every character. */
  characterFilter: string[];

  sticky: number;
  cooldown: number;
  delay: number;
  delayFrom: DelayFrom;

  inclusionGroup: string | null;
  groupWeight: number;
  groupSelection: GroupSelection;

  position: LoreInsertionPosition;
  insertionOrder: number;
  insertionDepth: number;
  insertionRole: PromptRole;
  outletName: string | null;

  recursionLevel: number;
  nonRecursable: boolean;
  preventFurtherRecursion: boolean;

  /** The book it came from, for per-book budgets and for the trace. */
  bookId: string;
  bookScanDepth: number;
  bookTokenBudget: number;
}

/** What the scene knows about an entry that has fired before. */
export interface TimedState {
  entryId: string;
  /** How many messages ago it last fired, counted along the active path. */
  messagesAgo: number;
}

export interface ActivationInput {
  entries: LoreCandidate[];
  /**
   * The scan window, newest last. One string per message; the engine slices
   * per entry, since scan depth is per entry.
   */
  transcript: string[];
  /** ULIDs of characters in play, for the character filter. */
  presentCharacterIds: string[];
  timed: TimedState[];
  /** Messages in the scene, for `delay`. */
  messageCount: number;
  /** Messages since this branch began, for `delay_from = branch_point`. */
  messagesSinceBranch: number;
  /** Deterministic, seeded per generation: §10's probability must be replayable. */
  random: () => number;
  /** §10's recursion cap, from the book. */
  recursionCap: number;
  /** Counts tokens for the per-book budget. */
  countTokens: (text: string) => number;
}

export type SkipReason =
  | "disabled"
  | "delayed"
  | "cooling_down"
  | "no_match"
  | "secondary_keys"
  | "character_filter"
  | "probability"
  | "group_not_chosen"
  | "book_budget";

export interface ActivationTrace {
  entryId: string;
  title: string;
  /** Which key matched, for the inspector's "why did this fire" line. */
  matchedKey: string | null;
  /** 0 for the first pass; higher once recursion picked it up. */
  round: number;
  sticky: boolean;
  constant: boolean;
  skipped: SkipReason | null;
}

export interface ActivationResult {
  activated: LoreCandidate[];
  /** Every entry considered, fired or not, with the reason (§3's inspector). */
  trace: ActivationTrace[];
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether one key appears in the haystack.
 *
 * Whole-word matching is the default and the reason is practical: an entry
 * keyed on "ash" that fires on "washed" is the single most common complaint
 * about world info, and word boundaries fix it without anybody learning a
 * pattern language. A key with no word characters at its edges — punctuation,
 * CJK — cannot use boundaries, so it falls back to substring rather than
 * silently never matching.
 */
export function keyMatches(
  haystack: string,
  key: string,
  options: { caseSensitive: boolean; matchWholeWords: boolean; useRegex: boolean },
): boolean {
  const needle = key.trim();
  if (needle === "") return false;
  const flags = options.caseSensitive ? "" : "i";

  if (options.useRegex) {
    try {
      return new RegExp(needle, flags).test(haystack);
    } catch {
      // A broken pattern is the user's typo, not a reason to fail a generation.
      return false;
    }
  }

  if (options.matchWholeWords && /^\w/.test(needle) && /\w$/.test(needle)) {
    return new RegExp(`\\b${escapeRegex(needle)}\\b`, flags).test(haystack);
  }

  return options.caseSensitive
    ? haystack.includes(needle)
    : haystack.toLowerCase().includes(needle.toLowerCase());
}

/** The first primary key that matches, or null. */
function firstMatch(entry: LoreCandidate, haystack: string): string | null {
  for (const key of entry.keys) {
    if (keyMatches(haystack, key, entry)) return key;
  }
  return null;
}

/** §10's four secondary logics, which qualify a primary match. */
function secondaryPasses(entry: LoreCandidate, haystack: string): boolean {
  const keys = entry.secondaryKeys.filter((key) => key.trim() !== "");
  if (keys.length === 0) return true;
  const hits = keys.filter((key) => keyMatches(haystack, key, entry));

  switch (entry.secondaryLogic) {
    case "and_any":
      return hits.length > 0;
    case "and_all":
      return hits.length === keys.length;
    case "not_any":
      return hits.length === 0;
    case "not_all":
      return hits.length < keys.length;
  }
}

/* ------------------------------------------------------------------ */
/* Inclusion groups (§10)                                              */
/* ------------------------------------------------------------------ */

interface Scored {
  entry: LoreCandidate;
  /** How many primary keys matched, for `score` selection. */
  score: number;
}

function chooseFromGroup(members: Scored[], random: () => number): LoreCandidate {
  const first = members[0]!;
  switch (first.entry.groupSelection) {
    case "prioritize": {
      // Deterministic: the lowest insertion order wins, which is the same
      // "lower goes first" rule the builder uses everywhere else.
      return members.reduce((best, item) =>
        item.entry.insertionOrder < best.entry.insertionOrder ? item : best,
      ).entry;
    }
    case "score": {
      const best = members.reduce((top, item) => (item.score > top.score ? item : top));
      return best.entry;
    }
    case "weight": {
      const total = members.reduce((sum, item) => sum + Math.max(0, item.entry.groupWeight), 0);
      // Every weight zero is a group nobody weighted; falling back to the first
      // is better than dividing by nothing.
      if (total <= 0) return first.entry;
      let roll = random() * total;
      for (const item of members) {
        roll -= Math.max(0, item.entry.groupWeight);
        if (roll < 0) return item.entry;
      }
      return members.at(-1)!.entry;
    }
  }
}

/* ------------------------------------------------------------------ */
/* The engine                                                          */
/* ------------------------------------------------------------------ */

export function activateLore(input: ActivationInput): ActivationResult {
  // One row per entry, holding its *final* outcome rather than a log of
  // attempts. An entry that missed on the first pass and fired on the second
  // should read as "fired, round 1" — the inspector's question is what happened
  // to this entry, not how many times it was considered.
  const trace = new Map<string, ActivationTrace>();
  const chosen = new Map<string, LoreCandidate>();
  // §10: "when entries share a group label, only one is inserted." Once a group
  // has a winner it is settled for this activation — otherwise a loser comes
  // back through recursion and the group inserts twice.
  const settledGroups = new Set<string>();
  const timedBy = new Map(input.timed.map((state) => [state.entryId, state.messagesAgo]));

  const note = (
    entry: LoreCandidate,
    round: number,
    skipped: SkipReason | null,
    matchedKey: string | null = null,
    sticky = false,
  ) => {
    trace.set(entry.id, {
      entryId: entry.id,
      title: entry.title,
      matchedKey,
      round,
      sticky,
      constant: entry.isConstant,
      skipped,
    });
  };

  /** The window an entry scans, joined. */
  const windowFor = (entry: LoreCandidate): string => {
    const depth = entry.scanDepth ?? entry.bookScanDepth;
    return input.transcript.slice(-Math.max(0, depth)).join("\n");
  };

  /**
   * One pass over everything not already chosen.
   *
   * `extra` is the text injected by the previous round — recursion scans what
   * was just added, not the transcript again.
   */
  function pass(round: number, extra: string, levels: number[]): LoreCandidate[] {
    const survivors: Scored[] = [];

    for (const level of levels) {
      // §10: entries are grouped by level and "matched only after lower levels
      // are exhausted", so a level that produces nothing hands over to the next.
      const atLevel = input.entries.filter(
        (entry) =>
          entry.recursionLevel === level &&
          !chosen.has(entry.id) &&
          // A group that already picked is closed: §10 inserts one member, and
          // without this a loser matches again on the next recursion round.
          !(entry.inclusionGroup !== null && settledGroups.has(entry.inclusionGroup)),
      );

      for (const entry of atLevel) {
        if (!entry.enabled) {
          if (round === 0) note(entry, round, "disabled");
          continue;
        }

        // Delay: the scene has to be old enough. Measured from whichever origin
        // the entry asks for — §10 names measuring only from the start of the
        // whole chat as the limitation to avoid.
        const age =
          entry.delayFrom === "branch_point" ? input.messagesSinceBranch : input.messageCount;
        if (entry.delay > 0 && age < entry.delay) {
          if (round === 0) note(entry, round, "delayed");
          continue;
        }

        const agoValue = timedBy.get(entry.id);
        const isSticky = entry.sticky > 0 && agoValue !== undefined && agoValue < entry.sticky;

        // Cooldown, which §10 notes chains naturally after sticky expires.
        if (
          !isSticky &&
          entry.cooldown > 0 &&
          agoValue !== undefined &&
          agoValue < entry.cooldown
        ) {
          if (round === 0) note(entry, round, "cooling_down");
          continue;
        }

        const haystack = round === 0 ? windowFor(entry) : extra;

        let matchedKey: string | null = null;
        let score = 0;
        if (!entry.isConstant && !isSticky) {
          matchedKey = firstMatch(entry, haystack);
          if (matchedKey === null) {
            if (round === 0) note(entry, round, "no_match");
            continue;
          }
          score = entry.keys.filter((key) => keyMatches(haystack, key, entry)).length;
          if (!secondaryPasses(entry, haystack)) {
            note(entry, round, "secondary_keys", matchedKey);
            continue;
          }
        }

        // §10's character filter: the only way two characters in one scene can
        // hold different knowledge from one shared book.
        if (
          entry.characterFilter.length > 0 &&
          !entry.characterFilter.some((id) => input.presentCharacterIds.includes(id))
        ) {
          note(entry, round, "character_filter", matchedKey);
          continue;
        }

        // Sticky bypasses probability until it expires: an entry that rolled
        // well once should not have to keep rolling well for a duration it was
        // already granted.
        if (!isSticky && entry.probability < 100 && input.random() * 100 >= entry.probability) {
          note(entry, round, "probability", matchedKey);
          continue;
        }

        survivors.push({ entry, score });
      }

      if (survivors.length > 0) break;
    }

    // Inclusion groups last: a group picks a winner from what survived.
    const grouped = new Map<string, Scored[]>();
    const ungrouped: LoreCandidate[] = [];
    for (const item of survivors) {
      const group = item.entry.inclusionGroup;
      if (group === null || group === "") ungrouped.push(item.entry);
      else grouped.set(group, [...(grouped.get(group) ?? []), item]);
    }

    const winners = [...ungrouped];
    for (const [group, members] of grouped) {
      const winner = chooseFromGroup(members, input.random);
      winners.push(winner);
      settledGroups.add(group);
      for (const item of members) {
        if (item.entry.id !== winner.id) note(item.entry, round, "group_not_chosen");
      }
    }

    for (const entry of winners) {
      chosen.set(entry.id, entry);
      const sticky = entry.sticky > 0 && (timedBy.get(entry.id) ?? Infinity) < entry.sticky;
      note(entry, round, null, entry.isConstant ? null : firstMatch(entry, haystackFor(entry, round, extra)), sticky);
    }
    return winners;
  }

  function haystackFor(entry: LoreCandidate, round: number, extra: string): string {
    return round === 0 ? windowFor(entry) : extra;
  }

  const levels = [...new Set(input.entries.map((entry) => entry.recursionLevel))].sort(
    (a, b) => a - b,
  );

  let round = 0;
  let injected = pass(round, "", levels);

  // §10: injected entries can trigger further entries, with a cap. An entry
  // marked non-recursable contributes no text to the next scan; one marked
  // prevent-further-recursion ends it outright.
  while (round < input.recursionCap && injected.length > 0) {
    if (injected.some((entry) => entry.preventFurtherRecursion)) break;
    const feed = injected
      .filter((entry) => !entry.nonRecursable)
      .map((entry) => entry.content)
      .join("\n");
    if (feed.trim() === "") break;
    round += 1;
    injected = pass(round, feed, levels);
  }

  // §10's per-book budget: lowest priority drops first. Priority here is
  // insertion order, which is the same "lower goes first" the builder uses.
  const activated = applyBookBudgets([...chosen.values()], input.countTokens, trace);

  return { activated, trace: [...trace.values()] };
}

function applyBookBudgets(
  entries: LoreCandidate[],
  countTokens: (text: string) => number,
  trace: Map<string, ActivationTrace>,
): LoreCandidate[] {
  const byBook = new Map<string, LoreCandidate[]>();
  for (const entry of entries) {
    byBook.set(entry.bookId, [...(byBook.get(entry.bookId) ?? []), entry]);
  }

  const kept: LoreCandidate[] = [];
  for (const [, members] of byBook) {
    const budget = members[0]?.bookTokenBudget ?? 0;
    if (budget <= 0) {
      kept.push(...members);
      continue;
    }
    // Lowest insertion order is highest priority, so it is filled first and a
    // constant entry is not treated as more important than the order says.
    const ordered = [...members].sort((a, b) => a.insertionOrder - b.insertionOrder);
    let spent = 0;
    for (const entry of ordered) {
      const cost = countTokens(entry.content);
      if (spent + cost > budget) {
        const at = trace.get(entry.id);
        if (at !== undefined) at.skipped = "book_budget";
        continue;
      }
      spent += cost;
      kept.push(entry);
    }
  }
  return kept;
}
