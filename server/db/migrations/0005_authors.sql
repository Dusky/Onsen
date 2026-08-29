-- 0005 authors and personas — SPEC §20 phase 7.
--
-- The defining bet of the product (SPEC §0.2): the AI is a co-author, not a
-- character. A single writing partner with its own personality puppets every
-- non-user character, like a GM running a table. The author is the identity in
-- the system prompt; characters are roles it plays.
--
-- This is why an author is its own entity rather than a flag on a scene: it is
-- reusable across scenes and persistent, and it is what the system prompt is
-- about.

CREATE TABLE authors (
  id              INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid            TEXT    NOT NULL UNIQUE,
  name            TEXT    NOT NULL,
  avatar_path     TEXT,

  -- Who the partner is as a collaborator.
  personality     TEXT,
  -- Prose style, tense, point of view, paragraph length.
  writing_style   TEXT,
  -- Pacing habits, how much it escalates, how it handles silence.
  directing_style TEXT,
  -- How it talks to the user out of character.
  ooc_voice       TEXT,
  -- Content it steers toward or away from.
  boundaries      TEXT,

  -- Opt-in cross-scene memory (§11). Off by default, and deliberately so: an
  -- author that silently accumulates notes about the user is a different
  -- product with different expectations. Nothing reads this until phase 41.
  memory_enabled  INTEGER NOT NULL DEFAULT 0 CHECK (memory_enabled IN (0, 1)),
  is_default      INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),

  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX authors_one_default ON authors (is_default) WHERE is_default = 1;

-- SPEC §2 Persona: who the *user* is. The counterpart to the author, and the
-- name the user-lock is stated in terms of — without it the most important
-- constraint in the system prompt has nothing to name.
CREATE TABLE personas (
  id          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid        TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  avatar_path TEXT,
  description TEXT,
  -- lorebook_id arrives with lorebooks in phase 19.
  is_default  INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX personas_one_default ON personas (is_default) WHERE is_default = 1;

-- Null author is single-character mode (SPEC §2, §3). Both are SET NULL rather
-- than CASCADE: deleting an author must not take the scenes it wrote with it.
ALTER TABLE scenes ADD COLUMN author_id INTEGER REFERENCES authors (id) ON DELETE SET NULL;
ALTER TABLE scenes ADD COLUMN persona_id INTEGER REFERENCES personas (id) ON DELETE SET NULL;

-- SPEC §2 SceneMember. Phase 7 needs only the link and an order; `is_active`,
-- per-scene `overrides` and `first_seen_message_id` (presence tracking) arrive
-- with group scenes in phase 8.
CREATE TABLE scene_members (
  id            INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  scene_id      INTEGER NOT NULL REFERENCES scenes (id) ON DELETE CASCADE,
  character_id  INTEGER NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX scene_members_unique ON scene_members (scene_id, character_id);
CREATE INDEX scene_members_scene ON scene_members (scene_id, display_order);

-- Which cast member a turn was voiced as (SPEC §2). Null for user, system and
-- narrator turns, and for anything generated before there was a cast.
ALTER TABLE messages ADD COLUMN character_id INTEGER REFERENCES characters (id) ON DELETE SET NULL;
