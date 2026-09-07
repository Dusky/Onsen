-- 0059 lore entry knobs — SPEC §10, §20 phase 126.
--
-- Parity with SillyTavern's world-info entry model. Five gaps, six columns:
-- ignore the book's token budget, switch probability off, override an inclusion
-- group, delay until a recursion round, and a character filter that can filter
-- by tag and can exclude rather than include.

ALTER TABLE lore_entries ADD COLUMN ignore_budget INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lore_entries ADD COLUMN use_probability INTEGER NOT NULL DEFAULT 1;
ALTER TABLE lore_entries ADD COLUMN group_override INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lore_entries ADD COLUMN delay_until_recursion INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lore_entries ADD COLUMN character_filter_tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE lore_entries ADD COLUMN character_filter_exclude INTEGER NOT NULL DEFAULT 0;
