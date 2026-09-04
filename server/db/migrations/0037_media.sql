-- Media services and generated media (SPEC §20 phase 41).
--
-- §20 asks for TTS, image generation and captioning. Two of those talk to an
-- outside service that is not a language model, and the third does not: a
-- caption comes from a vision-capable chat model, so it rides on the connection
-- profiles that already exist rather than on anything here.
--
-- §17 tier 3 names exactly these as the case for code extensions, and says not
-- to design that API speculatively. This is the alternative it implies: the two
-- integrations built in, declaratively configured, with the same key handling
-- and the same "keys stay server-side" rule the providers table already holds.

-- A service that makes a picture or a voice. Deliberately shaped like
-- `providers`: name, kind, base_url, an encrypted key, a model. The difference
-- is `purpose`, because "which of these do I use to draw" and "which do I use
-- to speak" are different questions with different answers.
CREATE TABLE media_services (
  id                INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid              TEXT    NOT NULL UNIQUE,
  name              TEXT    NOT NULL,
  purpose           TEXT    NOT NULL CHECK (purpose IN ('image', 'speech')),
  -- 'openai' is any endpoint speaking OpenAI's shape, which includes most
  -- hosted services and several local ones. 'a1111' is the WebUI's own API,
  -- which is what this audience actually runs locally.
  kind              TEXT    NOT NULL CHECK (kind IN ('openai', 'a1111')),
  base_url          TEXT,
  api_key_encrypted TEXT,
  model             TEXT,
  -- Per-kind settings the shape of which is the adapter's business: steps and a
  -- sampler for A1111, a size and a quality for OpenAI, a voice for speech.
  options           TEXT    NOT NULL DEFAULT '{}',
  enabled           INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  is_default        INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
) STRICT;

-- One default per purpose, rather than one overall: a picture service is never
-- a candidate for speaking, so a single default column would make choosing one
-- unset the other.
CREATE UNIQUE INDEX media_services_one_default
  ON media_services (purpose) WHERE is_default = 1;

-- Something that was made, or something that was given to us. Content-addressed
-- on disk like avatars, so regenerating an identical picture costs one row and
-- no bytes, and so deleting a row never orphans a file another row shares.
CREATE TABLE media_assets (
  id           INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid         TEXT    NOT NULL UNIQUE,
  kind         TEXT    NOT NULL CHECK (kind IN ('image', 'audio')),
  -- What it is for, which is not what it is: an illustration and an attachment
  -- are both images and belong in different places on the screen.
  role         TEXT    NOT NULL
                       CHECK (role IN ('illustration', 'speech', 'attachment')),
  -- Relative to the media directory. Shared between rows when the bytes match.
  path         TEXT    NOT NULL,
  mime         TEXT    NOT NULL,
  bytes        INTEGER NOT NULL,
  -- Null when the format did not say, which is normal for audio.
  width        INTEGER,
  height       INTEGER,
  duration_ms  INTEGER,
  -- What was asked for. §16 says a generation is inspectable; a picture with no
  -- record of its prompt is the one generated thing nobody could explain.
  prompt       TEXT,
  -- What a vision model saw, for an attachment. This is the text that reaches
  -- the roleplay prompt — the bytes never do.
  caption      TEXT,
  service_id   INTEGER REFERENCES media_services (id) ON DELETE SET NULL,
  message_id   INTEGER REFERENCES messages (id) ON DELETE CASCADE,
  character_id INTEGER REFERENCES characters (id) ON DELETE CASCADE,
  scene_id     INTEGER REFERENCES scenes (id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
) STRICT;

CREATE INDEX media_assets_message ON media_assets (message_id, role, id);
CREATE INDEX media_assets_scene ON media_assets (scene_id, role, id);
CREATE INDEX media_assets_path ON media_assets (path);
