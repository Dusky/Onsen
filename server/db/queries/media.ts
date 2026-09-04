import type { Database } from "bun:sqlite";
import type { MediaAssetDto } from "../../../shared/types.ts";
import { ulid } from "../../lib/ulid.ts";

/**
 * Media services and the things they made (SPEC §20 phase 41).
 *
 * Two tables with very different lifetimes. A service is configuration, edited
 * rarely and read on every generation. An asset is a fact about a moment, and
 * cascades away with the message or scene it belongs to.
 */

export interface MediaServiceRow {
  id: number;
  ulid: string;
  name: string;
  purpose: "image" | "speech";
  kind: string;
  base_url: string | null;
  api_key_encrypted: string | null;
  model: string | null;
  options: string;
  enabled: number;
  is_default: number;
  created_at: number;
  updated_at: number;
}

export interface MediaAssetRow {
  id: number;
  ulid: string;
  kind: "image" | "audio";
  role: "illustration" | "speech" | "attachment";
  path: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  prompt: string | null;
  caption: string | null;
  service_id: number | null;
  message_id: number | null;
  character_id: number | null;
  scene_id: number | null;
  /** Not drawn in the log (§20 phase 41). Independent of `in_prompt`. */
  is_hidden: number;
  /** Whether this asset's caption reaches the prompt. Attachments only. */
  in_prompt: number;
  created_at: number;
  updated_at: number;
}

/* ---------------- services ---------------- */

export function listServices(db: Database, purpose?: "image" | "speech"): MediaServiceRow[] {
  return (
    purpose === undefined
      ? db.query("SELECT * FROM media_services ORDER BY purpose, name").all()
      : db
          .query("SELECT * FROM media_services WHERE purpose = $purpose ORDER BY name")
          .all({ purpose })
  ) as MediaServiceRow[];
}

export function findService(db: Database, id: string): MediaServiceRow | null {
  return db.query("SELECT * FROM media_services WHERE ulid = $id").get({ id }) as
    | MediaServiceRow
    | null;
}

/**
 * The service a generation uses when nothing named one.
 *
 * Enabled and default, in that order: a reader who switched a service off meant
 * it, and silently falling back to it because it still holds the default flag
 * would be the app overruling them.
 */
export function defaultService(
  db: Database,
  purpose: "image" | "speech",
): MediaServiceRow | null {
  const preferred = db
    .query(
      "SELECT * FROM media_services WHERE purpose = $purpose AND is_default = 1 AND enabled = 1",
    )
    .get({ purpose }) as MediaServiceRow | null;
  if (preferred !== null) return preferred;
  return db
    .query(
      "SELECT * FROM media_services WHERE purpose = $purpose AND enabled = 1 ORDER BY id LIMIT 1",
    )
    .get({ purpose }) as MediaServiceRow | null;
}

export interface NewMediaService {
  name: string;
  purpose: "image" | "speech";
  kind: string;
  baseUrl: string | null;
  apiKeyEncrypted: string | null;
  model: string | null;
  options: string;
}

export function insertService(db: Database, input: NewMediaService): MediaServiceRow {
  const now = Date.now();
  const row = db
    .query(
      `INSERT INTO media_services
         (ulid, name, purpose, kind, base_url, api_key_encrypted, model, options,
          enabled, is_default, created_at, updated_at)
       VALUES ($ulid, $name, $purpose, $kind, $base, $key, $model, $options, 1, 0, $now, $now)
       RETURNING *`,
    )
    .get({
      ulid: ulid(),
      name: input.name,
      purpose: input.purpose,
      kind: input.kind,
      base: input.baseUrl,
      key: input.apiKeyEncrypted,
      model: input.model,
      options: input.options,
      now,
    }) as MediaServiceRow;
  // The first service for a purpose becomes its default, so a reader who adds
  // one and presses the button gets a picture rather than "nothing configured".
  if (listServices(db, input.purpose).length === 1) makeDefault(db, row.id, input.purpose);
  return findService(db, row.ulid)!;
}

export interface MediaServicePatch {
  name?: string;
  kind?: string;
  base_url?: string | null;
  api_key_encrypted?: string | null;
  model?: string | null;
  options?: string;
  enabled?: number;
}

export function updateService(
  db: Database,
  id: number,
  patch: MediaServicePatch,
): MediaServiceRow {
  const assignments: string[] = [];
  const params: Record<string, string | number | null> = { id, now: Date.now() };
  for (const [column, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    assignments.push(`${column} = $${column}`);
    params[column] = value as string | number | null;
  }
  if (assignments.length > 0) {
    db.query(
      `UPDATE media_services SET ${assignments.join(", ")}, updated_at = $now WHERE id = $id`,
    ).run(params);
  }
  return db.query("SELECT * FROM media_services WHERE id = $id").get({ id }) as MediaServiceRow;
}

/** One default per purpose, which the partial unique index also enforces. */
export function makeDefault(db: Database, id: number, purpose: "image" | "speech"): void {
  db.transaction(() => {
    db.query("UPDATE media_services SET is_default = 0 WHERE purpose = $purpose").run({ purpose });
    db.query("UPDATE media_services SET is_default = 1 WHERE id = $id").run({ id });
  })();
}

export function deleteService(db: Database, id: number): void {
  db.query("DELETE FROM media_services WHERE id = $id").run({ id });
}

/* ---------------- assets ---------------- */

export interface NewMediaAsset {
  kind: "image" | "audio";
  role: "illustration" | "speech" | "attachment";
  path: string;
  mime: string;
  bytes: number;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  prompt?: string | null;
  caption?: string | null;
  serviceId?: number | null;
  messageId?: number | null;
  characterId?: number | null;
  sceneId?: number | null;
}

export function insertAsset(db: Database, input: NewMediaAsset): MediaAssetRow {
  const now = Date.now();
  return db
    .query(
      `INSERT INTO media_assets
         (ulid, kind, role, path, mime, bytes, width, height, duration_ms, prompt,
          caption, service_id, message_id, character_id, scene_id, created_at, updated_at)
       VALUES ($ulid, $kind, $role, $path, $mime, $bytes, $width, $height, $duration,
               $prompt, $caption, $service, $message, $character, $scene, $now, $now)
       RETURNING *`,
    )
    .get({
      ulid: ulid(),
      kind: input.kind,
      role: input.role,
      path: input.path,
      mime: input.mime,
      bytes: input.bytes,
      width: input.width ?? null,
      height: input.height ?? null,
      duration: input.durationMs ?? null,
      prompt: input.prompt ?? null,
      caption: input.caption ?? null,
      service: input.serviceId ?? null,
      message: input.messageId ?? null,
      character: input.characterId ?? null,
      scene: input.sceneId ?? null,
      now,
    }) as MediaAssetRow;
}

export function findAsset(db: Database, id: string): MediaAssetRow | null {
  return db.query("SELECT * FROM media_assets WHERE ulid = $id").get({ id }) as
    | MediaAssetRow
    | null;
}

/** Everything hanging off one message, newest last so a retry reads as a retry. */
export function assetsForMessages(db: Database, messageIds: number[]): MediaAssetRow[] {
  if (messageIds.length === 0) return [];
  const placeholders = messageIds.map((_, index) => `$m${index}`).join(", ");
  const params = Object.fromEntries(messageIds.map((id, index) => [`m${index}`, id]));
  return db
    .query(`SELECT * FROM media_assets WHERE message_id IN (${placeholders}) ORDER BY id`)
    .all(params) as MediaAssetRow[];
}

/** Attachments a scene is holding that have not been sent with a turn yet. */
export function pendingAttachments(db: Database, sceneId: number): MediaAssetRow[] {
  return db
    .query(
      `SELECT * FROM media_assets
        WHERE scene_id = $scene AND role = 'attachment' AND message_id IS NULL
        ORDER BY id`,
    )
    .all({ scene: sceneId }) as MediaAssetRow[];
}

export function attachToMessage(db: Database, assetId: number, messageId: number): void {
  db.query("UPDATE media_assets SET message_id = $message, updated_at = $now WHERE id = $id").run({
    id: assetId,
    message: messageId,
    now: Date.now(),
  });
}

/**
 * Where a picture appears, on each of the two axes it can appear on.
 *
 * Separate from `setCaption` because these are the reader's decisions and that
 * one is the model's — nothing that runs unattended may flip these.
 */
export function setVisibility(
  db: Database,
  assetId: number,
  patch: { hidden?: boolean; inPrompt?: boolean },
): void {
  const assignments: string[] = [];
  const params: Record<string, number> = { id: assetId, now: Date.now() };
  if (patch.hidden !== undefined) {
    assignments.push("is_hidden = $hidden");
    params["hidden"] = patch.hidden ? 1 : 0;
  }
  if (patch.inPrompt !== undefined) {
    assignments.push("in_prompt = $in_prompt");
    params["in_prompt"] = patch.inPrompt ? 1 : 0;
  }
  if (assignments.length === 0) return;
  db.query(
    `UPDATE media_assets SET ${assignments.join(", ")}, updated_at = $now WHERE id = $id`,
  ).run(params);
}

export function setCaption(db: Database, assetId: number, caption: string): void {
  db.query("UPDATE media_assets SET caption = $caption, updated_at = $now WHERE id = $id").run({
    id: assetId,
    caption,
    now: Date.now(),
  });
}

/**
 * Delete a row, and say whether its bytes are now unreferenced.
 *
 * The caller unlinks only when this returns true. Content addressing means two
 * rows can share a file, and deleting the file under the other one would be a
 * broken picture with no way to explain itself.
 */
export function deleteAsset(db: Database, asset: MediaAssetRow): boolean {
  db.query("DELETE FROM media_assets WHERE id = $id").run({ id: asset.id });
  const remaining = db
    .query("SELECT COUNT(*) AS n FROM media_assets WHERE path = $path")
    .get({ path: asset.path }) as { n: number };
  return remaining.n === 0;
}

/**
 * An asset as the client reads it.
 *
 * Here rather than in the route because the message mapper needs it too, and a
 * queries module importing from /routes would be the wrong direction.
 */
export function toMediaAssetDto(row: MediaAssetRow): MediaAssetDto {
  return {
    id: row.ulid,
    kind: row.kind,
    role: row.role,
    /** Served by this app, never by the provider that made it. */
    url: `/api/media/files/${row.ulid}`,
    mime: row.mime,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    prompt: row.prompt,
    caption: row.caption,
    hidden: row.is_hidden === 1,
    inPrompt: row.in_prompt === 1,
    createdAt: row.created_at,
  };
}
