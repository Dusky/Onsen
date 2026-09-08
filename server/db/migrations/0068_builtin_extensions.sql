-- 0068 built-in extensions — SPEC §15, §20 phase 144.
--
-- A built-in ships with the app and has no copied directory: its code lives in
-- the host. It still gets a row (so it can be toggled and carry settings), and
-- `built_in` marks it as non-removable.

ALTER TABLE extensions ADD COLUMN built_in INTEGER NOT NULL DEFAULT 0;
