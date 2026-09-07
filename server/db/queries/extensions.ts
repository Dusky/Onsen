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

/**
 * The extension a pack installed, matched by the name and version the pack was
 * installed under. `installExtensionCode` and `installPack` are handed the same
 * manifest, so the join is exact; `packs` rejects a second install of the same
 * name and version, so at most one row can match.
 */
export function findExtensionByNameVersion(
  db: Database,
  name: string,
  version: string,
): ExtensionRow | null {
  return (db
    .query("SELECT * FROM extensions WHERE name = $name AND version = $version ORDER BY id LIMIT 1")
    .get({ name, version }) as ExtensionRow | null) ?? null;
}

export function deleteExtension(db: Database, id: number): void {
  db.query("DELETE FROM extensions WHERE id = $id").run({ id });
}

/**
 * Remove an extension's task rows. Keys are `ext:<name>:<taskKey>`, so they are
 * addressed by prefix; the name is escaped because a `%` or `_` in a pack name
 * must not turn into a wildcard and swallow another extension's rows.
 */
export function deleteExtensionTasks(db: Database, name: string): void {
  const prefix = `ext:${name.replace(/[\\%_]/g, "\\$&")}:%`;
  db.query("DELETE FROM tasks WHERE key LIKE $prefix ESCAPE '\\'").run({ prefix });
}
