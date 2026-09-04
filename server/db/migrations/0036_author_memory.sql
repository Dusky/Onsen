-- Author memory (SPEC §11, §20 phase 39).
--
-- "Implemented as a lorebook with `owner_author_id` set, so it reuses keyword
-- activation, budgeting, and the editor." The whole design is that sentence:
-- nothing here is a second retrieval mechanism, a second budget or a second
-- editor. An author's memory is a book, and §10 already knows what a book is.
ALTER TABLE lorebooks ADD COLUMN owner_author_id INTEGER
  REFERENCES authors (id) ON DELETE CASCADE;

-- One book per author. Two would both activate and the reader would edit one
-- and be confused by the other - the same argument dossiers and memory entities
-- both make, and the third place it has come up.
CREATE UNIQUE INDEX lorebooks_owner_author
  ON lorebooks (owner_author_id) WHERE owner_author_id IS NOT NULL;

-- Where an entry came from, so §11's "provenance showing the author wrote it"
-- is a column rather than a convention. Null for everything a reader wrote or
-- imported, which is every entry that existed before this migration.
ALTER TABLE lore_entries ADD COLUMN written_by TEXT
  CHECK (written_by IS NULL OR written_by IN ('author'));

-- What the scene was, when the author wrote it down. §11's author memory covers
-- "shared history across scenes", and an entry that cannot say which scene it
-- came out of is a note with no way back to the thing it is about.
ALTER TABLE lore_entries ADD COLUMN written_in_scene_id INTEGER
  REFERENCES scenes (id) ON DELETE SET NULL;
