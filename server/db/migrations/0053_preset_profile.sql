-- Phase 105: a preset names its model.
--
-- A SillyTavern-style preset is sampling plus prompt; a reader's mental model
-- adds "which model runs it". The scene still wins when it names a profile, but
-- a preset that names one lets "this preset" carry the whole answer.

ALTER TABLE presets ADD COLUMN connection_profile_id INTEGER REFERENCES connection_profiles (id) ON DELETE SET NULL;
