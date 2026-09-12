-- 0075 character groups — SPEC §9, §20 phase 158.
--
-- A named cast, plus an optional lorebook, so a recurring set of characters
-- (and the world they play in) is one tap away from a new roleplay instead of
-- five picker taps. Two tables rather than a JSON column: a group is a list of
-- characters, and membership is what the editor and the roleplay-starter both
-- walk, so it earns a table of its own.

CREATE TABLE character_groups (
  id            INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid          TEXT    NOT NULL UNIQUE,
  name          TEXT    NOT NULL,
  -- The world the group's roleplays open into. Null for a group of characters
  -- with no particular setting; "start" binds it at scene scope.
  lorebook_id   INTEGER REFERENCES lorebooks (id) ON DELETE SET NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
) STRICT;

CREATE TABLE character_group_members (
  group_id      INTEGER NOT NULL REFERENCES character_groups (id) ON DELETE CASCADE,
  character_id  INTEGER NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, character_id)
) STRICT;

CREATE INDEX character_group_members_order ON character_group_members (group_id, display_order);
