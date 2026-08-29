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
