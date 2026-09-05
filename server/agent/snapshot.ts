/**
 * What the agent changed, and what it looked like before (SPEC §20 phase 46).
 *
 * Not a permission gate — this is a single-user app on a LAN and the reader can
 * already delete any of this in two taps. It is an undo, which the app mostly
 * did not have: `character_versions` was the only history of any edit, so
 * before this a deleted lorebook or a rewritten theme was simply gone.
 *
 * Stored as the DTO rather than the row, because a DTO is what the routes
 * already accept back and is stable across a schema change in a way a row is
 * not.
 */
import type { AppContext } from "../context.ts";
import { ulid } from "../lib/ulid.ts";
import { setSetting, getSetting } from "../db/queries/settings.ts";

const KEY = "agent_undo";
/** Enough to walk back a session's worth of work, not enough to grow forever. */
const KEEP = 40;

export interface Snapshot {
  id: string;
  kind: string;
  subjectId: string;
  /** The DTO as it was, JSON-encoded. */
  before: string;
  at: number;
}

function read(ctx: AppContext): Snapshot[] {
  const raw = getSetting(ctx.db, KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Snapshot[]) : [];
  } catch {
    return [];
  }
}

/**
 * Remember the current state of something the agent is about to change.
 *
 * Never throws: an undo that fails to record must not be the reason a tool call
 * fails. Losing the undo is worse than not having it, and both are better than
 * losing the operation.
 */
export function snapshotBefore(
  ctx: AppContext,
  kind: string,
  subjectId: string,
  before: unknown,
): void {
  try {
    const entry: Snapshot = {
      id: ulid(),
      kind,
      subjectId,
      before: JSON.stringify(before),
      at: Date.now(),
    };
    setSetting(ctx.db, KEY, JSON.stringify([entry, ...read(ctx)].slice(0, KEEP)));
  } catch {
    /* An undo is a courtesy; the operation is the point. */
  }
}

/** Everything the agent has overwritten or removed, newest first. */
export function snapshots(ctx: AppContext): Snapshot[] {
  return read(ctx);
}
