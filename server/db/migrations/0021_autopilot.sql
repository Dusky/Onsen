-- Autopilot (SPEC §6, §2's scene fields, §20 phase 24).
--
-- Two columns §2 names that the schema has been missing since phase 1.
--
-- Off by default: a scene that writes itself is a mode you point at, not a
-- state every scene drifts into. The loop is a property of *this* scene, not
-- of the app, which is why the switch lives here rather than in settings.
ALTER TABLE scenes ADD COLUMN autopilot_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (autopilot_enabled IN (0, 1));

-- How many turns the loop may write before it hands the scene back. The
-- default is three: enough to feel the scene running itself, short enough that
-- a runaway loop on a metered provider is a bounded accident.
ALTER TABLE scenes ADD COLUMN autopilot_max_turns INTEGER NOT NULL DEFAULT 3
  CHECK (autopilot_max_turns > 0);
