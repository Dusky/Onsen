-- The data bank / document RAG (SPEC §11, §20 phase 30).
--
-- Documents are chunked and embedded, then recalled by similarity into the
-- prompt's `documents` block. The vector store is a pure-JS flat index: each
-- chunk's vector is JSON in `vector`, and cosine runs in the process. No
-- native module, no new dependency — and behind the retrieval module's
-- interface, so sqlite-vec can replace it later if a library outgrows it.

CREATE TABLE documents (
  id         INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid       TEXT    NOT NULL UNIQUE,
  -- Null means the document reaches every scene; set means this scene only.
  scene_id   INTEGER REFERENCES scenes (id) ON DELETE CASCADE,
  title      TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE document_chunks (
  id          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  ordinal     INTEGER NOT NULL,
  text        TEXT    NOT NULL,
  -- JSON array of floats. Null until embedded — a chunk that could not be
  -- embedded (no embeddings provider, no ONNX) is skipped, not fatal.
  vector      TEXT,
  created_at  INTEGER NOT NULL
) STRICT;
CREATE INDEX document_chunks_by_document ON document_chunks (document_id, ordinal);
CREATE INDEX documents_by_scene ON documents (scene_id);

-- The embeddings provider is its own single-row config, not a generation
-- provider: it serves /embeddings and nothing else, and the providers table's
-- kind CHECK rightly excludes it. Nulls mean the lexical fallback is in force.
CREATE TABLE embeddings_config (
  id                 INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
  base_url           TEXT,
  model              TEXT,
  api_key_encrypted  TEXT,
  updated_at         INTEGER NOT NULL
) STRICT;
