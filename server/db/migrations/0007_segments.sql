-- 0007 beats — SPEC §20 phase 9.
--
-- A beat is one generation in which the author writes several characters
-- interacting (SPEC §3.5). The raw text stays canonical on the message; these
-- rows are the parsed view, used for rendering, per-character correction
-- (recast) and splitting a beat into separate messages.
--
-- Segments are stored for beats only. A spotlight message has exactly one
-- segment by definition (§2), and storing that row would be a copy of the
-- message's own content kept in sync for no reader; the read path derives it
-- instead, so callers still see one uniform shape.

CREATE TABLE message_segments (
  id           INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  message_id   INTEGER NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  ordinal      INTEGER NOT NULL,
  speaker_type TEXT    NOT NULL CHECK (speaker_type IN ('character', 'narration')),
  -- Null for narration, and for a labelled speaker who is not in the cast:
  -- the strict label is authoritative, so their lines stay a character's.
  character_id INTEGER REFERENCES characters (id) ON DELETE SET NULL,
  -- The name exactly as it was written. SPEC §2's MessageSegment does not list
  -- it, but without it an unresolved speaker's name is lost, and rendering a
  -- resolved one would need a character lookup per segment.
  speaker_label TEXT,
  content      TEXT    NOT NULL,
  expression   TEXT,
  -- Offsets into the parent message's content, covering the prose alone and not
  -- the speaker label. Replacing this range is what recast does; keeping the
  -- label outside it is what makes the splice re-parse to the same shape.
  char_start   INTEGER NOT NULL,
  char_end     INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX message_segments_order ON message_segments (message_id, ordinal);

-- Set when a beat arrived with no usable speaker labels and was preserved whole
-- as one narration segment (§3.5). The flag is what lets the UI say the parse
-- failed rather than presenting the result as deliberate narration.
ALTER TABLE messages ADD COLUMN parse_degraded INTEGER NOT NULL DEFAULT 0
  CHECK (parse_degraded IN (0, 1));
