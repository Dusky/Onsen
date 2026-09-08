-- 0060 lorebook toggle — SPEC §10, §20 phase 131.
--
-- A lorebook has no on/off switch: it is "active" only by being bound, so the
-- only way to silence a whole book was to unbind it and lose the binding. This
-- is the mute switch — a disabled book contributes nothing to any scene but
-- keeps every binding for when it is flipped back on.

ALTER TABLE lorebooks ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
