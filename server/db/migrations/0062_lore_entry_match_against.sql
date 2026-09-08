-- 0062 lore entry card-field matching — SPEC §10, §20 phase 135.
--
-- An entry's keys can also scan the present cast's description, personality,
-- depth note, scenario or creator notes, and the persona's description — the
-- fields SillyTavern calls matchCharacterDescription and so on. Empty means the
-- transcript only, which is the behaviour until now.

ALTER TABLE lore_entries ADD COLUMN match_against TEXT NOT NULL DEFAULT '[]';
