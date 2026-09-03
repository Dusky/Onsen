-- Character dossiers for emergent NPCs (SPEC §11, §20 phase 32).
--
-- For the characters who arrive during play rather than being authored up
-- front: the innkeeper who turned out to matter.
--
-- §22 left open whether a dossier should be its own entity or a character with
-- a `provisional` flag, and guessed the latter. Neither is right, and the
-- reason is in §11's own sentence: dossiers are "injected by relevance (recent
-- mention, or keyword) rather than always". A cast member is injected always —
-- that is what being in the cast means — so a provisional character would
-- either cost tokens on every turn or need a second injection rule bolted onto
-- the cast. Relevance injection already exists, in §10.
--
-- SillyTavern reaches the same answer from the other direction: it has no
-- dossier feature at all, and what its users do for an NPC who emerged is
-- write a World Info entry in a chat-scoped lorebook. That is this schema's
-- scene binding, built in phase 21.
--
-- So a dossier is two things at once. This table is the editable truth, with
-- the five fields §11 names; the lore entry it renders into is how it reaches
-- a prompt. Keys, scan depth, the token budget, sticky, the character filter
-- and §16's activation test tool all come for free, and none of it is
-- reimplemented here.
CREATE TABLE dossiers (
  id           INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid         TEXT    NOT NULL UNIQUE,
  scene_id     INTEGER NOT NULL REFERENCES scenes (id) ON DELETE CASCADE,
  name         TEXT    NOT NULL,

  -- §11's five fields. Kept apart rather than as one blob because the point of
  -- a dossier is that its parts mean different things: a canon lock is a
  -- constraint, standing is a relationship, and flattening them into prose
  -- loses the distinction the reader edits along.
  role         TEXT    NOT NULL DEFAULT '',
  voice        TEXT    NOT NULL DEFAULT '',
  -- Facts established in play that must not be contradicted.
  canon_lock   TEXT    NOT NULL DEFAULT '',
  -- Tiered knowledge, as JSON: { public, private, buried }. One column because
  -- the three tiers are always written and read together.
  knowledge    TEXT    NOT NULL DEFAULT '{}',
  -- Where they stand with the reader's persona.
  standing     TEXT    NOT NULL DEFAULT '',

  -- The entry this dossier renders into. Null only between insert and first
  -- render; the cascade takes the entry with the dossier.
  lore_entry_id INTEGER REFERENCES lore_entries (id) ON DELETE SET NULL,

  -- Set when the dossier has earned a full character card (§11: "can be
  -- promoted to full characters when they earn it"). The dossier stays as the
  -- record of where the character came from, and stops being injected.
  promoted_character_id INTEGER REFERENCES characters (id) ON DELETE SET NULL,

  -- How many turns mentioned this name when the dossier was proposed. Kept so
  -- the reader can see why the app thought this one mattered.
  mentions     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
) STRICT;

-- One dossier per name per scene: two rows for the same innkeeper would both
-- render entries, and the reader would edit one and be confused by the other.
CREATE UNIQUE INDEX dossiers_scene_name ON dossiers (scene_id, name COLLATE NOCASE);
CREATE INDEX dossiers_scene ON dossiers (scene_id);
