import type { Database } from "bun:sqlite";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ulid } from "../../lib/ulid.ts";

/**
 * Bearer keys for §19's outbound API.
 *
 * The token is stored as a SHA-256 hash and never in a form this app can read
 * back — the same rule the webhook signing key follows, and for a stronger
 * reason: this one is a credential for the whole endpoint rather than a way to
 * check one payload. A hash rather than the keyring's reversible envelope,
 * because nothing ever needs the plaintext again: verification compares hashes.
 *
 * No salt, deliberately. A salted hash cannot be looked up by index, which
 * would mean hashing the presented token once per stored key on every request;
 * and the thing a salt protects against — a rainbow table over low-entropy
 * secrets — does not apply to 32 random bytes.
 */

export interface ApiKeyRow {
  id: number;
  ulid: string;
  name: string;
  token_hash: string;
  token_hint: string;
  scene_id: number | null;
  revoked_at: number | null;
  last_used_at: number | null;
  uses: number;
  created_at: number;
}

export interface JoinedApiKey extends ApiKeyRow {
  scene_ulid: string | null;
  scene_title: string | null;
}

const SELECT = `
  SELECT k.*, s.ulid AS scene_ulid, s.title AS scene_title
    FROM api_keys k
    LEFT JOIN scenes s ON s.id = k.scene_id
`;

const PREFIX = "onsen_";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function listApiKeys(db: Database): JoinedApiKey[] {
  return db.query(`${SELECT} ORDER BY k.created_at DESC`).all() as JoinedApiKey[];
}

export function findApiKey(db: Database, keyUlid: string): JoinedApiKey | null {
  return db.query(`${SELECT} WHERE k.ulid = $ulid`).get({ ulid: keyUlid }) as JoinedApiKey | null;
}

/** The key a presented token belongs to, or null. Revoked keys do not match. */
export function keyForToken(db: Database, token: string): JoinedApiKey | null {
  const row = db
    .query(`${SELECT} WHERE k.token_hash = $hash AND k.revoked_at IS NULL`)
    .get({ hash: hashToken(token) }) as JoinedApiKey | null;
  if (row === null) return null;
  // The index found it by equality already; this is the constant-time compare
  // that keeps the *verification* from being the timing side channel, which is
  // the part an attacker can drive.
  const presented = Buffer.from(hashToken(token), "hex");
  const stored = Buffer.from(row.token_hash, "hex");
  if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) return null;
  return row;
}

export interface NewApiKey {
  name: string;
  sceneId: number | null;
}

/** Mint a key. The plaintext is returned once and never stored. */
export function insertApiKey(
  db: Database,
  input: NewApiKey,
): { row: JoinedApiKey; token: string } {
  const token = `${PREFIX}${randomBytes(32).toString("base64url")}`;
  const created = db
    .query(
      `INSERT INTO api_keys (ulid, name, token_hash, token_hint, scene_id, created_at)
       VALUES ($ulid, $name, $hash, $hint, $scene, $now)
       RETURNING ulid`,
    )
    .get({
      ulid: ulid(),
      name: input.name,
      hash: hashToken(token),
      // Enough to recognise a key in a list, far too little to reconstruct one.
      hint: token.slice(0, PREFIX.length + 6),
      scene: input.sceneId,
      now: Date.now(),
    }) as { ulid: string };
  const row = findApiKey(db, created.ulid);
  if (row === null) throw new Error("the key vanished between insert and read");
  return { row, token };
}

/**
 * Revoke rather than delete, so the usage log a key left behind still says
 * whose it was — which is the whole point of keeping one.
 */
export function revokeApiKey(db: Database, id: number): void {
  db.query("UPDATE api_keys SET revoked_at = $now WHERE id = $id AND revoked_at IS NULL").run({
    id,
    now: Date.now(),
  });
}

export function deleteApiKey(db: Database, id: number): void {
  db.query("DELETE FROM api_keys WHERE id = $id").run({ id });
}

export function noteUse(db: Database, id: number): void {
  db.query("UPDATE api_keys SET uses = uses + 1, last_used_at = $now WHERE id = $id").run({
    id,
    now: Date.now(),
  });
}

export interface ApiRequestRow {
  id: number;
  key_id: number | null;
  model: string;
  status: number;
  warning: string | null;
  duration_ms: number;
  created_at: number;
}

/** How many requests one key keeps. A diagnostic, not an archive. */
const REQUEST_HISTORY = 50;

export function recordRequest(
  db: Database,
  keyId: number | null,
  input: { model: string; status: number; warning: string | null; durationMs: number },
): void {
  db.query(
    `INSERT INTO api_requests (key_id, model, status, warning, duration_ms, created_at)
     VALUES ($key, $model, $status, $warning, $duration, $now)`,
  ).run({
    key: keyId,
    model: input.model,
    status: input.status,
    warning: input.warning,
    duration: input.durationMs,
    now: Date.now(),
  });
  if (keyId === null) return;
  db.query(
    `DELETE FROM api_requests
      WHERE key_id = $key
        AND id NOT IN (
          SELECT id FROM api_requests WHERE key_id = $key ORDER BY id DESC LIMIT $keep
        )`,
  ).run({ key: keyId, keep: REQUEST_HISTORY });
}

export function listRequests(db: Database, keyId: number, limit = 20): ApiRequestRow[] {
  return db
    .query("SELECT * FROM api_requests WHERE key_id = $key ORDER BY id DESC LIMIT $limit")
    .all({ key: keyId, limit }) as ApiRequestRow[];
}
