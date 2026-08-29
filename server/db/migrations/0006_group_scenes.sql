-- 0006 group scenes — SPEC §20 phase 8.
--
-- A scene can now hold several characters, and something has to decide who
-- speaks next (SPEC §6). The author model is what makes this safe: one writing
-- partner voices whoever is spotlighted, rather than several independent agents
-- taking turns, which is where group roleplay breaks everywhere else (§0.2).

-- SPEC §6. `mention` and `classifier` are accepted by the schema but not yet
-- implemented; the director falls back and says so rather than silently doing
-- something else.
ALTER TABLE scenes ADD COLUMN turn_strategy TEXT NOT NULL DEFAULT 'manual'
  CHECK (turn_strategy IN ('manual', 'round_robin', 'mention', 'classifier'));

-- A benched character stays in the cast and keeps their history, but is not
-- chosen to speak and is not offered as a spotlight.
ALTER TABLE scene_members ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1
  CHECK (is_active IN (0, 1));

-- Presence tracking (SPEC §6). Named for what it actually holds: the last
-- message that had already happened when this character joined. SPEC §2 calls
-- the field `first_seen_message_id`, but the first message a joining character
-- witnesses does not exist yet at the moment they join, so storing the leaf
-- under that name would be off by one in the only place it is read.
-- Null means they were present from the start.
ALTER TABLE scene_members ADD COLUMN joined_after_message_id INTEGER
  REFERENCES messages (id) ON DELETE SET NULL;
