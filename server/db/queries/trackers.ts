import type { Database } from "bun:sqlite";
import { ulid } from "../../lib/ulid.ts";
import { createEstimatingTokenizer } from "../../prompt/index.ts";
import { activePath } from "./history.ts";
import type { TrackerDto, TrackerKind } from "../../../shared/types.ts";

/**
 * Structured trackers (SPEC §8, §20 phase 31).
 *
 * The same versioned-row shape as guides — a row per version anchored to a
 * message, pinned on hand-edit, flushed in bulk — but the content is JSON, and
 * the parse rule is §8's: a malformed reply keeps the previous state rather
 * than replacing it with nothing.
 */

export interface TrackerRow {
  id: number;
  ulid: string;
  scene_id: number;
  kind: TrackerKind;
  content: string;
  message_id: number | null;
  token_count: number;
  is_pinned: number;
  created_at: number;
  updated_at: number;
}

export function activeTrackers(db: Database, sceneId: number): TrackerRow[] {
  const onPath = new Set(activePath(db, sceneId).map((row: { id: number }) => row.id));
  const rows = db
    .query("SELECT * FROM trackers WHERE scene_id = $scene ORDER BY id DESC")
    .all({ scene: sceneId }) as TrackerRow[];

  const found = new Map<TrackerKind, TrackerRow>();
  for (const row of rows) {
    if (found.has(row.kind)) continue;
    if (row.message_id !== null && !onPath.has(row.message_id)) continue;
    found.set(row.kind, row);
  }
  return (["scene", "characters"] as const)
    .map((kind) => found.get(kind))
    .filter((row): row is TrackerRow => row !== undefined);
}

export function activeTrackerOf(db: Database, sceneId: number, kind: TrackerKind): TrackerRow | null {
  return activeTrackers(db, sceneId).find((row) => row.kind === kind) ?? null;
}

export function writeTracker(db: Database, input: {
  sceneId: number;
  kind: TrackerKind;
  content: string;
  messageId: number | null;
  pinned: boolean;
}): TrackerRow {
  const tokenizer = createEstimatingTokenizer();
  const now = Date.now();
  return db
    .query(
      `INSERT INTO trackers (ulid, scene_id, kind, content, message_id, token_count, is_pinned, created_at, updated_at)
       VALUES ($ulid, $scene, $kind, $content, $message, $tokens, $pinned, $now, $now) RETURNING *`,
    )
    .get({
      ulid: ulid(),
      scene: input.sceneId,
      kind: input.kind,
      content: input.content,
      message: input.messageId,
      tokens: tokenizer.count(input.content),
      pinned: input.pinned ? 1 : 0,
      now,
    }) as TrackerRow;
}

export function editTracker(db: Database, id: number, content: string): TrackerRow {
  return db
    .query(
      `UPDATE trackers SET content = $content, is_pinned = 1, token_count = $tokens, updated_at = $now
        WHERE id = $id RETURNING *`,
    )
    .get({
      id,
      content,
      tokens: createEstimatingTokenizer().count(content),
      now: Date.now(),
    }) as TrackerRow;
}

export function findTracker(db: Database, value: string): TrackerRow | null {
  return (db.query("SELECT * FROM trackers WHERE ulid = $ulid").get({ ulid: value }) ??
    null) as TrackerRow | null;
}

export function flushTrackers(db: Database, sceneId: number, kind: TrackerKind | null): void {
  if (kind === null) db.query("DELETE FROM trackers WHERE scene_id = $scene").run({ scene: sceneId });
  else db.query("DELETE FROM trackers WHERE scene_id = $scene AND kind = $kind").run({ scene: sceneId, kind });
}

export function toTrackerDto(row: TrackerRow): TrackerDto {
  return {
    id: row.ulid,
    kind: row.kind,
    content: row.content,
    tokenCount: row.token_count,
    isPinned: row.is_pinned === 1,
    updatedAt: row.updated_at,
  };
}
