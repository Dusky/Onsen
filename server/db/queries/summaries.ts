import type { Database } from "bun:sqlite";
import { ulid } from "../../lib/ulid.ts";
import { createEstimatingTokenizer } from "../../prompt/index.ts";
import type { SummaryDto } from "../../../shared/types.ts";
import { activePath, type MessageRow, type SceneRow } from "./history.ts";

/**
 * Rolling summarisation (SPEC §11 layer 1).
 *
 * A summary covers a run of messages, and the run is what makes it different
 * from a guide: a guide is the current state of one thing and there is exactly
 * one that counts, where a summary is a permanent record of a stretch of story
 * and they accumulate in order.
 *
 * They answer the tree the same way guides do, though. A summary counts only
 * when the last message it covers is on the active path, so rewinding past a
 * range un-injects the summary of it and a branch that never had those messages
 * never had their summary either.
 */

export interface SummaryRow {
  id: number;
  ulid: string;
  scene_id: number;
  content: string;
  covers_from_message_id: number;
  covers_to_message_id: number;
  message_count: number;
  token_count: number;
  level: number;
  superseded_by: number | null;
  is_edited: number;
  created_at: number;
  updated_at: number;
}

/**
 * Every summary belonging to the active path, oldest first.
 *
 * Superseded rows are excluded: a higher-level summary has taken over their
 * range, and injecting both would say the same thing twice at two levels of
 * detail. They are kept in the table rather than deleted, because condensing is
 * lossy and the longer record is what a reader wants back when the condensed
 * one turns out to have dropped the thing that mattered.
 */
export function activeSummaries(db: Database, sceneId: number): SummaryRow[] {
  const path = activePath(db, sceneId);
  const order = new Map(path.map((row, index) => [row.id, index]));
  const rows = db
    .query("SELECT * FROM summaries WHERE scene_id = $scene AND superseded_by IS NULL")
    .all({ scene: sceneId }) as SummaryRow[];

  return rows
    .filter((row) => order.has(row.covers_to_message_id))
    .sort((a, b) => order.get(a.covers_to_message_id)! - order.get(b.covers_to_message_id)!);
}

/**
 * Which summaries the prompt should carry, and which messages they cover.
 *
 * Three of §11's knobs meet here, and the order they are applied in is the
 * whole behaviour:
 *
 * **The freeze** comes first. Recomputing the injected set every turn moves the
 * prompt's prefix every turn, which is exactly what defeats a provider's prompt
 * cache — and the summary block sits near the front, so everything after it
 * moves too. Freezing rounds the leaf *down* to a multiple of N, so the set
 * changes once every N turns instead of always. It needs no stored state: the
 * same scene and the same path always compute the same frozen position.
 *
 * **The threshold** comes second, against that frozen position. §11 wants
 * summaries only for messages older than N, so that recent history is not
 * described and shown at the same time.
 *
 * **Eviction** is last and is the caller's business — this returns the covered
 * message ids and the prompt builder decides whether to drop them.
 */
export interface InjectedSummaries {
  summaries: SummaryRow[];
  /** Ids of the messages the injected summaries cover, for raw eviction. */
  coveredMessageIds: Set<number>;
}

export function injectedSummaries(
  db: Database,
  scene: SceneRow,
  path: MessageRow[] = activePath(db, scene.id),
): InjectedSummaries {
  const empty: InjectedSummaries = { summaries: [], coveredMessageIds: new Set() };
  if (scene.summarise === 0 || path.length === 0) return empty;

  const index = new Map(path.map((row, at) => [row.id, at]));
  const all = activeSummaries(db, scene.id).filter((row) => index.has(row.covers_to_message_id));
  if (all.length === 0) return empty;

  // The frozen position: the leaf, rounded down to a multiple of the freeze so
  // the answer only moves every N turns.
  const freeze = Math.max(1, scene.summarise_freeze);
  const frozenLength = path.length - (path.length % freeze);
  // A scene shorter than one freeze window has no frozen position yet, and
  // injecting nothing at all until turn N would be a worse lie than injecting
  // one window late. Fall back to the real length.
  const effectiveLength = frozenLength === 0 ? path.length : frozenLength;

  // Only ranges that end more than `threshold` messages before the frozen end.
  const cutoff = effectiveLength - Math.max(0, scene.summarise_threshold);
  const summaries = all.filter((row) => index.get(row.covers_to_message_id)! < cutoff);
  if (summaries.length === 0) return empty;

  const coveredMessageIds = new Set<number>();
  for (const row of summaries) {
    const from = index.get(row.covers_from_message_id);
    const to = index.get(row.covers_to_message_id)!;
    // A `from` that is off the path means the range was branched through its
    // middle; cover what is left of it rather than nothing.
    for (let at = from ?? 0; at <= to; at += 1) coveredMessageIds.add(path[at]!.id);
  }
  return { summaries, coveredMessageIds };
}

/**
 * The messages waiting to be summarised: everything on the active path after
 * the last summarised message, minus the tail the threshold protects.
 *
 * The tail matters. Summarising right up to the leaf would condense the turn
 * that just happened, and §11's threshold means it would not be injected for
 * another N messages anyway — so the work would be spent describing something
 * the prompt is still showing in full.
 */
export function pendingForSummary(
  db: Database,
  scene: SceneRow,
  path: MessageRow[] = activePath(db, scene.id),
): MessageRow[] {
  const index = new Map(path.map((row, at) => [row.id, at]));
  const summarised = activeSummaries(db, scene.id)
    .map((row) => index.get(row.covers_to_message_id))
    .filter((at): at is number => at !== undefined);
  const from = summarised.length === 0 ? 0 : Math.max(...summarised) + 1;
  const keepBack = Math.max(0, scene.summarise_threshold);
  const to = path.length - keepBack;
  return from >= to ? [] : path.slice(from, to);
}

/** Whether the pending run has crossed either of §11's two thresholds. */
export function summaryIsDue(pending: MessageRow[], scene: SceneRow): boolean {
  if (pending.length === 0) return false;
  if (pending.length >= scene.summarise_every_messages) return true;
  const words = pending.reduce((sum, row) => sum + countWords(row.content), 0);
  return words >= scene.summarise_every_words;
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

export interface NewSummary {
  sceneId: number;
  content: string;
  coversFromMessageId: number;
  coversToMessageId: number;
  messageCount: number;
  level?: number;
  isEdited?: boolean;
}

export function writeSummary(db: Database, input: NewSummary): SummaryRow {
  const now = Date.now();
  const tokenizer = createEstimatingTokenizer();
  const row = db
    .query(
      `INSERT INTO summaries
         (ulid, scene_id, content, covers_from_message_id, covers_to_message_id,
          message_count, token_count, level, is_edited, created_at, updated_at)
       VALUES ($ulid, $scene, $content, $from, $to, $count, $tokens, $level, $edited, $now, $now)
       RETURNING *`,
    )
    .get({
      ulid: ulid(),
      scene: input.sceneId,
      content: input.content,
      from: input.coversFromMessageId,
      to: input.coversToMessageId,
      count: input.messageCount,
      tokens: tokenizer.count(input.content),
      level: input.level ?? 0,
      edited: input.isEdited === true ? 1 : 0,
      now,
    }) as SummaryRow;
  return row;
}

/** Hand-editing marks the row, so regeneration leaves it alone (§11). */
export function editSummary(db: Database, id: number, content: string): SummaryRow {
  const tokenizer = createEstimatingTokenizer();
  return db
    .query(
      `UPDATE summaries
          SET content = $content, token_count = $tokens, is_edited = 1, updated_at = $now
        WHERE id = $id
       RETURNING *`,
    )
    .get({ id, content, tokens: tokenizer.count(content), now: Date.now() }) as SummaryRow;
}

/** Rewrite a summary the model produced, keeping its range (§11). */
export function replaceSummaryContent(db: Database, id: number, content: string): SummaryRow {
  const tokenizer = createEstimatingTokenizer();
  return db
    .query(
      `UPDATE summaries
          SET content = $content, token_count = $tokens, updated_at = $now
        WHERE id = $id
       RETURNING *`,
    )
    .get({ id, content, tokens: tokenizer.count(content), now: Date.now() }) as SummaryRow;
}

export function markSuperseded(db: Database, ids: number[], by: number): void {
  if (ids.length === 0) return;
  const statement = db.query("UPDATE summaries SET superseded_by = $by WHERE id = $id");
  for (const id of ids) statement.run({ by, id });
}

export function findSummary(db: Database, ulidOrId: string): SummaryRow | null {
  return (db.query("SELECT * FROM summaries WHERE ulid = $ulid").get({ ulid: ulidOrId }) ??
    null) as SummaryRow | null;
}

/**
 * Delete a summary outright, which is what "forget this" means. The messages it
 * covered become pending again, so the next trigger writes a new one.
 */
export function deleteSummary(db: Database, id: number): void {
  db.query("UPDATE summaries SET superseded_by = NULL WHERE superseded_by = $id").run({ id });
  db.query("DELETE FROM summaries WHERE id = $id").run({ id });
}

export function deleteSummaries(db: Database, sceneId: number): void {
  db.query("DELETE FROM summaries WHERE scene_id = $scene").run({ scene: sceneId });
}

export function toSummaryDto(db: Database, row: SummaryRow): SummaryDto {
  const ulidOf = (id: number): string => {
    const found = db.query("SELECT ulid FROM messages WHERE id = $id").get({ id }) as
      | { ulid: string }
      | undefined;
    return found?.ulid ?? "";
  };
  return {
    id: row.ulid,
    content: row.content,
    coversFromMessageId: ulidOf(row.covers_from_message_id),
    coversToMessageId: ulidOf(row.covers_to_message_id),
    messageCount: row.message_count,
    tokenCount: row.token_count,
    level: row.level,
    isEdited: row.is_edited === 1,
    updatedAt: row.updated_at,
  };
}
