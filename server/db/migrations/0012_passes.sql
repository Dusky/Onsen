-- 0012 post-generation pipeline — SPEC §20 phase 14.
--
-- SPEC §7.5: an ordered set of passes that run *after* a message is generated
-- and can revise it. The rationale is ReCast's and it is sound — a model cannot
-- go back once it has committed to a response, but a second model reading the
-- finished text can catch what the first one got wrong.
--
-- Voice validation is the flagship: one author voicing a whole cast is this
-- product's architecture, and voices converging is the risk that architecture
-- runs. A pass that reads a beat and names which part stopped sounding like
-- itself is the direct answer to it.

-- What a pass found. One row per pass per message — per *segment* for the
-- passes that read a beat part by part.
CREATE TABLE message_annotations (
  id            INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid          TEXT    NOT NULL UNIQUE,
  message_id    INTEGER NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  -- The op key of the pass that wrote this.
  pass_key      TEXT    NOT NULL,
  -- Null when the pass read the whole message rather than one part of a beat.
  segment_ordinal INTEGER,
  -- `ok` is recorded as well as `flagged`: "the voice pass ran and was happy"
  -- and "the voice pass never ran" are different things to know.
  status        TEXT    NOT NULL CHECK (status IN ('ok', 'flagged', 'revised', 'failed')),
  -- Written for a person and shown verbatim, like the director's reason (§6).
  detail        TEXT,
  -- What the message said before a `revised` pass changed it. SPEC §7.5: the
  -- original is always retained so the user can see and revert.
  original_content TEXT,
  created_at    INTEGER NOT NULL
) STRICT;

CREATE INDEX message_annotations_message ON message_annotations (message_id, id);

-- The last field of §7's per-op row (deferred in phase 13 until it had a
-- consumer). A pass with this off is still available by hand.
ALTER TABLE tasks ADD COLUMN auto_trigger INTEGER NOT NULL DEFAULT 0
  CHECK (auto_trigger IN (0, 1));

-- SPEC §7.5: auto-run per scene, or manual per message. The per-op switch says
-- which passes take part; this says whether a scene runs them without asking.
ALTER TABLE scenes ADD COLUMN auto_passes INTEGER NOT NULL DEFAULT 0
  CHECK (auto_passes IN (0, 1));

-- Set while the pipeline is still working on a message. The passes run off the
-- generation's path and must never delay it (§7), so the turn lands first and
-- its annotations arrive a moment later; this is what tells a client to look
-- again.
ALTER TABLE messages ADD COLUMN passes_pending INTEGER NOT NULL DEFAULT 0
  CHECK (passes_pending IN (0, 1));
