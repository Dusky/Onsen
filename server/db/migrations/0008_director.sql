-- 0008 classifier turn director — SPEC §20 phase 10.
--
-- SPEC §6 asks for the classifier to be routed to its own connection profile:
-- the whole point of it is a cheap, fast call, and running it on the model
-- writing the prose costs as much as a turn. Null falls back to the scene's own
-- profile, so a scene that has not been told otherwise still works.
--
-- Per-operation routing generally is phase 13. This is the one operation that
-- exists to be routed differently, so it gets its column now; phase 13
-- generalises the idea rather than contradicting it.
ALTER TABLE scenes ADD COLUMN director_profile_id INTEGER
  REFERENCES connection_profiles (id) ON DELETE SET NULL;
