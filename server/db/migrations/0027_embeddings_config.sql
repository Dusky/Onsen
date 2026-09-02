-- 0027 embeddings config — the table migration 0025 was meant to carry.
--
-- The data bank's embeddings provider is its own single-row config, not a
-- generation provider: it serves /embeddings and nothing else, and the
-- providers table's kind CHECK rightly excludes it. Nulls mean the lexical
-- fallback is in force.
--
-- It was briefly written into 0025 after that migration had already been
-- applied to a live database — the classic "edited an applied migration" trap,
-- and the migration lint test cannot catch it (the file stays registered). It
-- lives here instead, so both fresh databases and that one converge.
CREATE TABLE embeddings_config (
  id                 INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
  base_url           TEXT,
  model              TEXT,
  api_key_encrypted  TEXT,
  updated_at         INTEGER NOT NULL
) STRICT;
