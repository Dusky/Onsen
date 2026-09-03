import type { Database } from "bun:sqlite";
import { ulid } from "../../lib/ulid.ts";
import type { WebhookEvent } from "../../webhooks/events.ts";

/** Storage for §15's outbound webhooks. */

export interface WebhookRow {
  id: number;
  ulid: string;
  name: string;
  url: string;
  secret: string;
  events: string;
  scene_id: number | null;
  enabled: number;
  failures: number;
  disabled_reason: string | null;
  created_at: number;
  updated_at: number;
}

export interface JoinedWebhook extends WebhookRow {
  scene_ulid: string | null;
}

const SELECT = `
  SELECT w.*, s.ulid AS scene_ulid
    FROM webhooks w
    LEFT JOIN scenes s ON s.id = w.scene_id
`;

export function parseEvents(json: string): WebhookEvent[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed.filter((v) => typeof v === "string") as WebhookEvent[]) : [];
  } catch {
    return [];
  }
}

export function listWebhooks(db: Database): JoinedWebhook[] {
  return db.query(`${SELECT} ORDER BY w.created_at`).all() as JoinedWebhook[];
}

export function findWebhook(db: Database, webhookUlid: string): JoinedWebhook | null {
  return db.query(`${SELECT} WHERE w.ulid = $ulid`).get({ ulid: webhookUlid }) as JoinedWebhook | null;
}

export interface NewWebhook {
  name: string;
  url: string;
  /** Already encrypted. This layer never sees a plaintext key. */
  secret: string;
  events: WebhookEvent[];
  sceneId: number | null;
  enabled: boolean;
}

export function insertWebhook(db: Database, input: NewWebhook): JoinedWebhook {
  const now = Date.now();
  const row = db
    .query(
      `INSERT INTO webhooks (ulid, name, url, secret, events, scene_id, enabled, created_at, updated_at)
       VALUES ($ulid, $name, $url, $secret, $events, $scene, $enabled, $now, $now)
       RETURNING ulid`,
    )
    .get({
      ulid: ulid(),
      name: input.name,
      url: input.url,
      secret: input.secret,
      events: JSON.stringify(input.events),
      scene: input.sceneId,
      enabled: input.enabled ? 1 : 0,
      now,
    }) as { ulid: string };
  const stored = findWebhook(db, row.ulid);
  if (stored === null) throw new Error("the webhook vanished between insert and read");
  return stored;
}

export interface WebhookPatch {
  name?: string;
  url?: string;
  secret?: string;
  events?: WebhookEvent[];
  enabled?: boolean;
}

export function updateWebhook(db: Database, id: number, patch: WebhookPatch): void {
  const sets: string[] = [];
  const values: Record<string, string | number | null> = { id, now: Date.now() };
  if (patch.name !== undefined) {
    sets.push("name = $name");
    values["name"] = patch.name;
  }
  if (patch.url !== undefined) {
    sets.push("url = $url");
    values["url"] = patch.url;
  }
  if (patch.secret !== undefined) {
    sets.push("secret = $secret");
    values["secret"] = patch.secret;
  }
  if (patch.events !== undefined) {
    sets.push("events = $events");
    values["events"] = JSON.stringify(patch.events);
  }
  if (patch.enabled !== undefined) {
    sets.push("enabled = $enabled");
    values["enabled"] = patch.enabled ? 1 : 0;
    // Switching one back on is the reader saying the receiver is fixed, so the
    // failure count that switched it off goes with it. Otherwise a single
    // further failure would disable it again immediately.
    if (patch.enabled) {
      sets.push("failures = 0", "disabled_reason = NULL");
    }
  }
  if (sets.length === 0) return;
  db.query(`UPDATE webhooks SET ${sets.join(", ")}, updated_at = $now WHERE id = $id`).run(values);
}

export function deleteWebhook(db: Database, id: number): void {
  db.query("DELETE FROM webhooks WHERE id = $id").run({ id });
}

export interface DeliveryRow {
  id: number;
  webhook_id: number;
  event: string;
  status: "ok" | "failed";
  response_code: number | null;
  detail: string | null;
  duration_ms: number;
  attempt: number;
  created_at: number;
}

/** How many deliveries one subscription keeps. Older ones are dropped. */
const DELIVERY_HISTORY = 50;

export function recordDelivery(
  db: Database,
  webhookId: number,
  input: {
    event: string;
    status: "ok" | "failed";
    responseCode: number | null;
    detail: string | null;
    durationMs: number;
    attempt: number;
  },
): void {
  db.query(
    `INSERT INTO webhook_deliveries
       (webhook_id, event, status, response_code, detail, duration_ms, attempt, created_at)
     VALUES ($hook, $event, $status, $code, $detail, $duration, $attempt, $now)`,
  ).run({
    hook: webhookId,
    event: input.event,
    status: input.status,
    code: input.responseCode,
    detail: input.detail,
    duration: input.durationMs,
    attempt: input.attempt,
    now: Date.now(),
  });

  // The log is a diagnostic, not an archive. A busy scene would otherwise write
  // a row per turn per subscription forever.
  db.query(
    `DELETE FROM webhook_deliveries
      WHERE webhook_id = $hook
        AND id NOT IN (
          SELECT id FROM webhook_deliveries WHERE webhook_id = $hook ORDER BY id DESC LIMIT $keep
        )`,
  ).run({ hook: webhookId, keep: DELIVERY_HISTORY });
}

export function listDeliveries(db: Database, webhookId: number, limit = 20): DeliveryRow[] {
  return db
    .query("SELECT * FROM webhook_deliveries WHERE webhook_id = $hook ORDER BY id DESC LIMIT $limit")
    .all({ hook: webhookId, limit }) as DeliveryRow[];
}

/** Count a failure, and switch the subscription off once it is clearly gone. */
export function noteFailure(db: Database, id: number, limit: number, reason: string): void {
  db.query("UPDATE webhooks SET failures = failures + 1, updated_at = $now WHERE id = $id").run({
    id,
    now: Date.now(),
  });
  const row = db.query("SELECT failures FROM webhooks WHERE id = $id").get({ id }) as
    | { failures: number }
    | null;
  if (row !== null && row.failures >= limit) {
    db.query(
      "UPDATE webhooks SET enabled = 0, disabled_reason = $reason, updated_at = $now WHERE id = $id",
    ).run({ id, reason, now: Date.now() });
  }
}

export function clearFailures(db: Database, id: number): void {
  db.query("UPDATE webhooks SET failures = 0 WHERE id = $id AND failures > 0").run({ id });
}
