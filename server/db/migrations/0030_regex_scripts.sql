-- Regex scripts (SPEC §14, §20 phase 33).
--
-- The substrate for the long tail: trimming a model's incomplete trailing
-- sentence, stripping formatting it will not stop emitting, styling names,
-- pulling a custom tagged block out of the prose. §14's argument is that if you
-- give users nothing here they hit walls you never anticipated, and that regex
-- plus event triggers covers most of what SillyTavern users write STscript for.
--
-- §2 sketches this table with a single polymorphic `scope_id`. Two typed,
-- foreign-keyed columns are used instead: a `scope_id` naming a character in
-- one row and a scene in the next cannot carry a foreign key, so a deleted
-- character would leave a script silently scoped to nothing and still running.
-- The cascade below is the point of the divergence.
CREATE TABLE regex_scripts (
  id           INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid         TEXT    NOT NULL UNIQUE,
  name         TEXT    NOT NULL,

  pattern      TEXT    NOT NULL,
  replacement  TEXT    NOT NULL DEFAULT '',
  -- A subset of JavaScript's: g, i, m, s, u, y. Validated before the row is
  -- written, because a pattern that will not compile is a script that does
  -- nothing on every turn until somebody notices.
  flags        TEXT    NOT NULL DEFAULT 'g',
  enabled      INTEGER NOT NULL DEFAULT 1,

  -- user_input | ai_output | display_only | prompt.
  --
  -- The four differ in what they change and what survives. user_input and
  -- ai_output rewrite the message before it is stored, so they are permanent
  -- and the model sees them. display_only changes what the reader is shown and
  -- nothing else - the stored text and the prompt keep the original. prompt
  -- changes the transcript on its way into a generation and touches nothing on
  -- disk.
  apply_to     TEXT    NOT NULL,

  -- global | character | scene.
  scope        TEXT    NOT NULL DEFAULT 'global',
  character_id INTEGER REFERENCES characters (id) ON DELETE CASCADE,
  scene_id     INTEGER REFERENCES scenes (id) ON DELETE CASCADE,

  -- Lower runs first. Order is the reason this column exists: a script that
  -- strips formatting and one that adds it are both reasonable, and which wins
  -- should be the user's decision rather than an accident of insert order.
  run_order    INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,

  CHECK (apply_to IN ('user_input', 'ai_output', 'display_only', 'prompt')),
  CHECK (scope IN ('global', 'character', 'scene')),
  -- A scoped script without its subject would run nowhere; a global one with a
  -- subject would run everywhere while looking scoped. Neither is worth a
  -- runtime guard when the schema can refuse them.
  CHECK (
    (scope = 'global'    AND character_id IS NULL AND scene_id IS NULL) OR
    (scope = 'character' AND character_id IS NOT NULL AND scene_id IS NULL) OR
    (scope = 'scene'     AND scene_id IS NOT NULL AND character_id IS NULL)
  )
) STRICT;

-- Every read is "the scripts for this stage, in order".
CREATE INDEX regex_scripts_stage ON regex_scripts (apply_to, run_order);
CREATE INDEX regex_scripts_character ON regex_scripts (character_id);
CREATE INDEX regex_scripts_scene ON regex_scripts (scene_id);
