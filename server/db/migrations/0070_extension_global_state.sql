-- 0070 extension global state — SPEC §15, §20 phase 150.
--
-- App-wide key/value storage for extensions, where `extension_state` is
-- per-scene. A global store survives scene deletion; it is where an extension
-- keeps an index, a cache, or a preference that is about the app, not a chat.

CREATE TABLE extension_global_state (
  extension_name TEXT    NOT NULL,
  key            TEXT    NOT NULL,
  value          TEXT    NOT NULL,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (extension_name, key)
) STRICT;
