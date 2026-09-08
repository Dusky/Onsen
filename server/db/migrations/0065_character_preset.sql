-- 0065 per-character preset — SPEC §13, §20 phase 140.
--
-- A character can pin the preset it answers with. Resolution: the scene's own
-- preset, then the spotlight character's pin, then the connection profile's,
-- then the default.

ALTER TABLE characters ADD COLUMN preset_id INTEGER REFERENCES presets (id) ON DELETE SET NULL;
