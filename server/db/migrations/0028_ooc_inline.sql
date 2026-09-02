-- 0028 OOC display — SPEC §7, a field fix.
--
-- §7 phase 23 ships both treatments for an aside: the inline marginal note and
-- the channel sheet it promotes to. For a reader who finds the inline note
-- redundant — they would rather asides live only in the channel — this is the
-- switch. Default on: inline is the designed first appearance.
ALTER TABLE scenes ADD COLUMN ooc_inline INTEGER NOT NULL DEFAULT 1
  CHECK (ooc_inline IN (0, 1));
