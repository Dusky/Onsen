-- 0026 structured trackers — SPEC §20 phase 31.
--
-- §8's second flavour of scene state: strict JSON rather than free prose. The
-- failure modes differ from guides exactly as §8 says — there is a parse step
-- now, and the rule is that a parse failure keeps the previous state and logs,
-- because a tracker that wipes itself on a malformed reply is worse than no
-- tracker. Versioned per message, pinned like guides, and token-costed.

CREATE TABLE trackers (
  id          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid        TEXT    NOT NULL UNIQUE,
  scene_id    INTEGER NOT NULL REFERENCES scenes (id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL
                      CHECK (kind IN ('scene', 'characters')),
  -- The tracker's state as JSON — the schema is enforced at parse, not at store.
  content     TEXT    NOT NULL,
  message_id  INTEGER REFERENCES messages (id) ON DELETE CASCADE,
  token_count INTEGER NOT NULL DEFAULT 0,
  is_pinned   INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
) STRICT;

CREATE INDEX trackers_scene ON trackers (scene_id, kind, id);
