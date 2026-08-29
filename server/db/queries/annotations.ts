import type { Database } from "bun:sqlite";
import { ulid } from "../../lib/ulid.ts";
import type { AnnotationDto } from "../../../shared/types.ts";
import { updateMessage, type MessageRow } from "./history.ts";

/**
 * What the post-generation passes found (SPEC §7.5).
 *
 * `ok` is stored as well as `flagged`, because "the voice pass ran and was
 * happy" and "the voice pass never ran" are different things for a reader to
 * know, and a pipeline whose silence is ambiguous is a pipeline nobody trusts.
 */

export interface AnnotationRow {
  id: number;
  ulid: string;
  message_id: number;
  pass_key: string;
  segment_ordinal: number | null;
  status: "ok" | "flagged" | "revised" | "failed";
  detail: string | null;
  original_content: string | null;
  created_at: number;
}

export interface NewAnnotation {
  messageId: number;
  passKey: string;
  segmentOrdinal: number | null;
  status: AnnotationRow["status"];
  detail: string | null;
  /** What the message said before a `revised` pass changed it. */
  originalContent?: string | null;
}

/**
 * Record a finding, replacing any earlier one from the same pass on the same
 * part. Running a pass twice should leave one verdict, not a history of them —
 * the log of *runs* is the task log's job (§7).
 */
export function recordAnnotation(db: Database, input: NewAnnotation): AnnotationRow {
  db.query(
    `DELETE FROM message_annotations
      WHERE message_id = $message AND pass_key = $key
        AND ((segment_ordinal IS NULL AND $ordinal IS NULL) OR segment_ordinal = $ordinal)`,
  ).run({ message: input.messageId, key: input.passKey, ordinal: input.segmentOrdinal });

  return db
    .query(
      `INSERT INTO message_annotations
         (ulid, message_id, pass_key, segment_ordinal, status, detail, original_content, created_at)
       VALUES ($ulid, $message, $key, $ordinal, $status, $detail, $original, $now)
       RETURNING *`,
    )
    .get({
      ulid: ulid(),
      message: input.messageId,
      key: input.passKey,
      ordinal: input.segmentOrdinal,
      status: input.status,
      detail: input.detail,
      original: input.originalContent ?? null,
      now: Date.now(),
    }) as AnnotationRow;
}

export function annotationsOf(db: Database, messageId: number): AnnotationRow[] {
  return db
    .query("SELECT * FROM message_annotations WHERE message_id = $id ORDER BY id")
    .all({ id: messageId }) as AnnotationRow[];
}

export function findAnnotation(db: Database, value: string): AnnotationRow | null {
  return (db.query("SELECT * FROM message_annotations WHERE ulid = $ulid").get({ ulid: value }) ??
    null) as AnnotationRow | null;
}

/** Whether the pipeline is still working on this message. */
export function setPassesPending(db: Database, messageId: number, pending: boolean): void {
  db.query("UPDATE messages SET passes_pending = $pending WHERE id = $id").run({
    id: messageId,
    pending: pending ? 1 : 0,
  });
}

/**
 * Put back what a pass changed (SPEC §7.5: the original is always retained so
 * the user can see and revert). The annotation goes with it — a revert is not a
 * finding to keep, it is the finding being rejected.
 */
export function revertAnnotation(db: Database, row: AnnotationRow, message: MessageRow): MessageRow {
  if (row.original_content !== null) {
    updateMessage(db, message.id, { content: row.original_content });
  }
  db.query("DELETE FROM message_annotations WHERE id = $id").run({ id: row.id });
  return message;
}

export function toAnnotationDto(row: AnnotationRow, label: string): AnnotationDto {
  return {
    id: row.ulid,
    passKey: row.pass_key,
    passLabel: label,
    segmentOrdinal: row.segment_ordinal,
    status: row.status,
    detail: row.detail,
    /** A revision can be undone; a flag has nothing to undo. */
    revertable: row.original_content !== null,
    createdAt: row.created_at,
  };
}
