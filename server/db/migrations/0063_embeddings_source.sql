-- 0063 embeddings source — SPEC §11, §20 phase 137.
--
-- The data bank's embeddings gain a source: the bundled local ONNX model
-- (default), a configured OpenAI-compatible endpoint, or the lexical fallback.
-- The local model needs no API key and no external service, which is the whole
-- point of shipping it.

ALTER TABLE embeddings_config ADD COLUMN source TEXT NOT NULL DEFAULT 'local';
