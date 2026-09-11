import type { Database } from "bun:sqlite";
import { ulid } from "../../lib/ulid.ts";

/**
 * The library of generated backgrounds (§20 phase 108).
 *
 * One row is the default — the backdrop when no scene is open or the scene has
 * drawn none. A scene's own background still wins over it. Rows are generated,
 * never uploaded; the file lives under `data/backgrounds` like a scene's.
 */

export interface BackgroundRow {
  id: number;
  ulid: string;
  path: string;
  prompt: string | null;
  name: string | null;
  tags: string;
  folder: string | null;
  is_default: number;
  created_at: number;
}

export function listBackgrounds(db: Database): BackgroundRow[] {
  return db
    .query("SELECT * FROM backgrounds ORDER BY is_default DESC, created_at DESC")
    .all() as BackgroundRow[];
}

export function findBackground(db: Database, ulidValue: string): BackgroundRow | null {
  return (db
    .query("SELECT * FROM backgrounds WHERE ulid = $ulid")
    .get({ ulid: ulidValue }) ?? null) as BackgroundRow | null;
}

export function insertBackground(
  db: Database,
  input: { path: string; prompt: string | null },
): BackgroundRow {
  const now = Date.now();
  const isFirst = (db.query("SELECT count(*) AS n FROM backgrounds").get() as { n: number }).n === 0;
  return db
    .query(
      `INSERT INTO backgrounds (ulid, path, prompt, name, is_default, created_at)
       VALUES ($ulid, $path, $prompt, $name, $default, $now) RETURNING *`,
    )
    .get({ ulid: ulid(), path: input.path, prompt: input.prompt, name: input.prompt, default: isFirst ? 1 : 0, now }) as BackgroundRow;
}

/**
 * One statement, the way `setDefaultPreset` does it (`connections.ts`).
 *
 * This was "clear the old default, set the new" as two unguarded statements
 * against a table with a `WHERE is_default = 1` partial unique index: a throw
 * between them left **zero** rows default, which is a state no caller checks
 * for and no UI can show. The `CASE` form cannot land halfway.
 *
 * The row is re-read rather than returned by `RETURNING`, because this
 * statement touches every row and would return all of them.
 */
export function setDefaultBackground(db: Database, id: number): BackgroundRow {
  db.query("UPDATE backgrounds SET is_default = CASE id WHEN $id THEN 1 ELSE 0 END").run({ id });
  return db.query("SELECT * FROM backgrounds WHERE id = $id").get({ id }) as BackgroundRow;
}

export function deleteBackground(db: Database, id: number): void {
  db.query("DELETE FROM backgrounds WHERE id = $id").run({ id });
}
