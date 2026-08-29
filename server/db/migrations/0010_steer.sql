-- 0010 guided ops — SPEC §20 phase 12.
--
-- Every guided op is an ephemeral instruction injected at depth 0 and never
-- persisted as a message (SPEC §7), with one exception: Steer is defined as a
-- *persistent* director note on the scene, applied until cleared. That is the
-- whole difference between it and Nudge, so it is the only one that needs a
-- column.
ALTER TABLE scenes ADD COLUMN director_note TEXT;
