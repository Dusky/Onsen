import { describe, expect, test } from "bun:test";
import { WordPieceTokenizer } from "../server/embeddings/tokenizer.ts";
import { meanPoolNormalize } from "../server/embeddings/local.ts";

/**
 * The bundled embedding model's tokenizer and pooling (SPEC §11, §20 phase 137).
 *
 * Pure and model-free, so these are testable without downloading the ONNX file.
 */

const VOCAB = ["[PAD]", "[UNK]", "[CLS]", "[SEP]", "[MASK]", "the", "on", "##sen", "##ate", "city", "drowned"];

describe("the bundled tokenizer", () => {
  test("wraps in CLS and SEP, and splits words into subwords", () => {
    const t = new WordPieceTokenizer(VOCAB.join("\n"));
    const { ids, mask, typeIds } = t.encode("onsen");
    expect(ids[0]).toBe(2); // [CLS]
    expect(ids.at(-1)).toBe(3); // [SEP]
    expect(ids.length).toBeGreaterThan(2);
    expect(mask).toEqual(new Array(ids.length).fill(1));
    expect(typeIds).toEqual(new Array(ids.length).fill(0));
    // "onsen" is not in the vocab, so it becomes "on" + "##sen".
    expect(ids).toContain(VOCAB.indexOf("on"));
    expect(ids).toContain(VOCAB.indexOf("##sen"));
  });

  test("an unknown word becomes UNK", () => {
    const t = new WordPieceTokenizer(VOCAB.join("\n"));
    const { ids } = t.encode("zzzz");
    expect(ids).toContain(1); // [UNK]
  });
});

describe("mean pooling", () => {
  test("pools and normalises to unit length", () => {
    // A 2-sequence, 4-hidden "last_hidden_state".
    const data = new Float32Array([1, 1, 1, 1, 1, 1, 1, 1]);
    const vector = meanPoolNormalize(data, 2, 4);
    expect(vector).toHaveLength(4);
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    expect(norm).toBeCloseTo(1, 5);
  });
});
