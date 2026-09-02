/**
 * The lexical fallback embedder (SPEC §11, §20 phase 30).
 *
 * No model, no network, no native module: a bag-of-words over a shared
 * vocabulary, weighted so rare words count more than common ones. It is not
 * semantic — "king" and "queen" are as far apart as "king" and "chair" — but
 * it retrieves on what a passage is *about* rather than on nothing, which is
 * the whole point of a fallback: the data bank works before any embeddings
 * provider is configured.
 */

export interface LexicalVocabulary {
  words: string[];
  documentFrequency: Map<string, number>;
}

/** Tokenise to lowercase word stems — punctuation stripped, nothing stemmed. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1);
}

/** Build a vocabulary over a whole corpus, for stable dimension sizes. */
export function buildVocabulary(corpus: string[]): LexicalVocabulary {
  const documentFrequency = new Map<string, number>();
  for (const text of corpus) {
    const seen = new Set<string>();
    for (const word of tokenize(text)) {
      if (!seen.has(word)) {
        seen.add(word);
        documentFrequency.set(word, (documentFrequency.get(word) ?? 0) + 1);
      }
    }
  }
  return {
    words: [...documentFrequency.keys()].sort(),
    documentFrequency,
  };
}

/**
 * A TF-IDF-flavoured vector: term frequency in this text, downweighted by how
 * common the word is across the corpus. The vocabulary fixes the dimension.
 */
export function lexicalVector(text: string, vocabulary: LexicalVocabulary): number[] {
  const tokens = tokenize(text);
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);

  return vocabulary.words.map((word) => {
    const tf = counts.get(word) ?? 0;
    if (tf === 0) return 0;
    const df = vocabulary.documentFrequency.get(word) ?? 1;
    return tf * (1 + Math.log(1 + 1 / df));
  });
}

/** Embed many texts against one shared vocabulary. */
export function embedLexical(texts: string[]): { vectors: number[][]; vocabulary: LexicalVocabulary } {
  const vocabulary = buildVocabulary(texts);
  return { vectors: texts.map((text) => lexicalVector(text, vocabulary)), vocabulary };
}
