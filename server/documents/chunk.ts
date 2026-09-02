/**
 * Chunking a document for the data bank (SPEC §11, §20 phase 30).
 *
 * Pure and deterministic: paragraphs are the unit, small ones merge until a
 * chunk reaches a target size, and a paragraph bigger than the target is split
 * on sentences. No embeddings knowledge here — this only decides what a
 * retrievable unit is.
 */

const DEFAULT_TARGET_CHARS = 1_200;

/** Split on sentence boundaries without losing the punctuation. */
function splitSentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]*/g)?.map((part) => part.trim()).filter((part) => part !== "") ?? [
    text.trim(),
  ];
}

export function chunkText(text: string, targetChars = DEFAULT_TARGET_CHARS): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");

  const chunks: string[] = [];
  let current = "";

  const push = (paragraph: string) => {
    if (current === "") {
      current = paragraph;
      return;
    }
    if (current.length + paragraph.length + 2 <= targetChars) {
      current = `${current}\n\n${paragraph}`;
      return;
    }
    chunks.push(current);
    current = paragraph;
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length <= targetChars) {
      push(paragraph);
      continue;
    }
    // One paragraph bigger than a chunk: split on sentences and re-merge.
    const sentences = splitSentences(paragraph);
    for (const sentence of sentences) {
      if (current !== "" && current.length + sentence.length + 1 <= targetChars) {
        current = `${current} ${sentence}`;
        continue;
      }
      if (current !== "") chunks.push(current);
      current = sentence;
    }
  }
  if (current !== "") chunks.push(current);

  return chunks;
}
