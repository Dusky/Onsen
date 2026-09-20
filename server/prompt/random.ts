/**
 * Deterministic randomness for the macro engine. The prompt builder is pure, so
 * anything random is a function of a seed passed in: the same context always
 * produces the same prompt, which is what makes {{roll}} and {{random}}
 * testable and a rebuilt prompt reproducible in the inspector.
 */

/** FNV-1a, for deriving a stable seed from a string key. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 — small, fast, and good enough for picking from a list. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * "d20", "2d6" — anything else yields no roll.
 *
 * Here rather than in `macros.ts` since §20 phase 233, because the Tabletop
 * extension rolls too and two implementations of one die would disagree within
 * a phase or two. §22's rule is "don't roll dice in the model", and the half
 * that protects is this function: randomness is settled server-side off an
 * injectable RNG and reaches the model as fact it narrates.
 *
 * The bounds are deliberate. A count over 100 or a die with more than a
 * million sides is a typo or an attack, not a roll, and returning `null` lets
 * the caller leave the text alone rather than render a number nobody meant.
 */
export function rollDice(spec: string, next: () => number): string | null {
  const match = /^(\d*)d(\d+)$/i.exec(spec.trim());
  if (match === null) return null;
  const count = match[1] === "" || match[1] === undefined ? 1 : Number(match[1]);
  const sides = Number(match[2]);
  if (count < 1 || count > 100 || sides < 1 || sides > 1_000_000) return null;
  let total = 0;
  for (let i = 0; i < count; i++) total += 1 + Math.floor(next() * sides);
  return String(total);
}
