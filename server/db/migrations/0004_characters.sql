-- 0004 characters — SPEC §20 phase 6.
--
-- The reusable definition of a role the author voices (SPEC §2).
--
-- `raw_card` is the load-bearing column. Lossy card parsing is the most common
-- migration failure in this ecosystem — RisuAI and Agnai both silently drop
-- advanced lorebook fields on import — so the complete original is stored
-- verbatim and export re-emits from it, overlaying only the fields this app
-- models. An extension field nobody here understands still survives a
-- round trip.

CREATE TABLE characters (
  id                        INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid                      TEXT    NOT NULL UNIQUE,
  name                      TEXT    NOT NULL,
  avatar_path               TEXT,

  -- Always in the prompt (SPEC §3).
  description               TEXT,
  personality               TEXT,
  scenario                  TEXT,

  first_message             TEXT,
  -- JSON string arrays. Both are among the fields other importers drop.
  alternate_greetings       TEXT    NOT NULL DEFAULT '[]',
  group_greetings           TEXT    NOT NULL DEFAULT '[]',
  example_dialogue          TEXT,

  -- Speech tics, vocabulary, rhythm. Injected only when spotlighted (§3).
  voice_notes               TEXT,

  -- From CCv2 extensions.depth_prompt: injected at a fixed depth whenever this
  -- character is present.
  depth_prompt              TEXT,
  depth_prompt_depth        INTEGER NOT NULL DEFAULT 4,
  depth_prompt_role         TEXT    NOT NULL DEFAULT 'system'
                                    CHECK (depth_prompt_role IN ('system', 'user', 'assistant')),

  system_prompt             TEXT,
  post_history_instructions TEXT,
  creator_notes             TEXT,
  tags                      TEXT    NOT NULL DEFAULT '[]',
  creator                   TEXT,
  character_version         TEXT,

  -- The complete original, byte-for-byte as it arrived.
  raw_card                  TEXT    NOT NULL,
  -- How it arrived, so export can offer the format it came from.
  raw_card_format           TEXT    NOT NULL
                                    CHECK (raw_card_format IN ('png_v2', 'png_v3', 'json', 'charx', 'native')),
  -- Everything under the card's `extensions` key, including what this app does
  -- not model.
  extensions                TEXT    NOT NULL DEFAULT '{}',

  -- Parsed-card cache (SPEC §9): re-parsing PNG metadata is a known
  -- performance sink with large libraries, especially on mobile. The card is
  -- parsed once into these columns; the hash invalidates it if the file
  -- underneath ever changes.
  source_filename           TEXT,
  source_hash               TEXT,

  created_at                INTEGER NOT NULL,
  updated_at                INTEGER NOT NULL
) STRICT;

CREATE INDEX characters_name ON characters (name);
-- A re-import of the same file is recognised rather than silently duplicated.
CREATE INDEX characters_source_hash ON characters (source_hash) WHERE source_hash IS NOT NULL;
