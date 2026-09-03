/**
 * Salience, decay, and the retrieval blend (SPEC §11 layer 3).
 *
 * §11 gives three rules and this file is all three:
 *
 * - "Each carries a salience score derived from emotional weight, narrative
 *   significance, and information density."
 * - "High salience resists decay; low salience ages out."
 * - "Retrieval blends semantic similarity with salience, not similarity alone."
 *
 * Pure, and separate from both the extractor and the store, because the whole
 * feature is a ranking — and a ranking that could only be inspected by running
 * a model call against a live scene is one nobody can reason about.
 */

/** What the extractor is asked to judge, before they become one number. */
export interface SalienceSignals {
  /** How much feeling is attached to it. A death scores here; a door does not. */
  emotional: number;
  /** How much of the story turns on it. */
  narrative: number;
  /** How much it says that is not already obvious. */
  density: number;
}

/**
 * The three signals, weighted.
 *
 * Narrative significance leads because it is the one that predicts whether an
 * entity will matter *again*, which is the only thing retrieval is for.
 * Emotional weight is a good proxy for it and not the same thing — a
 * frightening night that changes nothing is vivid and irrelevant — and density
 * is a tiebreak: between two equally important facts, prefer the one that says
 * more per token.
 */
export function combineSalience(signals: SalienceSignals): number {
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const score =
    0.45 * clamp(signals.narrative) + 0.35 * clamp(signals.emotional) + 0.2 * clamp(signals.density);
  return Math.round(score * 1000) / 1000;
}

/**
 * How much of an entity's salience survives `turns` without a mention.
 *
 * Exponential rather than linear, and with a floor: a thing that mattered once
 * does not stop having happened, and a memory that decayed to zero would be
 * indistinguishable from one that was never extracted. The floor is a fraction
 * of the original rather than a constant, so a detail that was never important
 * fades much further than a death does — which is §11's "high salience resists
 * decay" stated as arithmetic rather than as a wish.
 */
export const HALF_LIFE_TURNS = 40;

export function decayed(salience: number, turnsSince: number): number {
  if (turnsSince <= 0) return salience;
  const floor = salience * salience; // 0.9 keeps 0.81; 0.2 keeps 0.04.
  const decayedValue = salience * Math.pow(0.5, turnsSince / HALF_LIFE_TURNS);
  return Math.round(Math.max(floor, decayedValue) * 1000) / 1000;
}

export interface Scorable {
  /** Cosine similarity to the query, 0-1. */
  similarity: number;
  /** The stored score, before decay. */
  salience: number;
  /** Turns since it was last mentioned. */
  turnsSince: number;
  /** §11: a reader's own edit is not something an algorithm gets to bury. */
  userEdited: boolean;
}

export interface Scored extends Scorable {
  /** What the ranking used. */
  score: number;
  /** Salience after decay, kept so the trace can show the two apart. */
  effectiveSalience: number;
}

/**
 * The blend.
 *
 * Similarity alone retrieves whatever the last message happened to rhyme with;
 * salience alone retrieves the same three things forever. Multiplying would let
 * either one veto the other, and a fact with everything to do with this moment
 * would be dropped for having been quiet. So it is a weighted sum, with a bonus
 * for anything the reader wrote themselves.
 */
export const USER_EDITED_BONUS = 0.15;

export function scoreMemory(item: Scorable): Scored {
  const effectiveSalience = decayed(item.salience, item.turnsSince);
  const blended = 0.6 * Math.max(0, Math.min(1, item.similarity)) + 0.4 * effectiveSalience;
  const score = Math.min(1, blended + (item.userEdited ? USER_EDITED_BONUS : 0));
  return { ...item, effectiveSalience, score: Math.round(score * 1000) / 1000 };
}

/** Below this a memory is not worth the tokens it would cost to carry. */
export const RECALL_FLOOR = 0.2;

export function rank<T extends Scorable>(items: T[], limit: number): (T & Scored)[] {
  return items
    .map((item) => ({ ...item, ...scoreMemory(item) }))
    .filter((item) => item.score >= RECALL_FLOOR)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
