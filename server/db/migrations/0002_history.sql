-- 0002 history tree — SPEC §20 phase 2.
--
-- History is a tree, not a list (SPEC §0.3). Siblings under the same parent are
-- swipes; `scenes.active_leaf_id` names the current leaf, and walking parents
-- from it to a root yields the active history.
--
-- Scope note: the scene and message tables carry only the columns phase 2 uses.
-- The rest of their SPEC §2 columns arrive by ALTER TABLE with the phase that
-- gives them behaviour — `character_id` with characters (phase 6), `author_id`
-- and `persona_id` with author personas (phase 7), the turn strategy and cast
-- with group scenes (phase 8), `reasoning` with reasoning extraction (phase 17),
-- `generation_meta` with the generation service (phase 4). MessageSegment is
-- part of beats (phase 9) and is absent here: in phase 2 a message's content is
-- the whole of it.

CREATE TABLE scenes (
  id                    INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid                  TEXT    NOT NULL UNIQUE,
  title                 TEXT    NOT NULL,
  -- Where this scene generates. Both are nullable so a scene can outlive the
  -- profile it was started with rather than being deleted alongside it.
  preset_id             INTEGER REFERENCES presets (id) ON DELETE SET NULL,
  connection_profile_id INTEGER REFERENCES connection_profiles (id) ON DELETE SET NULL,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
) STRICT;

CREATE TABLE messages (
  id          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid        TEXT    NOT NULL UNIQUE,
  scene_id    INTEGER NOT NULL REFERENCES scenes (id) ON DELETE CASCADE,
  -- Null is a root. A scene may have several roots: alternate greetings are
  -- siblings at the top of the tree (SPEC §9).
  parent_id   INTEGER REFERENCES messages (id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL
                      CHECK (kind IN ('spotlight', 'beat', 'user', 'system', 'narrator', 'ooc')),
  author_type TEXT    NOT NULL
                      CHECK (author_type IN ('user', 'character', 'system', 'narrator', 'ooc')),
  content     TEXT    NOT NULL,
  -- Excluded from the prompt but still visible in the UI (SPEC §2).
  is_hidden   INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0, 1)),
  -- Cached token count, set to null on edit so the next build recounts.
  token_count INTEGER,
  created_at  INTEGER NOT NULL,
  edited_at   INTEGER
) STRICT;

-- Walking children (siblings of a parent) and listing a scene are the two hot
-- reads; the tree is traversed by parent_id constantly.
CREATE INDEX messages_scene ON messages (scene_id, id);
CREATE INDEX messages_parent ON messages (scene_id, parent_id, id);

-- Added after `messages` exists because the reference is circular: a scene
-- points at one of its messages, and every message points back at its scene.
-- ON DELETE SET NULL is the safety net; the tree operations move the pointer to
-- the surviving parent before deleting anything.
ALTER TABLE scenes
  ADD COLUMN active_leaf_id INTEGER REFERENCES messages (id) ON DELETE SET NULL;

-- SPEC §2: named save-points, distinct from branches. A branch forks the
-- timeline; a checkpoint is a bookmark you can return to and fork from later.
CREATE TABLE checkpoints (
  id         INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid       TEXT    NOT NULL UNIQUE,
  scene_id   INTEGER NOT NULL REFERENCES scenes (id) ON DELETE CASCADE,
  message_id INTEGER NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX checkpoints_scene ON checkpoints (scene_id, id);
