-- 0061 lore entry generation triggers — SPEC §10, §20 phase 134.
--
-- An entry can fire only on certain generation types (normal, swipe, revise,
-- continue). Empty means every type, which is the behaviour until now.

ALTER TABLE lore_entries ADD COLUMN triggers TEXT NOT NULL DEFAULT '[]';
