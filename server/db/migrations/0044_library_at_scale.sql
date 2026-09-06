-- 0044 the library at scale — SPEC §9, §16, §20 phase 59.
--
-- A roleplay could be searched and sorted (phase 54) and organised in no other
-- way. The install this replaces runs 139 chats behind tags, folders and
-- favourites, and `ScenesScreen` carried a comment predicting exactly this:
-- "if a library ever gets big enough to hurt, the fix is pagination, and that
-- is the change that should move this."
--
-- Shaped after the character library (0023), because the two lists should
-- filter the same way and one of them already worked: `tags` is a JSON array
-- queried with `json_each`, and a folder is a label rather than a tree.
ALTER TABLE scenes ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE scenes ADD COLUMN folder TEXT;

-- Favourites on both lists, not one. A star that works on roleplays and not on
-- characters is the half-measure this project keeps finding in itself.
ALTER TABLE scenes ADD COLUMN is_favourite INTEGER NOT NULL DEFAULT 0
  CHECK (is_favourite IN (0, 1));
ALTER TABLE characters ADD COLUMN is_favourite INTEGER NOT NULL DEFAULT 0
  CHECK (is_favourite IN (0, 1));

-- Partial, because the query that wants it always wants the favourites only.
CREATE INDEX scenes_favourite ON scenes (updated_at DESC) WHERE is_favourite = 1;
CREATE INDEX characters_favourite ON characters (name) WHERE is_favourite = 1;
