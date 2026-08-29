-- 0011 per-op configuration — SPEC §20 phase 13.
--
-- SPEC §7 gives every op a configuration row: which model it runs on, the words
-- it uses, where those words are injected, and whether its button is shown. The
-- `tasks` table already held the first two for side calls; these two columns
-- complete the row, and turn instructions now get rows in the same table
-- because they carry the same configuration.
--
-- `auto_trigger` is the one field from §7's list still missing. It means "run
-- automatically after each reply", and the only ops that want it are the
-- post-generation passes, which are phase 14. A switch that does nothing is
-- worse than a short settings screen, so it arrives with its consumer.

-- Where this op's text lands. Which works best varies by model (§7), so it is
-- per-op rather than global.
ALTER TABLE tasks ADD COLUMN injection_role TEXT NOT NULL DEFAULT 'system'
  CHECK (injection_role IN ('system', 'user', 'assistant'));

-- Whether the op's button appears. Off is not the same as disabled: a hidden op
-- still runs when something else asks for it.
ALTER TABLE tasks ADD COLUMN button_visible INTEGER NOT NULL DEFAULT 1
  CHECK (button_visible IN (0, 1));
