-- Narrative memory (SPEC §11 layer 3, §20 phase 38).
--
-- §11 is emphatic that this is the *third* layer and to build it "only after 1
-- and 2 are solid" - rolling summarisation (phase 11) and the document bank
-- (phase 30) both are. It is also off by default, and stays that way: an
-- extraction running unasked on every scene would spend a model call per turn
-- to build a structure most stories never need.
ALTER TABLE scenes ADD COLUMN memory_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (memory_enabled IN (0, 1));

CREATE TABLE memory_entities (
  id          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid        TEXT    NOT NULL UNIQUE,

  -- §2 sketches both an author and a scene binding. Only the scene one is
  -- built: an author-scoped memory is §11's *author memory*, which is a
  -- lorebook with an owner rather than an entity graph, and phase 39's job.
  scene_id    INTEGER NOT NULL REFERENCES scenes (id) ON DELETE CASCADE,

  kind        TEXT    NOT NULL
              CHECK (kind IN ('person', 'place', 'object', 'event', 'fact')),
  name        TEXT    NOT NULL,
  content     TEXT    NOT NULL DEFAULT '',

  -- 0.0-1.0, "derived from emotional weight, narrative significance, and
  -- information density" (§11). Stored as a real because the arithmetic that
  -- decays it is arithmetic; the CHECK is what keeps a bad extraction from
  -- writing a score that outranks everything forever.
  salience    REAL    NOT NULL DEFAULT 0.5
              CHECK (salience >= 0.0 AND salience <= 1.0),

  -- Where it was last mentioned, which is what decay counts from.
  last_seen_message_id INTEGER REFERENCES messages (id) ON DELETE SET NULL,

  -- §11: "an entity marked user_edited is never overwritten by extraction".
  -- The one rule that makes the whole feature safe to leave running.
  user_edited INTEGER NOT NULL DEFAULT 0 CHECK (user_edited IN (0, 1)),

  -- The embedding of `name: content`, for the similarity half of retrieval.
  -- Null when there is no embeddings provider, in which case retrieval falls
  -- back to the lexical path the data bank already uses.
  vector      TEXT,

  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
) STRICT;

-- One entity per name per scene. Two rows for the same innkeeper would both be
-- retrieved, and the reader would edit one and be confused by the other - the
-- same argument the dossiers table makes, one layer down.
CREATE UNIQUE INDEX memory_entities_scene_name
  ON memory_entities (scene_id, name COLLATE NOCASE);
CREATE INDEX memory_entities_scene ON memory_entities (scene_id, salience DESC);

CREATE TABLE memory_relations (
  id             INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid           TEXT    NOT NULL UNIQUE,
  from_entity_id INTEGER NOT NULL REFERENCES memory_entities (id) ON DELETE CASCADE,
  to_entity_id   INTEGER NOT NULL REFERENCES memory_entities (id) ON DELETE CASCADE,
  -- Free text rather than an enum: the useful relations in a story are
  -- "owes money to" and "has not spoken since the winter", and a fixed
  -- vocabulary would either be wrong or be a hundred entries long.
  kind           TEXT    NOT NULL,
  content        TEXT    NOT NULL DEFAULT '',
  salience       REAL    NOT NULL DEFAULT 0.5
                 CHECK (salience >= 0.0 AND salience <= 1.0),
  user_edited    INTEGER NOT NULL DEFAULT 0 CHECK (user_edited IN (0, 1)),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,

  -- A relation from a thing to itself is an extraction mistake, not a fact.
  CHECK (from_entity_id <> to_entity_id)
) STRICT;

CREATE UNIQUE INDEX memory_relations_unique
  ON memory_relations (from_entity_id, to_entity_id, kind COLLATE NOCASE);
CREATE INDEX memory_relations_from ON memory_relations (from_entity_id);
CREATE INDEX memory_relations_to ON memory_relations (to_entity_id);
