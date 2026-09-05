import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { openDatabase } from "../server/db/index.ts";
import { migrate } from "../server/db/migrate.ts";

/**
 * Storage nothing reads (SPEC §2, §20 phase 58).
 *
 * Four phases running each turned up a column that existed and was never used,
 * and each one was older than the last:
 *
 * | phase | column | dead since |
 * | --- | --- | --- |
 * | 54 | `presets.is_default` had no route to move it | install |
 * | 55 | `messages.generation_meta`, written every turn, on no DTO | phase 4 |
 * | 56 | `presets.prompt_order`, never read *or* written | migration 0001 |
 * | 57 | `personas.avatar_path` | phase 7 |
 *
 * Every one was found by accident, while working on something adjacent. This
 * measures the whole schema instead, in the two shapes the defect takes:
 *
 * 1. **Unmentioned** — the column name appears nowhere outside its migration.
 *    Nothing can read it, because nothing knows it exists.
 * 2. **Write-only** — it is written, and never named in a read. That is what
 *    `generation_meta` was for fifty-one phases: measured, stored, discarded.
 *
 * The check is deliberately loose about what counts as a read — any mention
 * outside a write is enough — because it must never raise a false alarm on a
 * column that is genuinely used. It can miss; it must not cry wolf.
 */

const ROOT = join(import.meta.dir, "..");

/** Every source file that could name a column. Migrations are the exception:
 *  a column mentioned only there is precisely the thing being looked for. */
function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (entry === "migrations" || entry === "node_modules") continue;
        walk(path);
        continue;
      }
      if (/\.(ts|tsx|sql)$/.test(entry)) out.push(path);
    }
  };
  for (const dir of ["server", "client", "shared"]) walk(join(ROOT, dir));
  return out;
}

const SOURCE = sources()
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

/** Columns every table has, or nearly; they are named generically and in bulk. */
const UBIQUITOUS = new Set(["id", "ulid", "created_at", "updated_at"]);

/**
 * Columns that are stored on purpose and read by nothing, with the reason.
 *
 * The same discipline as `reachable.test.ts`: a reason per entry, and a
 * staleness check below so an excuse cannot outlive the column it excuses.
 */
const DELIBERATE = new Map<string, string>([]);

/**
 * A column is matched by *name*, not by `table.column`, because that is what a
 * text search can honestly do: `avatar_path` is on both `characters` and
 * `personas`, and the characters' use makes the personas' look alive. So this
 * under-reports on shared names, and that is the right way for it to be wrong —
 * a guard that cried wolf on a live column would be turned off within a week.
 */
function reads(column: string): boolean {
  return (
    // `row.generation_meta` — the shape a row object is read through.
    new RegExp(`\\.\\s*${column}\\b`).test(SOURCE) ||
    // `generation_meta: string | null` — a field on a row interface or DTO.
    new RegExp(`\\b${column}\\s*:`).test(SOURCE) ||
    // Named in a projection rather than swept up by `SELECT *`.
    new RegExp(`SELECT[^;]*\\b${column}\\b`, "i").test(SOURCE)
  );
}

function schema(): { table: string; column: string }[] {
  const db = openDatabase(":memory:");
  migrate(db);
  const tables = db
    .query("SELECT name FROM sqlite_master WHERE type = $t AND name NOT LIKE $p ORDER BY name")
    .all({ t: "table", p: "sqlite_%" }) as { name: string }[];
  const out: { table: string; column: string }[] = [];
  for (const { name } of tables) {
    // FTS shadow tables are SQLite's own bookkeeping, not this app's schema.
    if (/_fts(_|$)|^schema_migrations$/.test(name)) continue;
    const cols = db.query(`SELECT name FROM pragma_table_info($t)`).all({ t: name }) as {
      name: string;
    }[];
    for (const col of cols) out.push({ table: name, column: col.name });
  }
  return out;
}

describe("the schema has nothing nobody reads", () => {
  const columns = schema();

  test("the sweep found the schema", () => {
    // A refactor that hides the migrations must not turn this into a test that
    // passes by checking nothing.
    expect(new Set(columns.map((c) => c.table)).size).toBeGreaterThan(40);
    expect(columns.length).toBeGreaterThan(400);
  });

  test("no column is mentioned only by its migration", () => {
    const orphans = columns
      .filter(({ column }) => !UBIQUITOUS.has(column))
      .filter(({ table, column }) => !DELIBERATE.has(`${table}.${column}`))
      .filter(({ column }) => !new RegExp(`\\b${column}\\b`).test(SOURCE))
      .map(({ table, column }) => `${table}.${column}`);
    expect(orphans).toEqual([]);
  });

  /**
   * The `generation_meta` shape: written on every turn since phase 4, named in
   * no row type, on no DTO, read by nothing. The first check cannot see it —
   * the column *is* mentioned, in the UPDATE that writes it.
   */
  test("no column is written and never read", () => {
    const writeOnly = columns
      .filter(({ column }) => !UBIQUITOUS.has(column))
      .filter(({ table, column }) => !DELIBERATE.has(`${table}.${column}`))
      .filter(({ column }) => new RegExp(`\\b${column}\\b`).test(SOURCE))
      .filter(({ column }) => !reads(column))
      .map(({ table, column }) => `${table}.${column}`);
    expect(writeOnly).toEqual([]);
  });

  test("the deliberate list has no stale entries", () => {
    const live = new Set(columns.map((c) => `${c.table}.${c.column}`));
    expect([...DELIBERATE.keys()].filter((key) => !live.has(key))).toEqual([]);
  });
});
