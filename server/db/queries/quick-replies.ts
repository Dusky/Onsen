import type { Database } from "bun:sqlite";
import { ulid } from "../../lib/ulid.ts";
import type { QuickReplyDirection } from "../../../shared/types.ts";

/**
 * Storage for §7's quick replies (SPEC §20 phase 65).
 *
 * A quick reply is a labelled prompt the reader fires from the composer with
 * one tap. It runs through the nudge path — a one-shot instruction for the
 * next turn, never persisted as a message — so nothing here touches the
 * generation service; it is rows and order, and the client is the caller.
 */

export interface QuickReplyRow {
  id: number;
  ulid: string;
  label: string;
  prompt: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

const SELECT = "SELECT id, ulid, label, prompt, sort_order, created_at, updated_at FROM quick_replies";

/** Every reply, in the reader's order. Lower runs first. */
export function listQuickReplies(db: Database): QuickReplyRow[] {
  return db.query(`${SELECT} ORDER BY sort_order, ulid`).all() as QuickReplyRow[];
}

export function findQuickReply(db: Database, replyUlid: string): QuickReplyRow | null {
  return (db.query(`${SELECT} WHERE ulid = $ulid`).get({ ulid: replyUlid }) ?? null) as
    | QuickReplyRow
    | null;
}

/** A new reply goes to the end of the row, the way a new script goes to the end of its stage. */
function nextSortOrder(db: Database): number {
  const row = db.query("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM quick_replies").get() as {
    n: number;
  };
  return row.n;
}

export function insertQuickReply(
  db: Database,
  input: { label: string; prompt: string },
): QuickReplyRow {
  const now = Date.now();
  const row = db
    .query(
      `INSERT INTO quick_replies (ulid, label, prompt, sort_order, created_at, updated_at)
       VALUES ($ulid, $label, $prompt, $sort, $now, $now)
       RETURNING ulid`,
    )
    .get({
      ulid: ulid(),
      label: input.label,
      prompt: input.prompt,
      sort: nextSortOrder(db),
      now,
    }) as { ulid: string };
  const stored = findQuickReply(db, row.ulid);
  if (stored === null) throw new Error("the quick reply vanished between insert and read");
  return stored;
}

export interface QuickReplyPatch {
  label?: string;
  prompt?: string;
}

const COLUMNS: Record<keyof QuickReplyPatch, string> = {
  label: "label",
  prompt: "prompt",
};

export function updateQuickReply(db: Database, id: number, patch: QuickReplyPatch): void {
  const sets: string[] = [];
  const values: Record<string, string | number> = { id, now: Date.now() };
  for (const [key, column] of Object.entries(COLUMNS) as [keyof QuickReplyPatch, string][]) {
    const value = patch[key];
    if (value === undefined) continue;
    sets.push(`${column} = $${column}`);
    values[column] = value;
  }
  if (sets.length === 0) return;
  db.query(`UPDATE quick_replies SET ${sets.join(", ")}, updated_at = $now WHERE id = $id`).run(
    values,
  );
}

/**
 * Move a reply one place, swapping `sort_order` with its neighbour.
 *
 * The swap is one transaction so a crash cannot leave two replies with the
 * same order — `sort_order` is not unique, and nothing else re-reads it
 * between the two writes anyway, but a partial move would be a silent reorder.
 * Returns false when the reply is already at the requested end.
 */
export function moveQuickReply(
  db: Database,
  replyUlid: string,
  direction: QuickReplyDirection,
): boolean {
  const ordered = listQuickReplies(db);
  const at = ordered.findIndex((row) => row.ulid === replyUlid);
  if (at === -1) return false;
  const neighbour = direction === "up" ? at - 1 : at + 1;
  if (neighbour < 0 || neighbour >= ordered.length) return false;
  const a = ordered[at]!;
  const b = ordered[neighbour]!;
  const now = Date.now();
  db.transaction(() => {
    db.query("UPDATE quick_replies SET sort_order = $order, updated_at = $now WHERE id = $id").run({
      order: b.sort_order,
      now,
      id: a.id,
    });
    db.query("UPDATE quick_replies SET sort_order = $order, updated_at = $now WHERE id = $id").run({
      order: a.sort_order,
      now,
      id: b.id,
    });
  })();
  return true;
}

export function deleteQuickReply(db: Database, id: number): void {
  db.query("DELETE FROM quick_replies WHERE id = $id").run({ id });
}
