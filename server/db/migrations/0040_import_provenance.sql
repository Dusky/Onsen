-- 0040 import provenance — SPEC §20 phase 44.
--
-- A SillyTavern chat has no stable identifier of its own: the file is named for
-- the date it was started, and nothing inside it is unique. But the expected
-- migration flow is to run the import, see a handful of chats skipped because
-- their card was not in the library yet, fix that, and run it again — so a
-- second pass has to recognise what the first one already brought in, or the
-- fix costs you a duplicate of everything that worked.
--
-- The hash is of the file's bytes, which is exactly the identity wanted here:
-- the same conversation imported twice is one scene, and a conversation that
-- has since grown a few more turns in SillyTavern is honestly a different file
-- and comes in as its own scene rather than silently merging.
ALTER TABLE scenes ADD COLUMN import_source TEXT;
ALTER TABLE scenes ADD COLUMN import_hash TEXT;

CREATE UNIQUE INDEX scenes_import_hash ON scenes (import_hash) WHERE import_hash IS NOT NULL;
