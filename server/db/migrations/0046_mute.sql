-- Phase 62: mute and bench are two states, not one.
--
-- `scene_members.is_active` has been the only control since phase 7, labelled
-- "bench" and described as "out of rotation and out of the prompt". Only half
-- of that was true: `buildPromptContext` builds `cast` from every member, so a
-- benched character still appeared under "Also in this scene" with their
-- compact definition — present to the author, never chosen to speak.
--
-- Which is exactly what the incumbent calls a **mute**. So the state people
-- already have is migrated to the name that describes it, and `is_active = 0`
-- is given the meaning its label always claimed: gone from the prompt
-- entirely, still in the cast list, still owning every line it has written.
ALTER TABLE scene_members
  ADD COLUMN is_muted INTEGER NOT NULL DEFAULT 0 CHECK (is_muted IN (0, 1));

UPDATE scene_members SET is_muted = 1, is_active = 1 WHERE is_active = 0;
