-- Phase 65: quick replies (SPEC §7, §20 phase 65).
--
-- The incumbent's Quick Reply: a label and a prompt the reader writes once and
-- fires from the composer with one tap. Onsen's nudge already does the work a
-- macro button needs — it is a one-shot instruction for the next turn that
-- never becomes a message — so this is storage plus a row of buttons, not a
-- new inference path.
--
-- Global rather than per-scene, the way the incumbent's Quick Reply sets are:
-- a reply worth writing down is worth having in every roleplay. The row order
-- is the reader's, which is what `sort_order` is for — the same discipline
-- `preset_blocks` and `regex_scripts` use, where lower runs first.
CREATE TABLE quick_replies (
  id         INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid       TEXT    NOT NULL UNIQUE,
  label      TEXT    NOT NULL,
  prompt     TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX quick_replies_order ON quick_replies (sort_order, ulid);
