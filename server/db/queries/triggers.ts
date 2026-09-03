import type { Database } from "bun:sqlite";
import { ulid } from "../../lib/ulid.ts";
import type { EventTrigger, TriggerAction, TriggerEvent } from "../../triggers/select.ts";

/** Storage for §14's event triggers. Shaped for the selector, as scripts are. */

export interface EventTriggerRow {
  id: number;
  ulid: string;
  name: string;
  event: TriggerEvent;
  action: TriggerAction;
  action_ref: string;
  automation_id: string | null;
  scope: "global" | "scene";
  scene_id: number | null;
  enabled: number;
  run_order: number;
  created_at: number;
  updated_at: number;
}

interface JoinedRow extends EventTriggerRow {
  scene_ulid: string | null;
}

const SELECT = `
  SELECT t.*, s.ulid AS scene_ulid
    FROM event_triggers t
    LEFT JOIN scenes s ON s.id = t.scene_id
`;

function toTrigger(row: JoinedRow): EventTrigger {
  return {
    id: row.ulid,
    name: row.name,
    event: row.event,
    action: row.action,
    actionRef: row.action_ref,
    automationId: row.automation_id,
    scope: row.scope,
    sceneId: row.scene_ulid,
    enabled: row.enabled === 1,
    runOrder: row.run_order,
  };
}

export function listTriggers(db: Database): EventTrigger[] {
  const rows = db.query(`${SELECT} ORDER BY t.run_order, t.ulid`).all() as JoinedRow[];
  return rows.map(toTrigger);
}

export function listTriggerRows(
  db: Database,
): (EventTrigger & { createdAt: number; updatedAt: number })[] {
  const rows = db.query(`${SELECT} ORDER BY t.run_order, t.ulid`).all() as JoinedRow[];
  return rows.map((row) => ({
    ...toTrigger(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function findTrigger(db: Database, triggerUlid: string): JoinedRow | null {
  return db.query(`${SELECT} WHERE t.ulid = $ulid`).get({ ulid: triggerUlid }) as JoinedRow | null;
}

export interface NewTrigger {
  name: string;
  event: TriggerEvent;
  action: TriggerAction;
  actionRef: string;
  automationId: string | null;
  scope: "global" | "scene";
  sceneId: number | null;
  enabled: boolean;
  runOrder: number | null;
}

function nextOrder(db: Database, event: TriggerEvent): number {
  const row = db
    .query("SELECT MAX(run_order) AS top FROM event_triggers WHERE event = $event")
    .get({ event }) as { top: number | null };
  return (row.top ?? -1) + 1;
}

export function insertTrigger(db: Database, input: NewTrigger): JoinedRow {
  const now = Date.now();
  const row = db
    .query(
      `INSERT INTO event_triggers
         (ulid, name, event, action, action_ref, automation_id, scope, scene_id,
          enabled, run_order, created_at, updated_at)
       VALUES ($ulid, $name, $event, $action, $action_ref, $automation_id, $scope, $scene_id,
               $enabled, $run_order, $now, $now)
       RETURNING ulid`,
    )
    .get({
      ulid: ulid(),
      name: input.name,
      event: input.event,
      action: input.action,
      action_ref: input.actionRef,
      automation_id: input.automationId,
      scope: input.scope,
      scene_id: input.sceneId,
      enabled: input.enabled ? 1 : 0,
      run_order: input.runOrder ?? nextOrder(db, input.event),
      now,
    }) as { ulid: string };
  const stored = findTrigger(db, row.ulid);
  if (stored === null) throw new Error("the trigger vanished between insert and read");
  return stored;
}

export interface TriggerPatch {
  name?: string;
  enabled?: boolean;
  actionRef?: string;
  automationId?: string | null;
  runOrder?: number;
}

export function updateTrigger(db: Database, id: number, patch: TriggerPatch): void {
  const columns: [keyof TriggerPatch, string][] = [
    ["name", "name"],
    ["enabled", "enabled"],
    ["actionRef", "action_ref"],
    ["automationId", "automation_id"],
    ["runOrder", "run_order"],
  ];
  const sets: string[] = [];
  const values: Record<string, string | number | null> = { id, now: Date.now() };
  for (const [key, column] of columns) {
    const value = patch[key];
    if (value === undefined) continue;
    sets.push(`${column} = $${column}`);
    values[column] = typeof value === "boolean" ? (value ? 1 : 0) : value;
  }
  if (sets.length === 0) return;
  db.query(
    `UPDATE event_triggers SET ${sets.join(", ")}, updated_at = $now WHERE id = $id`,
  ).run(values);
}

export function deleteTrigger(db: Database, id: number): void {
  db.query("DELETE FROM event_triggers WHERE id = $id").run({ id });
}
