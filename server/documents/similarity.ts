/**
 * Vector similarity for the flat index (SPEC §11, §20 phase 30).
 *
 * Cosine over dense vectors, in the process, with no dependency. The vectors
 * come either from an embeddings provider or from the lexical fallback; both
 * produce plain number arrays and neither needs anything more than this.
 */

export function dot(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let sum = 0;
  for (let index = 0; index < length; index += 1) sum += a[index]! * b[index]!;
  return sum;
}

function norm(a: number[]): number {
  let sum = 0;
  for (const value of a) sum += value * value;
  return Math.sqrt(sum);
}

/** Cosine similarity, clamped to [-1, 1]. Returns 0 for a zero vector. */
export function cosine(a: number[], b: number[]): number {
  const denominator = norm(a) * norm(b);
  if (denominator === 0) return 0;
  const value = dot(a, b) / denominator;
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}
