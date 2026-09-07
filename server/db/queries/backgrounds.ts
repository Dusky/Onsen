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
      `INSERT INTO backgrounds (ulid, path, prompt, is_default, created_at)
       VALUES ($ulid, $path, $prompt, $default, $now) RETURNING *`,
    )
    .get({ ulid: ulid(), path: input.path, prompt: input.prompt, default: isFirst ? 1 : 0, now }) as BackgroundRow;
}

export function setDefaultBackground(db: Database, id: number): BackgroundRow {
  db.query("UPDATE backgrounds SET is_default = 0 WHERE is_default = 1").run();
  return db
    .query("UPDATE backgrounds SET is_default = 1 WHERE id = $id RETURNING *")
    .get({ id }) as BackgroundRow;
}

export function deleteBackground(db: Database, id: number): void {
  db.query("DELETE FROM backgrounds WHERE id = $id").run({ id });
}
