-- Who wins when a character and a preset both have something to say (§20 phase 169).
--
-- Both default to what the builder already did, so no existing preset changes
-- behaviour:
--
--   `prefer_character_prompt` = 0. The `system_prompt` block has always been
--   the preset's. A character's own system prompt is folded into the
--   `spotlight_character` block instead — and only in single-character mode,
--   so with an author set it was dropped entirely with nothing saying so. On,
--   the spotlight's system prompt replaces the preset's, in either mode.
--
--   `prefer_character_instructions` = 1. The `post_history` block has always
--   been the character's, and there was never anything on the preset side to
--   prefer it over: `PromptPreset.postHistoryInstructions` was hardcoded null
--   and the preset's `jailbreak` is its own separate "Final instruction"
--   block. So the choice this offers is whether a card's post-history
--   instructions are injected at all, which is the real decision a reader
--   using somebody else's card is making.
ALTER TABLE presets ADD COLUMN prefer_character_prompt INTEGER NOT NULL DEFAULT 0
  CHECK (prefer_character_prompt IN (0, 1));
ALTER TABLE presets ADD COLUMN prefer_character_instructions INTEGER NOT NULL DEFAULT 1
  CHECK (prefer_character_instructions IN (0, 1));

-- A third automatic retry, off by default (§13.6, §20 phase 169).
--
-- `maybeRetry` has rerolled on length since phase 63 and on nothing else. The
-- incumbent also rerolls on a blacklisted word, and the list this would judge
-- against already exists: `activeBans` returns the global phrases plus the
-- scene's, with proposals excluded — a proposal is a suggestion until somebody
-- accepts it, so it must not silently cost a generation.
--
-- Off, because on would change what every existing preset does with the ban
-- list it already has. It shares the `auto_swipe_attempts` budget rather than
-- getting one of its own: two independent budgets is two ways for a scene to
-- spend money in a loop.
ALTER TABLE presets ADD COLUMN auto_swipe_on_banned INTEGER NOT NULL DEFAULT 0
  CHECK (auto_swipe_on_banned IN (0, 1));
