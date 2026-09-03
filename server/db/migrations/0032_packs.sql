-- Packs (SPEC §15 tier 2, §20 phase 34).
--
-- A shareable archive of everything §15 calls tier 1: characters, lorebooks,
-- presets, authors, option groups, regex scripts, triggers, ban phrases. All of
-- it is data; installing imports records and nothing executes.
--
-- The interesting requirement is the last one: "record which pack owns which
-- rows so uninstall is exact". That is what `pack_rows` is. Without it,
-- uninstall would be a guess - matching by name would take a character the user
-- renamed, or miss one they edited, or delete something they had made
-- themselves that happened to share a name.
CREATE TABLE packs (
  id           INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid         TEXT    NOT NULL UNIQUE,
  name         TEXT    NOT NULL,
  version      TEXT    NOT NULL,
  author       TEXT    NOT NULL DEFAULT '',
  description  TEXT    NOT NULL DEFAULT '',
  -- The range the pack declared, kept as written. Checked at install; kept
  -- afterwards so a pack installed against an older host can still say what it
  -- expected when something later goes wrong.
  host_api_range TEXT,
  installed_at INTEGER NOT NULL
) STRICT;

-- Two installs of the same pack at the same version would own overlapping rows
-- and uninstalling either would half-remove both.
CREATE UNIQUE INDEX packs_name_version ON packs (name COLLATE NOCASE, version);

-- What one install added. Not a foreign key to eight different tables - SQLite
-- has no polymorphic reference - so the pair is the address, and uninstall
-- deletes by it.
--
-- Deliberately by internal id rather than ULID: a ULID would need the target
-- table joined to be resolved, and the one thing this table must be able to do
-- is delete a row whose table it only knows by name.
CREATE TABLE pack_rows (
  id         INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  pack_id    INTEGER NOT NULL REFERENCES packs (id) ON DELETE CASCADE,
  table_name TEXT    NOT NULL,
  row_id     INTEGER NOT NULL,
  -- What it was called when it was installed, so an uninstall preview can say
  -- what is about to go even if the user has renamed it since.
  label      TEXT    NOT NULL DEFAULT ''
) STRICT;

CREATE INDEX pack_rows_pack ON pack_rows (pack_id);
CREATE UNIQUE INDEX pack_rows_unique ON pack_rows (pack_id, table_name, row_id);
