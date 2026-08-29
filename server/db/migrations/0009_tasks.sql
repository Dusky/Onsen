-- 0009 background tasks — SPEC §20 phase 11.
--
-- SPEC §7 asks for one primitive behind every side call: summarisation, tracker
-- refresh, memory extraction, the turn classifier, expression classification,
-- and every post-generation pass are all the same shape — a prompt, a model to
-- run it on, and somewhere for the answer to go. Build it once.
--
-- Scope note. A *kind* of task is code: what it asks for and what it does with
-- the answer are not expressible as data, and pretending otherwise would be an
-- extension system (§15, tier 3) rather than this. What is stored is the
-- configuration of a kind the code already knows about — §7's per-op row. Rows
-- are seeded as their kinds are built; today that is exactly one.

CREATE TABLE tasks (
  id                    INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  -- The code-known kind this configures. Unique: one row per kind.
  key                   TEXT    NOT NULL UNIQUE,
  -- Where in a turn it runs. Recorded because it is a fact about the task, not
  -- because anything schedules by it yet.
  stage                 TEXT    NOT NULL
                                CHECK (stage IN ('pre_generation', 'sidecar', 'post_generation')),
  enabled               INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  -- The model this kind runs on by default. Null means the scene's own, which
  -- works and costs more. A scene may override it (SPEC §6's director profile).
  connection_profile_id INTEGER REFERENCES connection_profiles (id) ON DELETE SET NULL,
  -- A user's replacement for the built-in prompt. Null means the built-in.
  prompt_template       TEXT,
  -- JSON sampler overrides. Null means the kind's own, which are not the
  -- scene's: a side call is a decision, not prose (SPEC §13).
  sampler_settings      TEXT,
  -- A task that thinks for longer than this is not the cheap call it is for.
  timeout_ms            INTEGER NOT NULL DEFAULT 12000,
  run_order             INTEGER NOT NULL DEFAULT 0,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
) STRICT;

-- Every run, kept briefly.
--
-- SPEC §7 requires a background task never to block or fail a user-facing
-- generation, which means every one of its failures is swallowed by design.
-- Swallowed failures have to surface somewhere or the rule turns into "side
-- calls fail silently forever and nobody can tell": this is that somewhere.
CREATE TABLE task_runs (
  id          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid        TEXT    NOT NULL UNIQUE,
  task_key    TEXT    NOT NULL,
  -- Null for a task that is not about one scene.
  scene_id    INTEGER REFERENCES scenes (id) ON DELETE CASCADE,
  status      TEXT    NOT NULL
                      CHECK (status IN ('ok', 'skipped', 'unusable', 'failed', 'timeout', 'cancelled')),
  -- Which model actually answered, which is the thing you want to know first.
  provider    TEXT,
  model       TEXT,
  -- What was sent and what came back, so a bad answer can be read rather than
  -- guessed at. Truncated by the runner; this is a log, not an archive.
  prompt      TEXT,
  output      TEXT,
  -- Why it was skipped, or how it failed. Written for a person.
  detail      TEXT,
  duration_ms INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
) STRICT;

CREATE INDEX task_runs_key ON task_runs (task_key, id);
CREATE INDEX task_runs_scene ON task_runs (scene_id, id);
