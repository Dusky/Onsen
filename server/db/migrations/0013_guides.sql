-- 0013 persistent guides — SPEC §20 phase 15.
--
-- SPEC §8: state a background task writes once and the prompt injects every
-- turn until it is flushed. Free-form prose rather than structured output,
-- deliberately: there is no parse step, so there is nothing to fail. Trackers
-- are the structured flavour and are a later phase; the spec is explicit that
-- both ship because they fail differently.
--
-- The interesting requirement is the last line of §8's guides section:
-- **versioned per message, so rewinding rewinds them.** A guide is not one
-- mutable row per scene — it is a row per version, anchored to the message the
-- version was written after, and the one that counts is the newest whose anchor
-- is on the active path. Swiping away from a turn therefore swipes away the
-- state that turn produced, which is the only behaviour that makes sense once
-- history is a tree.

CREATE TABLE guides (
  id         INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid       TEXT    NOT NULL UNIQUE,
  scene_id   INTEGER NOT NULL REFERENCES scenes (id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL
                     CHECK (kind IN ('situational', 'thinking', 'clothes', 'state', 'rules', 'custom')),
  content    TEXT    NOT NULL,
  -- The message this version was written after. Null means it predates any
  -- message, which is where a hand-written guide on an empty scene lands.
  message_id INTEGER REFERENCES messages (id) ON DELETE CASCADE,
  -- Cached, because SPEC §8 requires Show to state the cost and the design
  -- expresses every cost as a share of the context window.
  token_count INTEGER NOT NULL DEFAULT 0,
  -- True when a person edited this version, so a refresh can leave it alone
  -- rather than overwriting what they wrote.
  is_pinned  INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX guides_scene ON guides (scene_id, kind, id);

-- The user's own words for the custom guide, which has no built-in question:
-- SPEC §8 calls it a free-form user-defined injection, so what to ask is
-- entirely theirs. Kept on the scene rather than the op row because a custom
-- guide is about *this* story, not a global setting.
ALTER TABLE scenes ADD COLUMN custom_guide_prompt TEXT;
