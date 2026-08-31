-- The OOC channel (SPEC §12, §2's scene fields, §20 phase 23).
--
-- Two columns §2 names and the schema has been missing since phase 1.
--
-- Off by default, and that is a judgement rather than caution: an author that
-- volunteers asides is a delight when the reader wants a collaborator and an
-- intrusion when they want a story. The reader opts in.
ALTER TABLE scenes ADD COLUMN ooc_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (ooc_enabled IN (0, 1));

-- How many messages between invitations. The invitation is a *nudge*, not a
-- command — the author may decline, and usually should — so this is the
-- earliest it may speak up again rather than a schedule it must keep.
ALTER TABLE scenes ADD COLUMN ooc_interval INTEGER NOT NULL DEFAULT 12
  CHECK (ooc_interval > 0);
