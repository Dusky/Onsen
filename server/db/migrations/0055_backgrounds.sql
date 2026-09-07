-- Phase 108: a library of generated backgrounds.
--
-- The default install ships one (an onsen), and every generated background —
-- for the default or for a scene — lands here so a reader can pick among them.
-- One row holds the default; a scene's own background still wins over it.

CREATE TABLE backgrounds (
  id         INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid       TEXT    NOT NULL UNIQUE,
  path       TEXT    NOT NULL,
  prompt     TEXT,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX backgrounds_one_default ON backgrounds (is_default) WHERE is_default = 1;
