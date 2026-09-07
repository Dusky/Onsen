-- Phase 103: automatic background generation (AutoBackground, ported).
--
-- After each AI turn, when enabled, a lightweight detection call decides
-- whether the scene has moved to a new location; if it has, a background is
-- generated. The cooldown is seconds; the minimum message count stops the
-- check on the first few turns; the prompt is the reader's own wording.

ALTER TABLE scenes ADD COLUMN auto_background_enabled INTEGER NOT NULL DEFAULT 0 CHECK (auto_background_enabled IN (0, 1));
ALTER TABLE scenes ADD COLUMN auto_background_cooldown INTEGER NOT NULL DEFAULT 120;
ALTER TABLE scenes ADD COLUMN auto_background_min_messages INTEGER NOT NULL DEFAULT 4;
ALTER TABLE scenes ADD COLUMN auto_background_prompt TEXT;
