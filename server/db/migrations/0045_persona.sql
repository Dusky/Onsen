-- Phase 61: the persona.
--
-- Three columns, and all three exist because something the app already stores
-- could not be reached:
--
-- * `personas.avatar_path` and `authors.avatar_path` have been on the schema
--   since 0005 with no route to serve them and no way to set one. They are the
--   pair `test/dead-columns.test.ts` structurally cannot see: the check matches
--   a column *name*, and `characters.avatar_path` is read constantly.
-- * `personas.is_default` is written and rendered, and `findDefaultPersona` has
--   been exported and called by nothing since phase 7 — so marking a persona
--   default has never done anything.
--
-- `depth` is the one genuinely new field. Null keeps the persona in the prefix
-- where the preset's block order puts it; a number injects it that many turns
-- from the end, the placement §3 already gives lore entries and depth prompts.
ALTER TABLE personas ADD COLUMN depth INTEGER;

-- A persona locked to a character (SPEC §2). Starting a roleplay with this
-- character opens it as that persona rather than as the global default —
-- SillyTavern's per-character persona lock, which is the half of its two locks
-- Onsen did not already have by construction.
ALTER TABLE characters ADD COLUMN persona_id INTEGER REFERENCES personas (id) ON DELETE SET NULL;

CREATE INDEX characters_persona ON characters (persona_id) WHERE persona_id IS NOT NULL;
