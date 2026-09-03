import type { Database } from "bun:sqlite";
import { ulid } from "../../lib/ulid.ts";
import type { ApplyStage, RegexScript, ScriptScope } from "../../scripts/apply.ts";

/**
 * Storage for §14's regex scripts.
 *
 * The engine in `/scripts` is pure and knows nothing about a database; this is
 * the only place the two meet. Rows come out already shaped as the engine's
 * `RegexScript`, with integer keys resolved to ULIDs, so no caller has to know
 * that a script's scope is two nullable columns rather than one.
 */

export interface RegexScriptRow {
  id: number;
  ulid: string;
  name: string;
  pattern: string;
  replacement: string;
  flags: string;
  enabled: number;
  apply_to: ApplyStage;
  scope: ScriptScope;
  character_id: number | null;
  scene_id: number | null;
  run_order: number;
  created_at: number;
  updated_at: number;
}

/** A row with its scope resolved to the identifiers the boundary uses. */
interface JoinedRow extends RegexScriptRow {
  character_ulid: string | null;
  scene_ulid: string | null;
}

const SELECT = `
  SELECT s.*, c.ulid AS character_ulid, sc.ulid AS scene_ulid
    FROM regex_scripts s
    LEFT JOIN characters c ON c.id = s.character_id
    LEFT JOIN scenes sc ON sc.id = s.scene_id
`;

function toScript(row: JoinedRow): RegexScript {
  return {
    id: row.ulid,
    name: row.name,
    pattern: row.pattern,
    replacement: row.replacement,
    flags: row.flags,
    enabled: row.enabled === 1,
    applyTo: row.apply_to,
    scope: row.scope,
    characterId: row.character_ulid,
    sceneId: row.scene_ulid,
    runOrder: row.run_order,
  };
}

/**
 * Every script, in run order.
 *
 * Deliberately unfiltered. The engine's `scriptsFor` decides what applies
 * where, and it is the half with tests on it — a second filter written in SQL
 * would be a second answer to the same question, free to disagree.
 */
export function listScripts(db: Database): RegexScript[] {
  const rows = db.query(`${SELECT} ORDER BY s.run_order, s.ulid`).all() as JoinedRow[];
  return rows.map(toScript);
}

/** The same rows, with the timestamps the editor shows. */
export function listScriptRows(db: Database): (RegexScript & { createdAt: number; updatedAt: number })[] {
  const rows = db.query(`${SELECT} ORDER BY s.run_order, s.ulid`).all() as JoinedRow[];
  return rows.map((row) => ({ ...toScript(row), createdAt: row.created_at, updatedAt: row.updated_at }));
}

export function findScript(db: Database, scriptUlid: string): JoinedRow | null {
  return db.query(`${SELECT} WHERE s.ulid = $ulid`).get({ ulid: scriptUlid }) as JoinedRow | null;
}

export interface NewScript {
  name: string;
  pattern: string;
  replacement: string;
  flags: string;
  applyTo: ApplyStage;
  scope: ScriptScope;
  characterId: number | null;
  sceneId: number | null;
  enabled: boolean;
  runOrder: number | null;
}

/**
 * A new script goes to the end of its stage unless told otherwise: a script
 * inserted into the middle of an order the user arranged would change what
 * every later one sees.
 */
function nextOrder(db: Database, stage: ApplyStage): number {
  const row = db
    .query("SELECT MAX(run_order) AS top FROM regex_scripts WHERE apply_to = $stage")
    .get({ stage }) as { top: number | null };
  return (row.top ?? -1) + 1;
}

export function insertScript(db: Database, input: NewScript): JoinedRow {
  const now = Date.now();
  const row = db
    .query(
      `INSERT INTO regex_scripts
         (ulid, name, pattern, replacement, flags, enabled, apply_to, scope,
          character_id, scene_id, run_order, created_at, updated_at)
       VALUES ($ulid, $name, $pattern, $replacement, $flags, $enabled, $apply_to, $scope,
               $character_id, $scene_id, $run_order, $now, $now)
       RETURNING ulid`,
    )
    .get({
      ulid: ulid(),
      name: input.name,
      pattern: input.pattern,
      replacement: input.replacement,
      flags: input.flags,
      enabled: input.enabled ? 1 : 0,
      apply_to: input.applyTo,
      scope: input.scope,
      character_id: input.characterId,
      scene_id: input.sceneId,
      run_order: input.runOrder ?? nextOrder(db, input.applyTo),
      now,
    }) as { ulid: string };
  const stored = findScript(db, row.ulid);
  if (stored === null) throw new Error("the script vanished between insert and read");
  return stored;
}

export interface ScriptPatch {
  name?: string;
  pattern?: string;
  replacement?: string;
  flags?: string;
  enabled?: boolean;
  applyTo?: ApplyStage;
  runOrder?: number;
}

const COLUMNS: Record<keyof ScriptPatch, string> = {
  name: "name",
  pattern: "pattern",
  replacement: "replacement",
  flags: "flags",
  enabled: "enabled",
  applyTo: "apply_to",
  runOrder: "run_order",
};

export function updateScript(db: Database, id: number, patch: ScriptPatch): void {
  const sets: string[] = [];
  const values: Record<string, string | number> = { id, now: Date.now() };
  for (const [key, column] of Object.entries(COLUMNS) as [keyof ScriptPatch, string][]) {
    const value = patch[key];
    if (value === undefined) continue;
    sets.push(`${column} = $${column}`);
    values[column] = typeof value === "boolean" ? (value ? 1 : 0) : value;
  }
  if (sets.length === 0) return;
  db.query(
    `UPDATE regex_scripts SET ${sets.join(", ")}, updated_at = $now WHERE id = $id`,
  ).run(values);
}

export function deleteScript(db: Database, id: number): void {
  db.query("DELETE FROM regex_scripts WHERE id = $id").run({ id });
}
