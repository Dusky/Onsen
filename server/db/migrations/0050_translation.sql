-- Phase 78: display-only chat translation.
--
-- The decision is display-only, the way §14's `display_only` regex stage is:
-- the stored text and the prompt keep the language the author writes in, and
-- translation is a viewing layer. So the target language is a scene setting,
-- and a translation is a separate row per message, read only when the DTO for
-- the log is built. Nothing here changes what the model sees.
ALTER TABLE scenes ADD COLUMN translate_to TEXT;

CREATE TABLE message_translations (
  id         INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  language   TEXT    NOT NULL,
  text       TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (message_id, language)
) STRICT;
