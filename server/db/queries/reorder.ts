import type { Database } from "bun:sqlite";
import type { MoveDirection } from "../../../shared/types.ts";

/**
 * Moving a row one place in a hand-ordered list (§14; the half-wired sweep).
 *
 * Regex scripts and event triggers have both persisted a `run_order` since
 * they were built, both read it (`scripts/apply.ts`, `triggers/select.ts`) to
 * break ties when several fire on the same stage or event, and neither had any
 * way to change it: the only reorder available was delete and recreate in the
 * order you wanted. `docs/GAPS.md` calls this the project's recurring shape —
 * the storage, the query and the DTO all present, and nothing in the UI
 * reaching them.
 *
 * The swap lives here rather than in the client for the reason
 * `moveQuickReply` gives, which is the same list problem solved in phase 65:
 * two rows change and a partial move is a silent reorder. Doing it as two
 * PATCHes from a browser would be exactly the shape the atomicity pass spent a
 * commit removing.
 *
 * **Order is per partition.** A script's `run_order` is only ever compared with
 * the other scripts at the same `apply_to` stage, and a trigger's with the
 * other triggers on the same `event` — that is what `nextOrder` means in both
 * files. So a move swaps with the next row *in the same partition*, and a row
 * that is last in its own stage does not trade places with the first row of the
 * next one, which would reorder two lists at once and look like a bug in both.
 */
export function moveInRunOrder(
  db: Database,
  // A literal union rather than a string, so no part of this can be
  // interpolated from a request — the rule `setAvatarPath` follows.
  table: "regex_scripts" | "event_triggers",
  partition: "apply_to" | "event",
  rowUlid: string,
  direction: MoveDirection,
): boolean {
  const row = db
    .query(`SELECT id, run_order, ${partition} AS part FROM ${table} WHERE ulid = $ulid`)
    .get({ ulid: rowUlid }) as { id: number; run_order: number; part: string } | null;
  if (row === null) return false;

  // The neighbour is the nearest row on the other side within the partition.
  // `ulid` breaks a tie the same way the list queries do, so the swap agrees
  // with the order the reader is looking at.
  const neighbour = db
    .query(
      direction === "up"
        ? `SELECT id, run_order FROM ${table}
           WHERE ${partition} = $part AND (run_order < $order OR (run_order = $order AND ulid < $ulid))
           ORDER BY run_order DESC, ulid DESC LIMIT 1`
        : `SELECT id, run_order FROM ${table}
           WHERE ${partition} = $part AND (run_order > $order OR (run_order = $order AND ulid > $ulid))
           ORDER BY run_order ASC, ulid ASC LIMIT 1`,
    )
    .get({ part: row.part, order: row.run_order, ulid: rowUlid }) as
    | { id: number; run_order: number }
    | null;
  if (neighbour === null) return false;

  const now = Date.now();
  db.transaction(() => {
    const write = db.query(
      `UPDATE ${table} SET run_order = $order, updated_at = $now WHERE id = $id`,
    );
    if (row.run_order === neighbour.run_order) {
      // Two rows can share a number — `nextOrder` prevents it on insert, but a
      // PATCH can still set one — and exchanging equal numbers moves nothing.
      // Stepping the row past its neighbour is the move it asked for.
      write.run({ order: row.run_order + (direction === "up" ? -1 : 1), now, id: row.id });
      return;
    }
    write.run({ order: neighbour.run_order, now, id: row.id });
    write.run({ order: row.run_order, now, id: neighbour.id });
  })();
  return true;
}
