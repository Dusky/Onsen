import type { Tokenizer } from "./types.ts";

/**
 * The fallback token counter (SPEC §3): a character-ratio estimate with a
 * safety margin, always labelled as an estimate.
 *
 * The ratio deliberately over-counts. An underestimate overflows the provider's
 * context and the request fails; an overestimate costs a little unused headroom.
 * English prose runs near four characters per token, so counting at 3.6 leaves
 * roughly a ten percent margin, and prose with heavy punctuation or markup —
 * which roleplay has a lot of — tokenizes worse than plain text.
 */
const CHARS_PER_TOKEN = 3.6;

export function createEstimatingTokenizer(id = "estimate"): Tokenizer {
  return {
    id,
    isEstimate: true,
    count(text: string): number {
      if (text.length === 0) return 0;
      return Math.ceil(text.length / CHARS_PER_TOKEN);
    },
  };
}

/**
 * Wrap a provider's real tokenizer. Kept separate from the estimator so that
 * `isEstimate` is never accidentally true for a counter that is exact.
 */
export function createExactTokenizer(id: string, count: (text: string) => number): Tokenizer {
  return { id, isEstimate: false, count };
}
