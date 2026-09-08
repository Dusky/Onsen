import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as ort from "onnxruntime-web";
import { WordPieceTokenizer } from "./tokenizer.ts";

/**
 * The bundled local embedding model (SPEC §11, §20 phase 137).
 *
 * A pure-WASM ONNX model — `all-MiniLM-L6-v2`, the same family SillyTavern
 * ships — run in-process with `onnxruntime-web`, so embeddings need no API key
 * and no external service. The model and vocabulary download once, on first
 * use, into the data directory, and are cached there; inference stays local.
 *
 * `onnxruntime-web` is WASM, not a native binary, so this keeps the app's "no
 * native modules" rule (§20 HANDOFF 7) intact.
 */

const MODEL_URL =
  "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_quantized.onnx";
const VOCAB_URL = "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/vocab.txt";

/** Where the model and vocabulary live. Set at boot to the data directory. */
let cacheDir = resolve(process.env.ONSEN_DATA_DIR ?? "./data");

/** The data directory, so the embedder caches beside the rest of the state. */
export function setLocalEmbeddingsDir(dir: string): void {
  cacheDir = dir;
}

let sessionPromise: Promise<ort.InferenceSession | null> | null = null;
let tokenizer: WordPieceTokenizer | null = null;

function wasmDir(): string {
  // Resolve the package's own dist folder so the .wasm files load from disk
  // rather than a CDN — the same choice SillyTavern makes.
  const entry = import.meta.resolve("onnxruntime-web");
  return dirname(fileURLToPath(entry));
}

async function ensureModel(): Promise<{ session: ort.InferenceSession; tokenizer: WordPieceTokenizer } | null> {
  if (sessionPromise === null) {
    sessionPromise = (async () => {
      ort.env.wasm.wasmPaths = `${wasmDir()}/`;
      const modelDir = join(cacheDir, "embeddings");
      const modelPath = join(modelDir, "model.onnx");
      const vocabPath = join(modelDir, "vocab.txt");

      if (!existsSync(modelPath) || !existsSync(vocabPath)) {
        mkdirSync(modelDir, { recursive: true });
        const [model, vocab] = await Promise.all([
          fetch(MODEL_URL).then((response) => (response.ok ? response.arrayBuffer() : null)),
          fetch(VOCAB_URL).then((response) => (response.ok ? response.text() : null)),
        ]);
        if (model === null || vocab === null) return null;
        writeFileSync(modelPath, Buffer.from(model));
        writeFileSync(vocabPath, vocab);
      }

      const session = await ort.InferenceSession.create(readFileSync(modelPath));
      tokenizer = new WordPieceTokenizer(readFileSync(vocabPath, "utf8"));
      return session;
    })();
    // A failed download must not poison the singleton: clear it so the next
    // call can try again (for example, once the reader is back online).
    sessionPromise.catch(() => {
      sessionPromise = null;
    });
  }
  const session = await sessionPromise;
  if (session === null || tokenizer === null) return null;
  return { session, tokenizer };
}

/** Mean-pool a `last_hidden_state` and L2-normalise it. */
export function meanPoolNormalize(data: Float32Array, seq: number, hidden: number): number[] {
  const vector = new Float32Array(hidden);
  for (let t = 0; t < seq; t += 1) {
    for (let h = 0; h < hidden; h += 1) vector[h] = (vector[h] ?? 0) + (data[t * hidden + h] ?? 0);
  }
  for (let h = 0; h < hidden; h += 1) vector[h] = vector[h]! / seq;
  let norm = 0;
  for (let h = 0; h < hidden; h += 1) norm += vector[h]! * vector[h]!;
  norm = Math.sqrt(norm) || 1;
  for (let h = 0; h < hidden; h += 1) vector[h] = vector[h]! / norm;
  return Array.from(vector);
}

/**
 * Embed texts with the local model. Never throws: on any failure — no network,
 * a bad model, a provider that vanished — it returns empty vectors, which the
 * store treats as "no embedding" and falls back to lexical retrieval.
 */
export async function embedLocally(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  try {
    const ready = await ensureModel();
    if (ready === null) return texts.map(() => []);
    const { session, tokenizer } = ready;

    const results: number[][] = [];
    for (const text of texts) {
      const { ids, mask, typeIds } = tokenizer.encode(text);
      const feed = {
        input_ids: new ort.Tensor("int64", BigInt64Array.from(ids.map((id) => BigInt(id))), [1, ids.length]),
        attention_mask: new ort.Tensor("int64", BigInt64Array.from(mask.map((m) => BigInt(m))), [1, mask.length]),
        token_type_ids: new ort.Tensor("int64", BigInt64Array.from(typeIds.map((t) => BigInt(t))), [1, typeIds.length]),
      };
      const output = await session.run(feed);
      const name = session.outputNames[0]!;
      const tensor = output[name] as ort.Tensor;
      const data = tensor.data as Float32Array;
      const dims = tensor.dims as number[];
      const [, seq, hidden] = dims as [number, number, number];
      results.push(meanPoolNormalize(data, seq, hidden));
    }
    return results;
  } catch {
    return texts.map(() => []);
  }
}
