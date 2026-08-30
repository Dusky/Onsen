-- 0016 prompt option groups and the ban list — SPEC §20 phase 18.
--
-- §13.5's argument, which is the whole reason this is a table rather than a
-- longer system prompt: the best preset suites are not one wall of text, they
-- are libraries of small toggleable blocks with certain groups mutually
-- exclusive — one POV, one prose structure, one length rule. Celia coordinates
-- roughly thirty-five state variables to do that, and it works, but it is
-- prompt engineering standing in for a data model. This is the data model.
--
-- Cardinality is the part that earns the table. `one_of` is not a convention
-- anybody has to remember: selecting an option in a `one_of` group clears the
-- others, so a scene cannot end up asking for first person and third person at
-- once, which is exactly what a wall of toggles lets you do.

CREATE TABLE option_groups (
  id          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid        TEXT    NOT NULL UNIQUE,
  -- Stable across installs, so a built-in group can be found by name in code
  -- without depending on a row id.
  key         TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  cardinality TEXT    NOT NULL CHECK (cardinality IN ('one_of', 'any_of')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  -- A shipped group. Kept so a future migration can update the built-ins
  -- without touching anything a user wrote.
  is_builtin  INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0, 1)),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
) STRICT;

CREATE TABLE options (
  id         INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid       TEXT    NOT NULL UNIQUE,
  group_id   INTEGER NOT NULL REFERENCES option_groups (id) ON DELETE CASCADE,
  key        TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  -- The prompt text this option compiles to. §13.5: "each block compiling to a
  -- prompt fragment placed at a declared position and depth."
  fragment   TEXT    NOT NULL,
  -- Where it lands. The same three placements every other block has (§3), so
  -- an option is not a special case in the builder.
  position   TEXT    NOT NULL DEFAULT 'depth'
                     CHECK (position IN ('prefix', 'depth', 'outlet')),
  depth      INTEGER NOT NULL DEFAULT 0,
  outlet_name TEXT,
  role       TEXT    NOT NULL DEFAULT 'system'
                     CHECK (role IN ('system', 'user', 'assistant')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_builtin INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX options_group_key ON options (group_id, key);

-- Which options a scene has switched on. §13.5's SceneOptions.
CREATE TABLE scene_options (
  scene_id  INTEGER NOT NULL REFERENCES scenes (id) ON DELETE CASCADE,
  option_id INTEGER NOT NULL REFERENCES options (id) ON DELETE CASCADE,
  PRIMARY KEY (scene_id, option_id)
) STRICT;

-- §13.6: a ban list of phrases and constructions, stored as data rather than
-- as prose. Data because recurrence is measurable — the auto-analyse task reads
-- what a scene keeps reaching for and proposes it — and because the same list
-- has to reach three different mechanisms: the prompt, the samplers, and the
-- post-generation pass. A paragraph can only reach the first.
CREATE TABLE ban_phrases (
  id         INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid       TEXT    NOT NULL UNIQUE,
  -- Null is the global list, which every scene carries. §13.6 wants both.
  scene_id   INTEGER REFERENCES scenes (id) ON DELETE CASCADE,
  phrase     TEXT    NOT NULL,
  -- Why this is here: shipped with the app, added by hand, or proposed by the
  -- analyser and not yet accepted. A proposal is not enforced until somebody
  -- says so — a task that silently banned phrases would be editing the user's
  -- prose on its own authority.
  origin     TEXT    NOT NULL DEFAULT 'user'
                     CHECK (origin IN ('builtin', 'user', 'proposed')),
  -- How often the analyser saw it, so a proposal can be judged rather than
  -- guessed at (§13.6: "recurrence is measurable, so measure it").
  hits       INTEGER NOT NULL DEFAULT 0,
  enabled    INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX ban_phrases_scene ON ban_phrases (scene_id, enabled);
