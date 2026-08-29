import { describe, expect, test } from "bun:test";
import { openDatabase } from "../server/db/index.ts";
import { migrate } from "../server/db/migrate.ts";
import { migrations } from "../server/db/migrations/index.ts";

function tableNames(db: ReturnType<typeof openDatabase>): string[] {
  return (
    db.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((row) => row.name);
}

describe("migrations", () => {
  test("apply at boot and are idempotent", () => {
    const db = openDatabase(":memory:");
    const first = migrate(db);
    expect(first.applied).toEqual(migrations.map((m) => m.version));

    const second = migrate(db);
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toEqual(migrations.map((m) => m.version));
    db.close();
  });

  test("create the phase 1 foundation tables", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const names = tableNames(db);
    for (const expected of [
      "app_settings",
      "connection_profiles",
      "presets",
      "providers",
      "schema_migrations",
    ]) {
      expect(names).toContain(expected);
    }
    db.close();
  });

  test("set the pragmas the spec requires", () => {
    const db = openDatabase(":memory:");
    // An in-memory database reports "memory" for journal_mode; the pragma still
    // has to be accepted, and foreign keys must be on for the cascades to work.
    expect((db.query("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys).toBe(1);
    expect(
      (db.query("PRAGMA busy_timeout").get() as { timeout: number }).timeout,
    ).toBeGreaterThan(0);
    db.close();
  });

  test("refuse a migration list with a gap rather than applying it out of order", () => {
    const db = openDatabase(":memory:");
    expect(() =>
      migrate(db, [
        { version: 1, name: "a", sql: "CREATE TABLE a (x INTEGER) STRICT" },
        { version: 3, name: "c", sql: "CREATE TABLE c (x INTEGER) STRICT" },
      ]),
    ).toThrow(/no gaps/);
    db.close();
  });

  test("roll back a failing migration so a retry is clean", () => {
    const db = openDatabase(":memory:");
    const broken = [
      {
        version: 1,
        name: "broken",
        sql: "CREATE TABLE ok (x INTEGER) STRICT; CREATE TABLE bad (x NOT_A_TYPE) STRICT;",
      },
    ];
    expect(() => migrate(db, broken)).toThrow();
    expect(tableNames(db)).not.toContain("ok");
    expect(
      db.query("SELECT count(*) AS n FROM schema_migrations").get() as { n: number },
    ).toEqual({ n: 0 });
    db.close();
  });

  test("enforce the constraints the schema declares", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const now = Date.now();

    // Provider kind is limited to the adapters SPEC §4 requires for v1.
    expect(() =>
      db
        .query(
          "INSERT INTO providers (ulid, name, kind, created_at, updated_at) VALUES ('A', 'x', 'telepathy', $now, $now)",
        )
        .run({ now }),
    ).toThrow();

    db.query(
      "INSERT INTO presets (ulid, name, sampler_settings, is_default, created_at, updated_at) VALUES ('P1', 'a', '{}', 1, $now, $now)",
    ).run({ now });
    // There can be only one default preset.
    expect(() =>
      db
        .query(
          "INSERT INTO presets (ulid, name, sampler_settings, is_default, created_at, updated_at) VALUES ('P2', 'b', '{}', 1, $now, $now)",
        )
        .run({ now }),
    ).toThrow();

    // A profile cannot reference a provider that does not exist.
    expect(() =>
      db
        .query(
          "INSERT INTO connection_profiles (ulid, name, provider_id, created_at, updated_at) VALUES ('C1', 'x', 999, $now, $now)",
        )
        .run({ now }),
    ).toThrow();

    db.close();
  });
});
