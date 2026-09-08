import type { Database } from "bun:sqlite";
import { decryptSecret, type Keyring } from "../lib/crypto.ts";
import { embedLocally } from "../embeddings/local.ts";

/**
 * The embedder (SPEC §11, §20 phase 30): text in, dense vectors out.
 *
 * The default source is the bundled local ONNX model (phase 137) — no API key,
 * no external service. A configured OpenAI-compatible `/embeddings` endpoint
 * (Ollama, LM Studio, llama.cpp server, or hosted) always wins when present.
 * The lexical fallback lives in the store, because lexical vectors are only
 * meaningful against a shared corpus vocabulary — they cannot be computed one
 * text at a time the way a model's can.
 */

export interface EmbeddingsProvider {
  baseUrl: string;
  model: string;
  apiKey: string | null;
}

export type EmbeddingsSource = "local" | "endpoint" | "lexical";

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

/** The configured source, or the default (local). */
export function embeddingsSource(db: Database): EmbeddingsSource {
  const row = db.query("SELECT source FROM embeddings_config WHERE id = 1").get() as
    | { source: string | null }
    | null;
  const source = row?.source;
  return source === "endpoint" || source === "lexical" ? source : "local";
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

/** The embedding path in force: a configured provider, the local model, or lexical. */
export function resolveEmbedder(db: Database, keyring: Keyring): {
  kind: "embeddings" | "lexical";
  embed(texts: string[]): Promise<number[][]>;
} {
  const provider = findEmbeddingsProvider(db, keyring);
  if (provider !== null) {
    return { kind: "embeddings", embed: (texts) => embedViaProvider(provider, texts) };
  }
  if (embeddingsSource(db) === "lexical") {
    return { kind: "lexical", embed: () => Promise.resolve([]) };
  }
  // The bundled local model is the default: it returns empty vectors on any
  // failure, which the store reads as "no embedding" and falls back to lexical.
  return { kind: "embeddings", embed: (texts) => embedLocally(texts) };
}
