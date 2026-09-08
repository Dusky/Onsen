-- 0064 vectorized lore entries — SPEC §10, §20 phase 138.
--
-- An entry can be marked vectorized: instead of keyword matching, its content
-- is embedded and retrieved by semantic similarity to the recent transcript.
-- `vector` is the cached embedding, set on save and cleared when vectorized
-- turns off; it is a cache, not a round-tripped field.

ALTER TABLE lore_entries ADD COLUMN vectorized INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lore_entries ADD COLUMN vector TEXT;
