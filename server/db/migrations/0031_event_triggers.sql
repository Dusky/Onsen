-- Event triggers (SPEC §14, §20 phase 33).
--
-- The other half of §14's substrate. Regex scripts say *how* text is changed;
-- a trigger says *when* something runs. Together they are the answer to "a full
-- scripting language is out of scope for v1" - the claim being that named
-- actions bound to named events cover most of what SillyTavern users write
-- STscript for.
--
-- §14 lists three action families: run a background task, refresh a guide or
-- tracker, fire a regex pass. Two of those are built here and one is not, and
-- the reason is in the task primitive's own signature: a task request carries a
-- prompt "built by the caller, because only the caller knows what to ask".
-- There is no generic way to ask an arbitrary op a question, so the ops a
-- trigger can run are the ones something already knows how to ask - which is
-- exactly the guides and the trackers, both of which are background tasks.
CREATE TABLE event_triggers (
  id           INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid         TEXT    NOT NULL UNIQUE,
  name         TEXT    NOT NULL,

  -- scene_start | user_message | before_generation | after_generation
  -- | lore_activation
  event        TEXT    NOT NULL,

  -- guide | tracker | script
  action       TEXT    NOT NULL,
  -- A guide kind, a tracker kind, or a regex script's ULID. Untyped on purpose:
  -- the three action kinds name three different things, and a column per kind
  -- would be three columns of which two are always null.
  action_ref   TEXT    NOT NULL,

  -- lore_activation only. §10 lets an entry name an action fired on activation;
  -- this is the other end of that string. Null for every other event.
  automation_id TEXT,

  scope        TEXT    NOT NULL DEFAULT 'global',
  scene_id     INTEGER REFERENCES scenes (id) ON DELETE CASCADE,

  enabled      INTEGER NOT NULL DEFAULT 1,
  run_order    INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,

  CHECK (event IN (
    'scene_start', 'user_message', 'before_generation', 'after_generation',
    'lore_activation'
  )),
  CHECK (action IN ('guide', 'tracker', 'script')),
  CHECK (scope IN ('global', 'scene')),
  CHECK (
    (scope = 'global' AND scene_id IS NULL) OR
    (scope = 'scene'  AND scene_id IS NOT NULL)
  ),
  -- A lore trigger with no automation id would fire on every activation, which
  -- is not a trigger; an automation id on any other event names something that
  -- event never carries.
  CHECK (
    (event = 'lore_activation' AND automation_id IS NOT NULL) OR
    (event <> 'lore_activation' AND automation_id IS NULL)
  )
) STRICT;

CREATE INDEX event_triggers_event ON event_triggers (event, run_order);
CREATE INDEX event_triggers_scene ON event_triggers (scene_id);
