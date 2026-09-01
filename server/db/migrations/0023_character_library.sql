-- The character library at scale (SPEC §9, §20 phase 26).
--
-- Search, folders, derivation, version history and saved filters. Four
-- additions and one virtual table, in one migration because they are one
-- feature: the library stops being a list and becomes something you can
-- search, sort, keep and undo.

-- A folder is a label, not a tree — the spec says "folders" in the loose
-- sense SillyTavern users mean it, and a full hierarchy is a phase 26
-- temptation that phase 43's polish can reconsider.
ALTER TABLE characters ADD COLUMN folder TEXT;

-- A derived card points back at the one it forked from (SPEC §9). NULL for an
-- original. ON DELETE SET NULL rather than CASCADE: a variant survives its
-- parent, which is the whole point of a variant.
ALTER TABLE characters ADD COLUMN parent_character_id INTEGER
  REFERENCES characters (id) ON DELETE SET NULL;

-- Snapshots on save, the same tree-shaped thinking §0.3 gives messages. The
-- snapshot is the state *before* the edit that produced it, so the earliest is
-- the card as imported and the newest is one save ago — restore is always a
-- step backwards, never a no-op that copies the current state onto itself.
CREATE TABLE character_versions (
  id           INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid         TEXT    NOT NULL UNIQUE,
  character_id INTEGER NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
  snapshot     TEXT    NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX character_versions_by_character ON character_versions (character_id, id DESC);

-- Saved filters: a name over a query the user wants back (SPEC §9).
CREATE TABLE saved_filters (
  id         INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid       TEXT    NOT NULL UNIQUE,
  name       TEXT    NOT NULL,
  query      TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

-- Full-text search. External-content FTS so the source of truth stays the
-- characters table and the index is maintained by triggers, not by the queries
-- that write characters.
CREATE VIRTUAL TABLE characters_fts USING fts5(
  name, description, personality, creator_notes,
  content='characters', content_rowid='id'
);

CREATE TRIGGER characters_fts_ai AFTER INSERT ON characters BEGIN
  INSERT INTO characters_fts(rowid, name, description, personality, creator_notes)
  VALUES (new.id, new.name, new.description, new.personality, new.creator_notes);
END;
CREATE TRIGGER characters_fts_ad AFTER DELETE ON characters BEGIN
  INSERT INTO characters_fts(characters_fts, rowid, name, description, personality, creator_notes)
  VALUES ('delete', old.id, old.name, old.description, old.personality, old.creator_notes);
END;
CREATE TRIGGER characters_fts_au AFTER UPDATE ON characters BEGIN
  INSERT INTO characters_fts(characters_fts, rowid, name, description, personality, creator_notes)
  VALUES ('delete', old.id, old.name, old.description, old.personality, old.creator_notes);
  INSERT INTO characters_fts(rowid, name, description, personality, creator_notes)
  VALUES (new.id, new.name, new.description, new.personality, new.creator_notes);
END;

-- The index does not retroactively see rows that existed before it did.
INSERT INTO characters_fts(characters_fts) VALUES ('rebuild');
