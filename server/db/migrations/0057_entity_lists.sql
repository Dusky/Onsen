-- Phase 111: entities get the same list tools.
--
-- Characters and scenes have had tags, folders and search since phase 59.
-- Authors and backgrounds get them now, and a background gains a name — its
-- prompt is what it was drawn from, not what it is called.

ALTER TABLE authors ADD COLUMN tags TEXT;
ALTER TABLE authors ADD COLUMN folder TEXT;

ALTER TABLE backgrounds ADD COLUMN name TEXT;
ALTER TABLE backgrounds ADD COLUMN tags TEXT;
ALTER TABLE backgrounds ADD COLUMN folder TEXT;
ALTER TABLE backgrounds ADD COLUMN updated_at INTEGER;
