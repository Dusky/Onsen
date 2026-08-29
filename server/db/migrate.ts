import type { Database } from "bun:sqlite";
import { migrations as defaultMigrations, type Migration } from "./migrations/index.ts";

export interface MigrationResult {
  applied: number[];
  alreadyApplied: number[];
}

function ensureMigrationsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER NOT NULL PRIMARY KEY,
      name       TEXT    NOT NULL,
      applied_at INTEGER NOT NULL
    ) STRICT
  `);
}

function assertWellOrdered(list: readonly Migration[]): void {
  list.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(
        `migrations must be numbered from 1 with no gaps: expected version ${index + 1}, ` +
          `found ${migration.version} (${migration.name})`,
      );
    }
  });
}

/**
 * Apply every migration the database has not yet seen, in order, each in its own
 * transaction. Applied at boot (SPEC §1); calling it again is a no-op.
 */
export function migrate(
  db: Database,
  list: readonly Migration[] = defaultMigrations,
): MigrationResult {
  assertWellOrdered(list);
  ensureMigrationsTable(db);

  const seen = new Set(
    db
      .query("SELECT version FROM schema_migrations")
      .all()
      .map((row) => (row as { version: number }).version),
  );

  const result: MigrationResult = { applied: [], alreadyApplied: [] };
  const record = db.query(
    "INSERT INTO schema_migrations (version, name, applied_at) VALUES ($version, $name, $applied_at)",
  );

  for (const migration of list) {
    if (seen.has(migration.version)) {
      result.alreadyApplied.push(migration.version);
      continue;
    }
    // A migration that fails partway must leave no trace, or the next boot
    // applies half of it a second time.
    db.transaction(() => {
      db.exec(migration.sql);
      record.run({
        version: migration.version,
        name: migration.name,
        applied_at: Date.now(),
      });
    })();
    result.applied.push(migration.version);
  }

  return result;
}
