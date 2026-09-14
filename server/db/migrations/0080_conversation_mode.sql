-- 0080 Conversation mode — §20 phase 213.
--
-- A per-scene messaging-client rendering of the same history tree: bubbles
-- left/right with timestamps instead of the manuscript column. The prompt and
-- the tree are untouched; this is a skin over the same turns. Off by default,
-- and defaulting on is deliberately not done here — existing scenes stay in
-- the prose shape the reader chose them in.

ALTER TABLE scenes ADD COLUMN conversation_mode INTEGER NOT NULL DEFAULT 0;
