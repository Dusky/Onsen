import { join } from "node:path";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import type { Database } from "bun:sqlite";
import { loadExtensionModule } from "./loader.ts";
import { registerExtensionTask, clearExtensionTasks } from "./registry.ts";
import { insertExtension, listExtensions } from "../db/queries/extensions.ts";
import type { ExtensionTask } from "./api.ts";
import type { ExtensionSettingsField } from "../../shared/types.ts";

/**
 * Install an extension's code and reload it on startup (§20 phase 110).
 *
 * The directory is copied under `data/extensions/<name>`; the server module is
 * imported and its `register` collected; the extension row and its tasks are
 * persisted. On startup every installed extension reloads, so the `apply`
 * callbacks exist again.
 */

function safeDir(name: string): string {
  const cleaned = name.replace(/[^\w.-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").toLowerCase();
  return cleaned === "" ? "extension" : cleaned;
}

function copyDir(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    if (entry === ".git") continue;
    const source = join(from, entry);
    const target = join(to, entry);
    if (statSync(source).isDirectory()) copyDir(source, target);
    else copyFileSync(source, target);
  }
}

function taskKey(extensionName: string, key: string): string {
  return `ext:${extensionName}:${key}`;
}

/** The manifest an extension repo carries: `pack.json`, or a bare `extension.json`. */
function readManifest(dir: string): { description: string | null; settingsSchema: ExtensionSettingsField[] } {
  for (const file of ["pack.json", "extension.json"]) {
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    try {
      const manifest = JSON.parse(readFileSync(path, "utf8")) as {
        description?: unknown;
        settings?: unknown;
      };
      return {
        description: typeof manifest.description === "string" ? manifest.description : null,
        settingsSchema: Array.isArray(manifest.settings)
          ? (manifest.settings as ExtensionSettingsField[])
          : [],
      };
    } catch {
      continue;
    }
  }
  return { description: null, settingsSchema: [] };
}

/** The defaults a schema declares, so a fresh install starts at them (§143). */
export function defaultSettings(schema: ExtensionSettingsField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of schema) {
    if (field.default !== undefined) out[field.key] = field.default;
  }
  return out;
}

function parseSettings(raw: string | null): Record<string, unknown> {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function upsertTask(db: Database, extensionName: string, task: ExtensionTask): void {
  db.query(
    `INSERT INTO tasks (key, stage, enabled, prompt_template, timeout_ms, sampler_settings, created_at, updated_at)
     VALUES ($key, $stage, 1, $prompt, $timeout, $samplers, $now, $now)
     ON CONFLICT (key) DO UPDATE SET
       stage = excluded.stage, prompt_template = excluded.prompt_template,
       timeout_ms = excluded.timeout_ms, sampler_settings = excluded.sampler_settings,
       updated_at = excluded.updated_at`,
  ).run({
    key: taskKey(extensionName, task.key),
    stage: task.stage,
    prompt: task.prompt,
    timeout: task.timeoutMs ?? 12_000,
    samplers: task.samplers === undefined ? null : JSON.stringify(task.samplers),
    now: Date.now(),
  });
}

export async function installExtensionCode(opts: {
  db: Database;
  extensionsDir: string;
  sourceDir: string;
  name: string;
  version: string;
  author: string;
}): Promise<{ hasCode: boolean; tasks: number }> {
  const serverFile = ["server.ts", "server.js", "index.ts", "index.js"].find((file) =>
    existsSync(join(opts.sourceDir, file)),
  );
  if (serverFile === undefined) return { hasCode: false, tasks: 0 };

  const target = join(opts.extensionsDir, safeDir(opts.name));
  copyDir(opts.sourceDir, target);
  const { description, settingsSchema } = readManifest(opts.sourceDir);
  const registration = await loadExtensionModule(
    join(target, serverFile),
    opts.name,
    defaultSettings(settingsSchema),
  );

  insertExtension(opts.db, {
    name: opts.name,
    version: opts.version,
    author: opts.author,
    dir: target,
    description,
    settingsSchema: JSON.stringify(settingsSchema),
    settings: JSON.stringify(defaultSettings(settingsSchema)),
  });
  for (const task of registration.tasks) {
    registerExtensionTask(task, opts.name);
    upsertTask(opts.db, opts.name, task);
  }
  return { hasCode: true, tasks: registration.tasks.length };
}

/** Reload every installed extension's code, rebuilding the runtime registry. */
export async function loadInstalledExtensions(db: Database, extensionsDir: string): Promise<void> {
  clearExtensionTasks();
  for (const row of listExtensions(db)) {
    // A disabled extension contributes no tasks and runs no callbacks (§144).
    if (row.enabled !== 1) continue;
    const serverFile = ["server.ts", "server.js", "index.ts", "index.js"].find((file) =>
      existsSync(join(row.dir, file)),
    );
    if (serverFile === undefined) continue;
    const registration = await loadExtensionModule(
      join(row.dir, serverFile),
      row.name,
      parseSettings(row.settings),
    );
    for (const task of registration.tasks) {
      registerExtensionTask(task, row.name);
    }
  }
}
