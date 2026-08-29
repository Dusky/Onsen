import type { Database } from "bun:sqlite";
import { ulid } from "../../lib/ulid.ts";
import { createEstimatingTokenizer } from "../../prompt/index.ts";
import type { GuideDto } from "../../../shared/types.ts";
import { GUIDE_KINDS, guideOpKey, opKind, type GuideKind } from "../../tasks/registry.ts";
import { activePath } from "./history.ts";

/**
 * Persistent guides (SPEC §8).
 *
 * The whole design turns on one line of the spec: guides are **versioned per
 * message, so rewinding rewinds them**. A guide is therefore not one mutable
 * row per scene but a row per version, anchored to the message it was written
 * after; the version that counts is the newest whose anchor is on the active
 * path. Swiping away from a turn swipes away the state that turn produced,
 * which is the only thing that makes sense once history is a tree.
 */

export interface GuideRow {
  id: number;
  ulid: string;
  scene_id: number;
  kind: GuideKind;
  content: string;
  message_id: number | null;
  token_count: number;
  is_pinned: number;
  created_at: number;
  updated_at: number;
}

/**
 * The guides in force right now: for each kind, the newest version anchored to
 * a message on the active path, or to no message at all.
 */
export function activeGuides(db: Database, sceneId: number): GuideRow[] {
  const onPath = new Set(activePath(db, sceneId).map((row) => row.id));
  const rows = db
    .query("SELECT * FROM guides WHERE scene_id = $scene ORDER BY id DESC")
    .all({ scene: sceneId }) as GuideRow[];

  const found = new Map<GuideKind, GuideRow>();
  for (const row of rows) {
    if (found.has(row.kind)) continue;
    // A version anchored to a message that is not on the path belongs to a
    // branch the reader has swiped away from.
    if (row.message_id !== null && !onPath.has(row.message_id)) continue;
    found.set(row.kind, row);
  }
  // Stable order, so the panel does not reshuffle itself between refreshes.
  return GUIDE_KINDS.map((kind) => found.get(kind)).filter(
    (row): row is GuideRow => row !== undefined,
  );
}

export function activeGuideOf(db: Database, sceneId: number, kind: GuideKind): GuideRow | null {
  return activeGuides(db, sceneId).find((row) => row.kind === kind) ?? null;
}

export interface NewGuideVersion {
  sceneId: number;
  kind: GuideKind;
  content: string;
  /** The message this version was written after. Null on an empty scene. */
  messageId: number | null;
  pinned?: boolean;
}

/**
 * Write a new version. Never an update: a version belongs to the point in the
 * history it was written at, and overwriting it would make rewinding a lie.
 */
export function writeGuide(db: Database, input: NewGuideVersion): GuideRow {
  const now = Date.now();
  return db
    .query(
      `INSERT INTO guides
         (ulid, scene_id, kind, content, message_id, token_count, is_pinned, created_at, updated_at)
       VALUES ($ulid, $scene, $kind, $content, $message, $tokens, $pinned, $now, $now)
       RETURNING *`,
    )
    .get({
      ulid: ulid(),
      scene: input.sceneId,
      kind: input.kind,
      content: input.content,
      message: input.messageId,
      tokens: createEstimatingTokenizer().count(input.content),
      pinned: input.pinned === true ? 1 : 0,
      now,
    }) as GuideRow;
}

/**
 * A hand edit changes the version in place rather than making a new one, and
 * pins it. SPEC §8 makes guides hand-editable; a refresh that then overwrote
 * what a person wrote would make the edit pointless.
 */
export function editGuide(db: Database, id: number, content: string): GuideRow {
  return db
    .query(
      `UPDATE guides
          SET content = $content, token_count = $tokens, is_pinned = 1, updated_at = $now
        WHERE id = $id
        RETURNING *`,
    )
    .get({
      id,
      content,
      tokens: createEstimatingTokenizer().count(content),
      now: Date.now(),
    }) as GuideRow;
}

export function findGuide(db: Database, value: string): GuideRow | null {
  return (db.query("SELECT * FROM guides WHERE ulid = $ulid").get({ ulid: value }) ??
    null) as GuideRow | null;
}

/**
 * Flush one kind, or all of them (SPEC §8). Every version goes, not just the
 * active one: a flush means "stop injecting this", and leaving older versions
 * behind would resurrect one the moment the reader rewound.
 */
export function flushGuides(db: Database, sceneId: number, kind: GuideKind | null): void {
  if (kind === null) {
    db.query("DELETE FROM guides WHERE scene_id = $scene").run({ scene: sceneId });
    return;
  }
  db.query("DELETE FROM guides WHERE scene_id = $scene AND kind = $kind").run({
    scene: sceneId,
    kind,
  });
}

export function toGuideDto(row: GuideRow): GuideDto {
  return {
    id: row.ulid,
    kind: row.kind,
    label: opKind(guideOpKey(row.kind))?.label ?? row.kind,
    content: row.content,
    tokenCount: row.token_count,
    /** A person wrote this version, so a refresh leaves it alone. */
    isPinned: row.is_pinned === 1,
    updatedAt: row.updated_at,
  };
}
