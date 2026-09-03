import type { Database } from "bun:sqlite";
import { ulid } from "../lib/ulid.ts";
import type { Keyring } from "../lib/crypto.ts";
import { chunkText } from "./chunk.ts";
import { cosine } from "./similarity.ts";
import { buildVocabulary, lexicalVector } from "./lexical.ts";
import { resolveEmbedder } from "./embedder.ts";

/**
 * The data bank's store and retrieval (SPEC §11, §20 phase 30).
 *
 * Retrieval runs here, in the I/O layer — never in the prompt builder, which
 * stays pure. The provider path stores each chunk's vector and compares the
 * query against them; the lexical path recomputes vectors over the corpus on
 * every query, because lexical vectors are only meaningful against a shared
 * vocabulary and a corpus changes as documents arrive.
 */

export interface RetrievedChunk {
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  text: string;
  score: number;
}

export interface DocumentRow {
  id: number;
  ulid: string;
  scene_id: number | null;
  title: string;
  created_at: number;
  updated_at: number;
}

export function listDocuments(db: Database, sceneId: number | null): DocumentRow[] {
  return db
    .query(
      `SELECT * FROM documents
        WHERE scene_id = $scene OR scene_id IS NULL
        ORDER BY created_at DESC`,
    )
    .all({ scene: sceneId }) as DocumentRow[];
}

export function findDocument(db: Database, value: string): DocumentRow | null {
  return (db.query("SELECT * FROM documents WHERE ulid = $ulid").get({ ulid: value }) ??
    null) as DocumentRow | null;
}

export function deleteDocument(db: Database, id: number): void {
  db.query("DELETE FROM documents WHERE id = $id").run({ id });
}

export interface NewDocument {
  title: string;
  text: string;
  sceneId: number | null;
}

/** Chunk, embed and store a document. Returns the number of chunks written. */
export async function ingestDocument(
  db: Database,
  keyring: Keyring,
  input: NewDocument,
): Promise<DocumentRow> {
  const now = Date.now();
  const document = db
    .query(
      `INSERT INTO documents (ulid, scene_id, title, created_at, updated_at)
       VALUES ($ulid, $scene, $title, $now, $now) RETURNING *`,
    )
    .get({ ulid: ulid(), scene: input.sceneId, title: input.title, now }) as DocumentRow;

  const chunks = chunkText(input.text);
  const embedder = resolveEmbedder(db, keyring);
  const vectors = embedder.kind === "embeddings" ? await embedder.embed(chunks) : [];

  const insert = db.query(
    `INSERT INTO document_chunks (document_id, ordinal, text, vector, created_at)
     VALUES ($document, $ordinal, $text, $vector, $now)`,
  );
  for (let ordinal = 0; ordinal < chunks.length; ordinal += 1) {
    insert.run({
      document: document.id,
      ordinal,
      text: chunks[ordinal]!,
      vector: vectors[ordinal] === undefined ? null : JSON.stringify(vectors[ordinal]),
      now,
    });
  }
  return document;
}

/** The chunks a scene can retrieve: its own, plus every global document. */
function chunksFor(db: Database, sceneId: number | null): {
  documentId: string;
  documentTitle: string;
  ordinal: number;
  text: string;
  vector: string | null;
}[] {
  const rows = db
    .query(
      `SELECT c.document_id AS document, c.ordinal, c.text, c.vector, d.ulid AS docUlid, d.title
         FROM document_chunks c
         JOIN documents d ON d.id = c.document_id
        WHERE d.scene_id = $scene OR d.scene_id IS NULL
        ORDER BY d.created_at DESC, c.ordinal`,
    )
    .all({ scene: sceneId }) as {
    document: number;
    ordinal: number;
    text: string;
    vector: string | null;
    docUlid: string;
    title: string;
  }[];
  return rows.map((row) => ({
    documentId: row.docUlid,
    documentTitle: row.title,
    ordinal: row.ordinal,
    text: row.text,
    vector: row.vector,
  }));
}

/** Recall the top-K chunks for a query, with their scores (§11). */
/**
 * Embed some texts, or null where there is no provider.
 *
 * Exposed because §11's narrative memory needs the same provider this store
 * resolves — a second resolution path would let the two disagree about which
 * model made a vector, and vectors from different models do not compare.
 */
export async function embedTexts(
  db: Database,
  keyring: Keyring,
  texts: string[],
): Promise<number[][] | null> {
  if (texts.length === 0) return [];
  const embedder = resolveEmbedder(db, keyring);
  if (embedder.kind !== "embeddings") return null;
  return embedder.embed(texts);
}

export async function retrieve(
  db: Database,
  keyring: Keyring,
  sceneId: number | null,
  query: string,
  topK = 4,
): Promise<RetrievedChunk[]> {
  const chunks = chunksFor(db, sceneId);
  if (chunks.length === 0) return [];

  const embedder = resolveEmbedder(db, keyring);
  if (embedder.kind === "embeddings") {
    const [queryVector] = await embedder.embed([query]);
    if (queryVector === undefined || queryVector.length === 0) return [];
    const scored = chunks
      .filter((chunk) => chunk.vector !== null)
      .map((chunk) => {
        let vector: number[];
        try {
          vector = JSON.parse(chunk.vector!) as number[];
        } catch {
          return null;
        }
        return { chunk, score: cosine(queryVector, vector) };
      })
      .filter((entry): entry is { chunk: (typeof chunks)[number]; score: number } => entry !== null);
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ chunk, score }) => ({
        documentId: chunk.documentId,
        documentTitle: chunk.documentTitle,
        chunkIndex: chunk.ordinal,
        text: chunk.text,
        score,
      }));
  }

  // Lexical: one vocabulary over the corpus plus the query, so the dimensions
  // agree by construction.
  const texts = chunks.map((chunk) => chunk.text);
  const vocabulary = buildVocabulary([...texts, query]);
  const queryVector = lexicalVector(query, vocabulary);
  const scored = chunks.map((chunk, index) => ({
    chunk,
    score: cosine(queryVector, lexicalVector(texts[index]!, vocabulary)),
  }));
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .filter((entry) => entry.score > 0)
    .map(({ chunk, score }) => ({
      documentId: chunk.documentId,
      documentTitle: chunk.documentTitle,
      chunkIndex: chunk.ordinal,
      text: chunk.text,
      score,
    }));
}
