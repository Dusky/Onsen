-- The prompt inspector (SPEC §3, §16, §20 phase 25).
--
-- One JSON column: the assembled prompt's debug record — every block with its
-- token cost, what was evicted and why, and the lore activation trace. Written
-- when the prompt is built, before the first token, so a cancelled or failed
-- generation is as inspectable as a complete one: the question the inspector
-- answers — "what did the model actually see" — is about the ask, not the
-- answer.
ALTER TABLE generations ADD COLUMN prompt_debug TEXT;
