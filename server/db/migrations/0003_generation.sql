-- 0003 generation — SPEC §20 phase 4.
--
-- The server owns generation (SPEC §0.7): the client never talks to an
-- inference backend, and a generation survives the client that started it.
-- Mobile browsers suspend backgrounded tabs and drop connections on network
-- handoff, so a generation is a persistent record with a resumable buffer, not
-- a request-scoped operation.

CREATE TABLE generations (
  id                INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid              TEXT    NOT NULL UNIQUE,
  scene_id          INTEGER NOT NULL REFERENCES scenes (id) ON DELETE CASCADE,
  -- The message this generation will become, written on completion. Null while
  -- in flight, and null forever if it failed before producing anything.
  target_message_id INTEGER REFERENCES messages (id) ON DELETE SET NULL,
  -- Where the new message attaches. Held here rather than read from the scene at
  -- completion, so a leaf move mid-generation cannot silently reparent it.
  parent_id         INTEGER REFERENCES messages (id) ON DELETE CASCADE,
  status            TEXT    NOT NULL
                            CHECK (status IN ('pending', 'streaming', 'complete', 'cancelled', 'error')),
  -- Everything generated so far. Persisted periodically so a crash loses the
  -- last moment of output rather than all of it.
  buffer            TEXT    NOT NULL DEFAULT '',
  -- Characters of `buffer` durably written. The client resumes from an offset.
  offset            INTEGER NOT NULL DEFAULT 0,
  -- JSON: model, provider, sampler settings, time to first token, tokens/sec.
  meta              TEXT,
  error             TEXT,
  started_at        INTEGER NOT NULL,
  finished_at       INTEGER
) STRICT;

CREATE INDEX generations_scene ON generations (scene_id, id);
CREATE INDEX generations_status ON generations (status) WHERE status IN ('pending', 'streaming');

-- SPEC §2: model, provider, samplers, TTFT, tokens/sec, shown per message behind
-- a tap (§16). Added here because phase 4 is the first thing able to fill it.
ALTER TABLE messages ADD COLUMN generation_meta TEXT;
