-- Instruct templates (SPEC §4, §20 phase 22).
--
-- Text-completion mode needs to know how a model's turns are marked, and
-- getting it wrong does not error — it produces prose that drifts, repeats the
-- user, or never stops. So the template is a property of the provider, chosen
-- once beside the address and the model rather than per scene: it describes the
-- weights behind the endpoint, and every scene on that endpoint wants the same
-- answer.
--
-- Null means the shipped default. The six named templates live in code as data
-- (server/prompt/instruct.ts) and are not seeded here: they are not user data,
-- they do not change per install, and a seeded copy would go stale the moment a
-- format is corrected.
ALTER TABLE providers ADD COLUMN instruct_template TEXT;

-- SPEC §4: "users must be able to add custom ones." A custom template is the
-- same shape as a shipped one and shares its id space, so `instruct_template`
-- names either without the provider needing to know which.
CREATE TABLE instruct_templates (
  id          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid        TEXT    NOT NULL UNIQUE,
  -- What `providers.instruct_template` stores. Slugged from the name on
  -- creation, and unique across custom templates; a shipped id is refused
  -- rather than shadowed, because a template that silently replaces ChatML for
  -- every provider is not something anyone asked for.
  template_id TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  -- The InstructTemplate shape, verbatim (server/prompt/instruct.ts). Opaque to
  -- SQLite and parsed by the server, like every other JSON column here.
  body        TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
) STRICT;
