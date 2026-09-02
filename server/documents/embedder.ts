import type { Database } from "bun:sqlite";
import { decryptSecret, type Keyring } from "../lib/crypto.ts";

/**
 * The embedder (SPEC §11, §20 phase 30): text in, dense vectors out.
 *
 * The primary implementation calls an OpenAI-compatible `/embeddings` endpoint
 * — the "secondary embeddings provider" the reader configures, which covers
 * localhost stacks (Ollama, LM Studio, llama.cpp server) and hosted ones
 * alike. The fallback is lexical and lives in the store, because lexical
 * vectors are only meaningful against a shared corpus vocabulary — they cannot
 * be computed one text at a time the way a provider's can.
 *
 * An ONNX embedder is the future third implementation: native, opt-in, and
 * dropped in here rather than threaded through the rest of the system.
 */

export interface EmbeddingsProvider {
  baseUrl: string;
  model: string;
  apiKey: string | null;
}

export function findEmbeddingsProvider(db: Database, keyring: Keyring): EmbeddingsProvider | null {
  const row = db
    .query("SELECT base_url, model, api_key_encrypted FROM embeddings_config WHERE id = 1")
    .get() as { base_url: string | null; model: string | null; api_key_encrypted: string | null } | null;
  if (row === null || row.base_url === null || row.model === null) return null;
  return {
    baseUrl: row.base_url.replace(/\/+$/, ""),
    model: row.model,
    apiKey: row.api_key_encrypted === null ? null : decryptSecret(keyring, row.api_key_encrypted),
  };
}

/** Embed via an OpenAI-compatible `/embeddings` endpoint. */
export async function embedViaProvider(
  provider: EmbeddingsProvider,
  texts: string[],
): Promise<number[][]> {
  const response = await fetch(`${provider.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(provider.apiKey === null ? {} : { Authorization: `Bearer ${provider.apiKey}` }),
    },
    body: JSON.stringify({ model: provider.model, input: texts }),
  });
  if (!response.ok) {
    throw new Error(`The embeddings provider answered ${response.status}.`);
  }
  const body = (await response.json()) as { data?: { embedding?: number[] }[] };
  const data = body.data ?? [];
  // Trust the provider's own dimension: every chunk and every query goes
  // through the same model, so they agree, and padding a 768-dim local model
  // up to 1536 would silently break the cosine math.
  return texts.map((_, index) => data[index]?.embedding ?? []);
}

/** The embedding path in force: a configured provider, or lexical. */
export function resolveEmbedder(db: Database, keyring: Keyring): {
  kind: "embeddings" | "lexical";
  embed(texts: string[]): Promise<number[][]>;
} {
  const provider = findEmbeddingsProvider(db, keyring);
  if (provider !== null) {
    return { kind: "embeddings", embed: (texts) => embedViaProvider(provider, texts) };
  }
  // Lexical is resolved by the store, which holds the corpus; this shell is
  // replaced there and only signals which path is in force.
  return { kind: "lexical", embed: () => Promise.resolve([]) };
}
