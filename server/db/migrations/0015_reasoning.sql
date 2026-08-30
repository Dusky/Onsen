-- 0015 reasoning and prefill — SPEC §20 phase 17.
--
-- §13 asks for reasoning blocks to be parsed out of the response into
-- `Message.reasoning`, hidden from the prose by default, and — the part with
-- teeth — **not fed back into multi-turn context** unless somebody opts in.
-- Storing it in its own column is what makes that default free: the history
-- renderer reads `content`, so reasoning cannot leak into a later prompt by
-- accident. Re-injection has to be built deliberately, which is the right way
-- round for a behaviour most providers advise against.
--
-- Migration 0002 named this column and deferred it to this phase, because a
-- column nothing writes is indistinguishable from a column nothing reads.

ALTER TABLE messages ADD COLUMN reasoning TEXT;

-- Whether this endpoint accepts a prefill — a partial assistant turn the model
-- continues from (§13).
--
-- Deliberately not folded into the cached `capabilities` JSON, and deliberately
-- three-valued. Prefill is not a property of the adapter kind: OpenAI itself
-- rejects a trailing assistant message, while most of the local servers behind
-- the same OpenAI-compatible shape accept one happily. So the adapter states a
-- default and this overrides it — null means "whatever the adapter says", which
-- is different from a user having said no.
ALTER TABLE providers ADD COLUMN supports_prefill INTEGER
  CHECK (supports_prefill IN (0, 1));
