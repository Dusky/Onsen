-- Outbound webhooks (SPEC §15, §20 phase 35).
--
-- §15's argument for building these early: out-of-process integration is
-- strictly safer than an in-process plugin and requires no sandbox, and
-- webhooks plus the existing REST API are enough to build a Discord bridge, a
-- stream overlay or custom automation without any code running inside the app.
-- "They may remove the need for tier 3 entirely."
CREATE TABLE webhooks (
  id          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid        TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  url         TEXT    NOT NULL,

  -- The signing key, encrypted at rest with the same AES-256-GCM keyring that
  -- holds provider credentials (§17). It never returns to the browser after
  -- the subscription is written: the receiver needs it, and nothing in this app
  -- has a reason to show it twice.
  secret      TEXT    NOT NULL,

  -- Which events this subscription wants, as a JSON array. A list rather than a
  -- column per event, because §15 names five and the set will grow - and every
  -- new event would otherwise be a migration on a table nobody wants to change.
  events      TEXT    NOT NULL DEFAULT '[]',

  -- Scoped to one roleplay, or every one. A stream overlay wants one scene; a
  -- Discord bridge wants all of them.
  scene_id    INTEGER REFERENCES scenes (id) ON DELETE CASCADE,

  enabled     INTEGER NOT NULL DEFAULT 1,

  -- Set when deliveries keep failing. A subscription pointing at something that
  -- has been gone for a week should stop costing every turn a timeout, and the
  -- reader should be able to see that it stopped rather than wonder.
  failures    INTEGER NOT NULL DEFAULT 0,
  disabled_reason TEXT,

  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
) STRICT;

CREATE INDEX webhooks_scene ON webhooks (scene_id);

-- The delivery log. §18 wants visible degradation, and a webhook is the one
-- feature whose failures happen entirely off-screen: without this, a receiver
-- that started refusing requests looks exactly like a receiver nobody is
-- sending to.
CREATE TABLE webhook_deliveries (
  id          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  webhook_id  INTEGER NOT NULL REFERENCES webhooks (id) ON DELETE CASCADE,
  event       TEXT    NOT NULL,
  -- ok | failed. A non-2xx response and a connection that never opened are the
  -- same outcome from here: the receiver did not take it.
  status      TEXT    NOT NULL CHECK (status IN ('ok', 'failed')),
  -- The HTTP status, where there was one. Null when nothing answered.
  response_code INTEGER,
  detail      TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  attempt     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
) STRICT;

CREATE INDEX webhook_deliveries_hook ON webhook_deliveries (webhook_id, id DESC);
