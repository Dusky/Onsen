-- 0001 foundation — SPEC §20 phase 1.
--
-- Scope note: this migration creates only the tables phase 1 needs to boot,
-- authenticate, and record where generation will eventually be sent. The rest of
-- the SPEC §2 data model (scenes, the message tree, characters, lorebooks,
-- documents, memory, guides, trackers) arrives with the phase that first uses
-- it, so that each table is designed against working code rather than guessed at
-- up front.
--
-- Conventions (HANDOFF): integer primary keys internally, ULIDs externally, all
-- timestamps Unix milliseconds. STRICT tables so a type error is an error.

-- Single-row-per-key application state: the password hash, the session
-- generation counter, and whether the setup wizard has run.
CREATE TABLE app_settings (
  key        TEXT    NOT NULL PRIMARY KEY,
  value      TEXT    NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

-- SPEC §2 Provider. `api_key_encrypted` holds the AES-256-GCM envelope produced
-- by server/lib/crypto.ts; the plaintext never leaves the server and is never
-- serialised to the client (SPEC §17).
CREATE TABLE providers (
  id                INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid              TEXT    NOT NULL UNIQUE,
  name              TEXT    NOT NULL,
  kind              TEXT    NOT NULL
                            CHECK (kind IN ('openai_compatible', 'anthropic', 'text_completion')),
  base_url          TEXT,
  api_key_encrypted TEXT,
  model             TEXT,
  -- ProviderCapabilities (SPEC §4), cached from the adapter. Null until an
  -- adapter has reported them, which cannot happen before phase 4.
  capabilities      TEXT,
  enabled           INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
) STRICT;

-- SPEC §2 Preset. JSON columns are opaque to SQLite and parsed by the server
-- against the shapes in /shared. The seeded default carries the modern sampler
-- values from SPEC §13 — shipping 2023 defaults is an explicit anti-pattern
-- (SPEC §22).
CREATE TABLE presets (
  id                  INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid                TEXT    NOT NULL UNIQUE,
  name                TEXT    NOT NULL,
  sampler_settings    TEXT    NOT NULL,
  prompt_order        TEXT,
  system_prompt       TEXT,
  jailbreak           TEXT,
  prefill             TEXT,
  context_size        INTEGER NOT NULL DEFAULT 32768,
  max_response_tokens INTEGER NOT NULL DEFAULT 1024,
  reasoning_config    TEXT,
  is_default          INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
) STRICT;

-- At most one default preset.
CREATE UNIQUE INDEX presets_one_default ON presets (is_default) WHERE is_default = 1;

-- SPEC §2 ConnectionProfile: the switchable bundle that makes per-operation
-- model routing usable (SPEC §0.11). `instruct_template_id` and
-- `context_template_id` are deliberately absent until phase 20 introduces
-- text-completion templates.
CREATE TABLE connection_profiles (
  id          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid        TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  provider_id INTEGER NOT NULL REFERENCES providers (id) ON DELETE CASCADE,
  model       TEXT,
  preset_id   INTEGER REFERENCES presets (id) ON DELETE SET NULL,
  is_default  INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX connection_profiles_one_default
  ON connection_profiles (is_default) WHERE is_default = 1;

CREATE INDEX connection_profiles_provider ON connection_profiles (provider_id);
