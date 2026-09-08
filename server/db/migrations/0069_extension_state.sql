-- 0069 extension state — SPEC §15, §20 phase 146.
--
-- Per-scene key/value storage for extensions. An extension writes what its
-- next turn needs to read — a rolling summary, a counter, an anchor — and the
-- host offers it back via the `{{state:<key>}}` task macro and the injection
-- `render` callback. Scoped by extension name so two suites cannot collide.

CREATE TABLE extension_state (
  extension_name TEXT    NOT NULL,
  scene_id       INTEGER NOT NULL REFERENCES scenes (id) ON DELETE CASCADE,
  key            TEXT    NOT NULL,
  value          TEXT    NOT NULL,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (extension_name, scene_id, key)
) STRICT;

CREATE INDEX extension_state_scene ON extension_state (scene_id, extension_name);
