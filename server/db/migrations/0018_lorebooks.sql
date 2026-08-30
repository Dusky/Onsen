-- 0018 lorebooks and world info — SPEC §20 phase 21, SPEC §10.
--
-- The largest single subsystem in the product, and the one with the most prior
-- art to be careful about: SillyTavern's world info is the feature this
-- audience knows best, and the one they have the most specific complaints
-- about. §10 names those complaints, so the schema is shaped to make the right
-- behaviour expressible rather than to mirror what exists elsewhere.

CREATE TABLE lorebooks (
  id          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid        TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  description TEXT,
  -- §10: a per-lorebook token budget, with the lowest-priority entries dropped
  -- when it is exceeded. Zero means no budget of its own — the prompt's overall
  -- budget still applies, as it does to everything.
  token_budget INTEGER NOT NULL DEFAULT 0,
  -- How far back keyword matching looks, in messages. Per-entry override below.
  scan_depth  INTEGER NOT NULL DEFAULT 4,
  -- §10: injected entries can trigger further entries, with a cap.
  recursion_depth INTEGER NOT NULL DEFAULT 2,
  -- Round-tripping (§10 interop): the original import, verbatim, so unknown
  -- fields survive an export. The same rule as `characters.raw_card`, and for
  -- the same reason — lossy round-tripping is this ecosystem's standard failure.
  raw_import  TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
) STRICT;

CREATE TABLE lore_entries (
  id          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid        TEXT    NOT NULL UNIQUE,
  lorebook_id INTEGER NOT NULL REFERENCES lorebooks (id) ON DELETE CASCADE,
  title       TEXT    NOT NULL DEFAULT '',
  content     TEXT    NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),

  /* ---------------- activation (§10) ---------------- */

  -- JSON string arrays. Primary keys are what the scan looks for; secondary
  -- keys qualify a match through `secondary_logic`.
  keys        TEXT    NOT NULL DEFAULT '[]',
  secondary_keys TEXT NOT NULL DEFAULT '[]',
  secondary_logic TEXT NOT NULL DEFAULT 'and_any'
                  CHECK (secondary_logic IN ('and_any', 'and_all', 'not_any', 'not_all')),
  case_sensitive   INTEGER NOT NULL DEFAULT 0 CHECK (case_sensitive IN (0, 1)),
  match_whole_words INTEGER NOT NULL DEFAULT 1 CHECK (match_whole_words IN (0, 1)),
  use_regex   INTEGER NOT NULL DEFAULT 0 CHECK (use_regex IN (0, 1)),
  -- Percent. 100 is "always, once matched"; below that it is a dice roll, which
  -- is why the roll is seeded per generation rather than left to Math.random.
  probability INTEGER NOT NULL DEFAULT 100 CHECK (probability BETWEEN 0 AND 100),
  -- Always injected, no scanning. §10 calls these constant entries.
  is_constant INTEGER NOT NULL DEFAULT 0 CHECK (is_constant IN (0, 1)),
  -- Null uses the lorebook's scan depth; an entry can look further or less far.
  scan_depth  INTEGER,
  -- §10: "essential when a group shares one lorebook and cast members should
  -- hold different knowledge." A JSON array of character ULIDs; empty means
  -- every character. Stored as ULIDs rather than ids so an export is portable.
  character_filter TEXT NOT NULL DEFAULT '[]',

  /* ---------------- timed effects (§10) ---------------- */

  -- All in messages. 0 is off for each.
  sticky      INTEGER NOT NULL DEFAULT 0,
  cooldown    INTEGER NOT NULL DEFAULT 0,
  delay       INTEGER NOT NULL DEFAULT 0,
  -- §10 names the SillyTavern limitation to avoid: a delay measured only from
  -- the start of the whole chat is useless in a long scene. Both are offered.
  delay_from  TEXT    NOT NULL DEFAULT 'scene_start'
              CHECK (delay_from IN ('scene_start', 'branch_point')),

  /* ---------------- inclusion groups (§10) ---------------- */

  -- Entries sharing a label: only one is inserted.
  inclusion_group TEXT,
  group_weight    INTEGER NOT NULL DEFAULT 100,
  -- How the winner is picked when several in a group match.
  group_selection TEXT NOT NULL DEFAULT 'weight'
                  CHECK (group_selection IN ('weight', 'prioritize', 'score')),

  /* ---------------- insertion (§3, §10) ---------------- */

  position    TEXT    NOT NULL DEFAULT 'before_history'
              CHECK (position IN ('before_character', 'after_character', 'before_examples',
                                  'after_examples', 'before_history', 'at_depth', 'outlet')),
  insertion_order INTEGER NOT NULL DEFAULT 100,
  insertion_depth INTEGER NOT NULL DEFAULT 4,
  insertion_role  TEXT NOT NULL DEFAULT 'system'
                  CHECK (insertion_role IN ('system', 'user', 'assistant')),
  outlet_name TEXT,

  /* ---------------- recursion (§10) ---------------- */

  -- Entries are matched level by level: a level only runs once the ones below
  -- it have stopped producing matches.
  recursion_level INTEGER NOT NULL DEFAULT 0,
  -- This entry's text is never scanned for further matches.
  non_recursable  INTEGER NOT NULL DEFAULT 0 CHECK (non_recursable IN (0, 1)),
  -- Activating this entry ends recursion entirely.
  prevent_further_recursion INTEGER NOT NULL DEFAULT 0
                  CHECK (prevent_further_recursion IN (0, 1)),

  -- §10's automation ids: an action fired on activation. Stored now because it
  -- is part of an imported entry and dropping it would break round-tripping;
  -- nothing dispatches on it until regex scripts and event triggers arrive.
  automation_id TEXT,
  -- The entry as imported, for the same round-tripping reason as `raw_import`.
  raw_entry   TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
) STRICT;

CREATE INDEX lore_entries_book ON lore_entries (lorebook_id, enabled);

-- What a lorebook is attached to. §10 has one lorebook serving a whole group,
-- and §2 wants a persona to carry its own; a character can bring one along with
-- its card. One table rather than three columns, so a book can serve several
-- things at once and an unbind is a delete rather than a null.
CREATE TABLE lorebook_bindings (
  id          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  lorebook_id INTEGER NOT NULL REFERENCES lorebooks (id) ON DELETE CASCADE,
  scope       TEXT    NOT NULL CHECK (scope IN ('global', 'scene', 'character', 'persona')),
  -- Null for 'global'; otherwise the row this book is attached to.
  scene_id     INTEGER REFERENCES scenes (id) ON DELETE CASCADE,
  character_id INTEGER REFERENCES characters (id) ON DELETE CASCADE,
  persona_id   INTEGER REFERENCES personas (id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL
) STRICT;

CREATE INDEX lorebook_bindings_scope ON lorebook_bindings (scope, scene_id, character_id, persona_id);

-- §10: "persist as TimedEffectState rows keyed by scene and entry".
--
-- Anchored to a message rather than to a counter, for the reason the guides and
-- summaries are: history is a tree. A sticky that expires "four messages after
-- turn 40" has to mean four messages along *this* branch, and a branch that
-- never had turn 40 has to have no sticky at all. Storing the anchor and
-- counting along the active path is what makes §10's "inherited by branches"
-- true rather than approximately true.
CREATE TABLE lore_timed_effects (
  id         INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  scene_id   INTEGER NOT NULL REFERENCES scenes (id) ON DELETE CASCADE,
  entry_id   INTEGER NOT NULL REFERENCES lore_entries (id) ON DELETE CASCADE,
  -- The message this entry last activated after. Null cannot happen: an effect
  -- exists because something fired.
  message_id INTEGER NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX lore_timed_effects_scene ON lore_timed_effects (scene_id, entry_id);

-- §2's persona lorebook, which §2 itself flags as a gap. A binding row covers
-- the general case; this is here because §2 names the column and the persona
-- editor is the natural place to set it.
