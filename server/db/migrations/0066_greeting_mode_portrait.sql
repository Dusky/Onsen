-- 0066 greeting mode and a saved portrait prompt — SPEC §9, §20 phase 142.
--
-- A character's openings can open on the first, cycle through them, or pick
-- one at random; the counter drives cycle. A saved portrait prompt overrides
-- the auto-assembled one when the reader draws a portrait.

ALTER TABLE characters ADD COLUMN greeting_mode TEXT NOT NULL DEFAULT 'first';
ALTER TABLE characters ADD COLUMN greeting_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE characters ADD COLUMN image_prompt TEXT;
