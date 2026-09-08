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
  enabled: number;
  built_in: number;
  description: string | null;
  settings: string | null;
  settings_schema: string | null;
  created_at: number;
  updated_at: number;
}

export function listExtensions(db: Database): ExtensionRow[] {
  return db.query("SELECT * FROM extensions ORDER BY name").all() as ExtensionRow[];
}

export function findExtension(db: Database, extensionUlid: string): ExtensionRow | null {
  return (db.query("SELECT * FROM extensions WHERE ulid = $ulid").get({ ulid: extensionUlid }) as
    | ExtensionRow
    | null) ?? null;
}

/** A built-in is addressed by name, since it is seeded, not installed by id. */
export function findExtensionByName(db: Database, name: string): ExtensionRow | null {
  return (db
    .query("SELECT * FROM extensions WHERE name = $name AND built_in = 1 LIMIT 1")
    .get({ name }) as ExtensionRow | null) ?? null;
}

export function insertExtension(
  db: Database,
  input: {
    name: string;
    version: string;
    author: string;
    dir: string;
    description: string | null;
    settingsSchema: string | null;
    settings: string | null;
  },
): ExtensionRow {
  const now = Date.now();
  return db
    .query(
      `INSERT INTO extensions (ulid, name, version, author, dir, description, settings_schema, settings, enabled, created_at, updated_at)
       VALUES ($ulid, $name, $version, $author, $dir, $description, $schema, $settings, 1, $now, $now) RETURNING *`,
    )
    .get({
      ulid: ulid(),
      name: input.name,
      version: input.version,
      author: input.author,
      dir: input.dir,
      description: input.description,
      schema: input.settingsSchema,
      settings: input.settings,
      now,
    }) as ExtensionRow;
}

/** Seed a built-in's row; it is shipped disabled so it never surprises a user. */
export function insertBuiltinExtension(
  db: Database,
  input: {
    name: string;
    version: string;
    author: string;
    description: string;
    settingsSchema: string;
    settings: string;
  },
): ExtensionRow {
  const now = Date.now();
  return db
    .query(
      `INSERT INTO extensions (ulid, name, version, author, dir, description, settings_schema, settings, enabled, built_in, created_at, updated_at)
       VALUES ($ulid, $name, $version, $author, '', $description, $schema, $settings, 0, 1, $now, $now) RETURNING *`,
    )
    .get({
      ulid: ulid(),
      name: input.name,
      version: input.version,
      author: input.author,
      description: input.description,
      schema: input.settingsSchema,
      settings: input.settings,
      now,
    }) as ExtensionRow;
}

/** Enable or disable, and write settings; both take effect on the next reload. */
export function updateExtension(
  db: Database,
  id: number,
  patch: { enabled?: boolean; settings?: string },
): ExtensionRow {
  const current = db.query("SELECT * FROM extensions WHERE id = $id").get({ id }) as ExtensionRow;
  return db
    .query(
      `UPDATE extensions SET enabled = $enabled, settings = $settings, updated_at = $now
        WHERE id = $id RETURNING *`,
    )
    .get({
      id,
      enabled: patch.enabled === undefined ? current.enabled : patch.enabled ? 1 : 0,
      settings: patch.settings === undefined ? current.settings : patch.settings,
      now: Date.now(),
    }) as ExtensionRow;
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
