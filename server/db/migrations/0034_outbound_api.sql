-- The outbound OpenAI-compatible API (SPEC §19, §20 phase 37).
--
-- §19's claim: other clients - a terminal, a bot, an editor plugin, another
-- frontend - can address a configured scene as if it were a model, and the
-- server runs the whole pipeline behind it. "This turns the prompt builder into
-- a service rather than a UI feature."
--
-- §19 is explicit that this is off by default and enabled per scene. Two
-- columns carry that: a scene must opt in, and a key must exist. Neither alone
-- opens anything.
ALTER TABLE scenes ADD COLUMN api_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (api_enabled IN (0, 1));

-- How the incoming message array is reconciled against the stored tree (§19).
-- last_message is the default because it works with any client and keeps the
-- tree canonical; the others trade that for clients that know what they are
-- doing.
ALTER TABLE scenes ADD COLUMN api_history_mode TEXT NOT NULL DEFAULT 'last_message'
  CHECK (api_history_mode IN ('last_message', 'sync', 'stateless'));

-- A slug, so a model id is `scene/the-pass` rather than `scene/01J8...`. Null
-- until the scene is named; assigned when the API is switched on.
ALTER TABLE scenes ADD COLUMN api_slug TEXT;
CREATE UNIQUE INDEX scenes_api_slug ON scenes (api_slug) WHERE api_slug IS NOT NULL;

-- Bearer tokens, separate from the session cookie (§19).
--
-- The token is stored as a SHA-256 hash and never again in a form this app can
-- read back - the same rule the webhook signing key follows, and for a stronger
-- reason: this one is a credential for the whole endpoint. Verification is by
-- hash lookup, which is why the hash is indexed rather than the prefix.
CREATE TABLE api_keys (
  id          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid        TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  token_hash  TEXT    NOT NULL UNIQUE,
  -- The first few characters, so a key can be recognised in a list without
  -- being readable from one.
  token_hint  TEXT    NOT NULL,

  -- "scoped to specific scenes where useful" (§19). Null is every enabled
  -- scene; a scene id restricts the key to that one.
  scene_id    INTEGER REFERENCES scenes (id) ON DELETE CASCADE,

  -- Revocation is a flag rather than a delete, so the usage log a revoked key
  -- left behind still says whose it was.
  revoked_at  INTEGER,
  last_used_at INTEGER,
  uses        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
) STRICT;

CREATE INDEX api_keys_hash ON api_keys (token_hash);

-- "rate-limit per key and log usage" (§19). One row per request, capped per key
-- the way the webhook delivery log is: a diagnostic, not an archive.
CREATE TABLE api_requests (
  id          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  key_id      INTEGER REFERENCES api_keys (id) ON DELETE CASCADE,
  model       TEXT    NOT NULL,
  -- The HTTP status this request got. A log of only the successes would hide
  -- the case somebody actually needs to debug.
  status      INTEGER NOT NULL,
  -- Set when the incoming system prompt looked like another frontend had
  -- already assembled a character card into it (§19's double assembly).
  warning     TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
) STRICT;

CREATE INDEX api_requests_key ON api_requests (key_id, id DESC);
