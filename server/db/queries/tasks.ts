import type { Database } from "bun:sqlite";
import { ulid } from "../../lib/ulid.ts";
import type { SamplerSettings, TaskDto, TaskRunDto } from "../../../shared/types.ts";
import { TASK_KINDS, taskKind, type TaskKind } from "../../tasks/registry.ts";

/**
 * Reading and writing background-task configuration and the run log (SPEC §7).
 *
 * A row here configures a kind the code already knows about. Rows are created
 * on demand rather than by the migration, so adding a kind is a change to one
 * list in the registry and nothing else.
 */

export interface TaskRow {
  id: number;
  key: string;
  stage: "pre_generation" | "sidecar" | "post_generation";
  enabled: number;
  connection_profile_id: number | null;
  prompt_template: string | null;
  sampler_settings: string | null;
  timeout_ms: number;
  run_order: number;
  created_at: number;
  updated_at: number;
}

export interface TaskRunRow {
  id: number;
  ulid: string;
  task_key: string;
  scene_id: number | null;
  status: TaskRunDto["status"];
  provider: string | null;
  model: string | null;
  prompt: string | null;
  output: string | null;
  detail: string | null;
  duration_ms: number;
  created_at: number;
}

/**
 * The configuration for a kind, creating the row the first time it is asked
 * for. A kind that has never been configured behaves exactly like its defaults,
 * which is what makes adding one a one-line change.
 */
export function taskConfig(db: Database, kind: TaskKind): TaskRow {
  const existing = db.query("SELECT * FROM tasks WHERE key = $key").get({ key: kind.key }) as
    | TaskRow
    | null;
  if (existing !== null) return existing;

  const now = Date.now();
  return db
    .query(
      `INSERT INTO tasks (key, stage, enabled, timeout_ms, run_order, created_at, updated_at)
       VALUES ($key, $stage, 1, $timeout, 0, $now, $now)
       RETURNING *`,
    )
    .get({ key: kind.key, stage: kind.stage, timeout: kind.timeoutMs, now }) as TaskRow;
}

export function listTasks(db: Database): TaskRow[] {
  // Every known kind, configured or not, so the list is the registry rather
  // than whatever happens to have run on this installation.
  return TASK_KINDS.map((kind) => taskConfig(db, kind));
}

export interface TaskPatch {
  enabled?: boolean;
  connectionProfileId?: number | null;
  promptTemplate?: string | null;
  timeoutMs?: number;
}

export function updateTask(db: Database, kind: TaskKind, patch: TaskPatch): TaskRow {
  const current = taskConfig(db, kind);
  return db
    .query(
      `UPDATE tasks
          SET enabled = $enabled,
              connection_profile_id = $profile,
              prompt_template = $template,
              timeout_ms = $timeout,
              updated_at = $now
        WHERE id = $id
        RETURNING *`,
    )
    .get({
      id: current.id,
      enabled: patch.enabled === undefined ? current.enabled : patch.enabled ? 1 : 0,
      profile:
        patch.connectionProfileId === undefined
          ? current.connection_profile_id
          : patch.connectionProfileId,
      template:
        patch.promptTemplate === undefined ? current.prompt_template : patch.promptTemplate,
      timeout: patch.timeoutMs ?? current.timeout_ms,
      now: Date.now(),
    }) as TaskRow;
}

/** The samplers a run uses: the row's override, else the kind's own. */
export function samplersOf(row: TaskRow, kind: TaskKind): SamplerSettings {
  if (row.sampler_settings === null) return kind.samplers;
  try {
    return JSON.parse(row.sampler_settings) as SamplerSettings;
  } catch {
    // A corrupt override should not stop a side call; the kind's own are sane.
    return kind.samplers;
  }
}

/* ------------------------------------------------------------------ */
/* The run log                                                         */
/* ------------------------------------------------------------------ */

/** How much of a prompt or a reply is kept. This is a log, not an archive. */
const LOG_TEXT_LIMIT = 4_000;
/** Runs kept per kind. Enough to see a pattern, not enough to grow forever. */
const RUNS_KEPT_PER_KIND = 50;

function clip(text: string | null): string | null {
  if (text === null) return null;
  return text.length <= LOG_TEXT_LIMIT ? text : `${text.slice(0, LOG_TEXT_LIMIT)}…`;
}

export interface NewTaskRun {
  taskKey: string;
  sceneId: number | null;
  status: TaskRunDto["status"];
  provider: string | null;
  model: string | null;
  prompt: string | null;
  output: string | null;
  detail: string | null;
  durationMs: number;
}

export function recordTaskRun(db: Database, input: NewTaskRun): TaskRunRow {
  const row = db
    .query(
      `INSERT INTO task_runs
         (ulid, task_key, scene_id, status, provider, model, prompt, output, detail,
          duration_ms, created_at)
       VALUES ($ulid, $key, $scene, $status, $provider, $model, $prompt, $output, $detail,
               $duration, $now)
       RETURNING *`,
    )
    .get({
      ulid: ulid(),
      key: input.taskKey,
      scene: input.sceneId,
      status: input.status,
      provider: input.provider,
      model: input.model,
      prompt: clip(input.prompt),
      output: clip(input.output),
      detail: input.detail,
      duration: input.durationMs,
      now: Date.now(),
    }) as TaskRunRow;

  // Keep the log bounded here rather than in a sweep somewhere: a side call
  // that runs every turn would otherwise grow the database forever.
  db.query(
    `DELETE FROM task_runs
      WHERE task_key = $key
        AND id NOT IN (SELECT id FROM task_runs WHERE task_key = $key ORDER BY id DESC LIMIT $keep)`,
  ).run({ key: input.taskKey, keep: RUNS_KEPT_PER_KIND });

  return row;
}

export function listTaskRuns(db: Database, key: string, limit = 20): TaskRunRow[] {
  return db
    .query("SELECT * FROM task_runs WHERE task_key = $key ORDER BY id DESC LIMIT $limit")
    .all({ key, limit }) as TaskRunRow[];
}

/* ------------------------------------------------------------------ */
/* DTOs                                                               */
/* ------------------------------------------------------------------ */

export function toTaskDto(row: TaskRow, profileUlid: string | null): TaskDto {
  const kind = taskKind(row.key);
  return {
    key: row.key,
    label: kind?.label ?? row.key,
    description: kind?.description ?? "",
    stage: row.stage,
    enabled: row.enabled === 1,
    connectionProfileId: profileUlid,
    /** Null means the built-in prompt, which is the normal case. */
    promptTemplate: row.prompt_template,
    timeoutMs: row.timeout_ms,
  };
}

export function toTaskRunDto(row: TaskRunRow, sceneUlid: string | null): TaskRunDto {
  return {
    id: row.ulid,
    taskKey: row.task_key,
    sceneId: sceneUlid,
    status: row.status,
    provider: row.provider,
    model: row.model,
    prompt: row.prompt,
    output: row.output,
    detail: row.detail,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  };
}
