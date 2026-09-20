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
/*
 * The kinds live in `shared/types.ts` because the client names each one in
 * words. A union rather than a bare string so the compiler is the first guard:
 * a tool recording a kind nothing restores does not typecheck, and
 * `restoreSnapshot`'s switch is exhaustive over exactly this. Phase 219 found
 * `snapshotBefore` called twice against nineteen write tools while the screen
 * promised every change was listed, which a `kind: string` could never have
 * caught.
 */
export { UNDO_KINDS, type UndoKind } from "../../shared/types.ts";
import type { UndoKind } from "../../shared/types.ts";

const KEY = "agent_undo";
/** Enough to walk back a session's worth of work, not enough to grow forever. */
const KEEP = 40;

export interface Snapshot {
  id: string;
  kind: UndoKind;
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
  kind: UndoKind,
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

/**
 * Remember that something did not exist before the agent made it.
 *
 * The same list and the same storage — this exists only so a create's call site
 * reads honestly, since the id it records can only be known *after* the insert
 * and `snapshotBefore` would be a lie about the order. Undoing one of these is
 * a delete, which is why what it stores is the new subject rather than an old
 * state.
 */
export function snapshotCreated(
  ctx: AppContext,
  kind: UndoKind,
  subjectId: string,
  what: unknown,
): void {
  snapshotBefore(ctx, kind, subjectId, what);
}

/** Everything the agent has overwritten or removed, newest first. */
export function snapshots(ctx: AppContext): Snapshot[] {
  return read(ctx);
}

/** One snapshot, by id, or null. */
export function snapshotById(ctx: AppContext, id: string): Snapshot | null {
  return read(ctx).find((entry) => entry.id === id) ?? null;
}

/** Take a snapshot off the list once it has been restored. */
export function removeSnapshot(ctx: AppContext, id: string): void {
  setSetting(ctx.db, KEY, JSON.stringify(read(ctx).filter((entry) => entry.id !== id)));
}
