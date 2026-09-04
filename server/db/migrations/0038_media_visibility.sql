-- Hiding a picture, from the log and from the prompt (SPEC §20 phase 41).
--
-- Two switches rather than one, for the reason §2 already gives about messages:
-- "excluded from the prompt entirely, though still shown in the log". Where a
-- thing appears and what the author is told about it are different questions,
-- and a single switch would force a reader who wants one to accept the other.
--
-- The pairing a reader actually reaches for differs by which they want:
--   shown, in the prompt      - the ordinary case
--   shown, not in the prompt  - a picture for the reader's own reference, that
--                               the story should not react to
--   hidden, in the prompt     - a reference the author should know about
--                               without it sitting in the log
--   hidden, not in the prompt - kept, and out of the way

ALTER TABLE media_assets ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0
  CHECK (is_hidden IN (0, 1));

-- Only an attachment's caption ever reaches a prompt, so this only means
-- anything for one role - but it lives on every asset because the alternative
-- is a column that is null for two of three roles and a rule nobody can see.
ALTER TABLE media_assets ADD COLUMN in_prompt INTEGER NOT NULL DEFAULT 1
  CHECK (in_prompt IN (0, 1));
