-- 0071 self-responses — SPEC §6, §20 phase 155.
--
-- The turn director's "never twice consecutively" rule can be relaxed per
-- scene: with it off, the same character may speak twice in a row (the author
-- answering itself). Affects the strategies that *choose* — mention and the
-- classifier; round robin keeps its alternation contract.

ALTER TABLE scenes ADD COLUMN allow_self_responses INTEGER NOT NULL DEFAULT 0
  CHECK (allow_self_responses IN (0, 1));
