-- 0014 rolling summarisation — SPEC §20 phase 16.
--
-- SPEC §11 layer 1: the highest-leverage memory feature and the one to build
-- first. A background task condenses a run of old messages into a paragraph,
-- and the prompt carries the paragraph instead of the messages.
--
-- A summary covers a *range*, which is what makes it different from a guide: a
-- guide is the current state of something and there is one that counts, where a
-- summary is a permanent record of a stretch of story and they accumulate. Both
-- still have to answer the same question — what happens when the reader rewinds
-- — and the answer is the same one: a summary counts only when the last message
-- it covers is on the active path. Rewinding past a range therefore un-injects
-- the summary of it, and the branch that never had those messages never had
-- their summary either.

CREATE TABLE summaries (
  id         INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid       TEXT    NOT NULL UNIQUE,
  scene_id   INTEGER NOT NULL REFERENCES scenes (id) ON DELETE CASCADE,
  content    TEXT    NOT NULL,
  -- The range this summary covers, inclusive. `covers_to` is the anchor: it is
  -- the message that decides whether this summary is on the active path.
  covers_from_message_id INTEGER NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  covers_to_message_id   INTEGER NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  -- How many messages went into it, so the trigger can count what is left
  -- without walking the range.
  message_count INTEGER NOT NULL DEFAULT 0,
  -- Cached, because §11 injects these under a budget and the inspector states
  -- what everything costs.
  token_count INTEGER NOT NULL DEFAULT 0,
  -- 0 for a summary of messages, 1 for a summary of summaries, and so on.
  -- §11: "summaries stack: older summaries can be re-summarised when they
  -- themselves grow past a budget."
  level      INTEGER NOT NULL DEFAULT 0,
  -- Set when a higher-level summary has taken over this one's range. Kept
  -- rather than deleted: condensing is lossy, and the longer record is the one
  -- a reader will want back when the condensed version turns out to be wrong.
  superseded_by INTEGER REFERENCES summaries (id) ON DELETE SET NULL,
  -- True when a person wrote or rewrote this. §11: edits are marked so
  -- regeneration does not clobber them.
  is_edited  INTEGER NOT NULL DEFAULT 0 CHECK (is_edited IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX summaries_scene ON summaries (scene_id, id);

-- Per-scene summarisation settings (§11). On the scene rather than on the op
-- row because how far back to summarise is a property of *this* story — a
-- fast-moving scene and a slow one want different thresholds — where the model
-- that does the work is a global preference and lives on the op.

-- Whether the scene summarises at all. Off until a scene is long enough to
-- want it would be a nice default, but "it started doing something" is worse
-- than "it never did": the trigger thresholds already mean nothing happens
-- until there is enough story, so this is on.
ALTER TABLE scenes ADD COLUMN summarise INTEGER NOT NULL DEFAULT 1 CHECK (summarise IN (0, 1));
-- §11: triggered every N messages **or** N words, whichever comes first.
ALTER TABLE scenes ADD COLUMN summarise_every_messages INTEGER NOT NULL DEFAULT 20;
ALTER TABLE scenes ADD COLUMN summarise_every_words INTEGER NOT NULL DEFAULT 3000;
-- §11 injection threshold: only inject summaries covering messages older than
-- N, so recent history is not described and shown at once.
ALTER TABLE scenes ADD COLUMN summarise_threshold INTEGER NOT NULL DEFAULT 20;
-- §11 raw eviction: optionally drop raw messages once summarised and past the
-- threshold. Off by default — it saves the most and loses the most.
ALTER TABLE scenes ADD COLUMN summarise_evict INTEGER NOT NULL DEFAULT 0 CHECK (summarise_evict IN (0, 1));
-- §11 cache stability: only move the injection point every N turns, trading a
-- little staleness for a large saving. 1 means every turn, which is honest and
-- expensive; the default trades four turns of staleness for a stable prefix.
ALTER TABLE scenes ADD COLUMN summarise_freeze INTEGER NOT NULL DEFAULT 4;
