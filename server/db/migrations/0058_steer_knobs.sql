-- 0058 steer knobs — SPEC §7, §20 phase 125.
--
-- The steer (director note) was one string injected at depth 0 on every turn.
-- SillyTavern's Author's Note carries position, depth, frequency and role; the
-- steer gains depth, interval and role. Depth 0 is the near-turn position it
-- has always had; a positive depth places it that many turns back, the same
-- placement the lore entries and depth prompts use. Interval 1 is every turn.

ALTER TABLE scenes ADD COLUMN director_note_depth INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scenes ADD COLUMN director_note_interval INTEGER NOT NULL DEFAULT 1;
ALTER TABLE scenes ADD COLUMN director_note_role TEXT NOT NULL DEFAULT 'system';
