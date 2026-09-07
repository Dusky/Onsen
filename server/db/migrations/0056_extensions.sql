-- Phase 110: installed extensions, with their code.
--
-- A data pack is a directory; a code extension is that plus a server module.
-- This records what is installed and where its module lives, so startup can
-- reload it and uninstall can remove it.

CREATE TABLE extensions (
  id         INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid       TEXT    NOT NULL UNIQUE,
  name       TEXT    NOT NULL,
  version    TEXT    NOT NULL DEFAULT '1.0.0',
  author     TEXT    NOT NULL DEFAULT '',
  dir        TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
