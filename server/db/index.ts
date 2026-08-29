import { Database } from "bun:sqlite";

export type { Database };

/**
 * Open the database with the pragmas SPEC §1 requires. WAL lets a read run
 * while a generation is writing; `busy_timeout` stops a concurrent writer from
 * failing outright on a locked database.
 */
export function openDatabase(path: string): Database {
  const db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  // NORMAL is the right durability trade for WAL: a crash can lose the last
  // transaction but cannot corrupt the database.
  db.exec("PRAGMA synchronous = NORMAL");
  return db;
}
