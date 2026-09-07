import type { Database } from "bun:sqlite";
import { ulid } from "../../lib/ulid.ts";

/**
 * Installed extensions (§20 phase 110): the directory the code lives in, so
 * startup can reload it and uninstall can remove it.
 */

export interface ExtensionRow {
  id: number;
  ulid: string;
  name: string;
  version: string;
  author: string;
  dir: string;
  created_at: number;
  updated_at: number;
}

export function listExtensions(db: Database): ExtensionRow[] {
  return db.query("SELECT * FROM extensions ORDER BY name").all() as ExtensionRow[];
}

export function insertExtension(
  db: Database,
  input: { name: string; version: string; author: string; dir: string },
): ExtensionRow {
  const now = Date.now();
  return db
    .query(
      `INSERT INTO extensions (ulid, name, version, author, dir, created_at, updated_at)
       VALUES ($ulid, $name, $version, $author, $dir, $now, $now) RETURNING *`,
    )
    .get({ ulid: ulid(), name: input.name, version: input.version, author: input.author, dir: input.dir, now }) as ExtensionRow;
}
