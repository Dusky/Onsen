import { join } from "node:path";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import type { Database } from "bun:sqlite";
import { loadExtensionModule } from "./loader.ts";
import { loadBuiltin, BUILTINS } from "./builtins.ts";
import { registerExtensionTask, registerExtensionInjection, clearExtensionTasks } from "./registry.ts";
import { applySuppression } from "./suppress.ts";
import {
  deleteExtensionTasks,
  findExtensionByName,
  findExtensionByNameVersion,
  insertBuiltinExtension,
  insertExtension,
  listExtensions,
} from "../db/queries/extensions.ts";
import { getSetting, setSetting } from "../db/queries/settings.ts";
import type { ExtensionTask, ExtensionRegistration } from "./api.ts";
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
function readManifest(dir: string): {
  name: string;
  version: string;
  author: string;
  description: string | null;
  settingsSchema: ExtensionSettingsField[];
  disables: string[];
} | null {
  for (const file of ["pack.json", "extension.json"]) {
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    try {
      const manifest = JSON.parse(readFileSync(path, "utf8")) as {
        name?: unknown;
        version?: unknown;
        author?: unknown;
        description?: unknown;
        settings?: unknown;
        disables?: unknown;
      };
      return {
        name: typeof manifest.name === "string" ? manifest.name : "Extension",
        version: typeof manifest.version === "string" ? manifest.version : "1.0.0",
        author: typeof manifest.author === "string" ? manifest.author : "",
        description: typeof manifest.description === "string" ? manifest.description : null,
        settingsSchema: Array.isArray(manifest.settings)
          ? (manifest.settings as ExtensionSettingsField[])
          : [],
        disables: Array.isArray(manifest.disables)
          ? manifest.disables.filter((f): f is string => typeof f === "string")
          : [],
      };
    } catch {
      continue;
    }
  }
  return null;
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
  const manifest = readManifest(opts.sourceDir);
  const description = manifest?.description ?? null;
  const settingsSchema = manifest?.settingsSchema ?? [];
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
  for (const injection of registration.injections) {
    registerExtensionInjection(injection, opts.name);
  }
  return { hasCode: true, tasks: registration.tasks.length };
}

/** Reload every installed extension's code, rebuilding the runtime registry. */
export async function loadInstalledExtensions(db: Database, extensionsDir: string): Promise<void> {
  clearExtensionTasks();
  seedBuiltins(db);
  const disabled = new Set<string>();
  for (const row of listExtensions(db)) {
    // A disabled extension contributes no tasks and runs no callbacks, and its
    // rows leave the ops list so it cannot look alive while off (§144).
    if (row.enabled !== 1) {
      deleteExtensionTasks(db, row.name);
      continue;
    }

    const registration =
      row.built_in === 1
        ? await loadBuiltinByName(row.name, parseSettings(row.settings))
        : await loadFromDir(row.dir, row.name, parseSettings(row.settings));
    if (registration === null) continue;

    // An enabled extension may declare native features it takes over (§147).
    if (row.built_in !== 1) {
      for (const feature of readManifest(row.dir)?.disables ?? []) disabled.add(feature);
    }

    for (const task of registration.tasks) {
      registerExtensionTask(task, row.name);
      upsertTask(db, row.name, task);
    }
    for (const injection of registration.injections) {
      registerExtensionInjection(injection, row.name);
    }
  }
  applySuppression(db, disabled);
}

/** A built-in's registration, from the in-process registry by name. */
async function loadBuiltinByName(
  name: string,
  settings: Record<string, unknown>,
): Promise<ExtensionRegistration | null> {
  const builtin = BUILTINS.find((entry) => entry.name === name);
  return builtin === undefined ? null : loadBuiltin(builtin, settings);
}

/** An installed extension's registration, from its copied directory. */
async function loadFromDir(
  dir: string,
  name: string,
  settings: Record<string, unknown>,
): Promise<ExtensionRegistration | null> {
  const serverFile = ["server.ts", "server.js", "index.ts", "index.js"].find((file) =>
    existsSync(join(dir, file)),
  );
  return serverFile === undefined ? null : loadExtensionModule(join(dir, serverFile), name, settings);
}

/** Ensure every built-in has a row; seeded disabled so it never surprises. */
function seedBuiltins(db: Database): void {
  for (const builtin of BUILTINS) {
    if (findExtensionByName(db, builtin.name) !== null) continue;
    insertBuiltinExtension(db, {
      name: builtin.name,
      version: builtin.version,
      author: builtin.author,
      description: builtin.description,
      settingsSchema: JSON.stringify(builtin.settings),
      settings: JSON.stringify(defaultSettings(builtin.settings)),
    });
  }
}

/* ------------------------------------------------------------------ */
/* Shipped extensions (SPEC §15, §20 phase 147)                       */
/* ------------------------------------------------------------------ */

/**
 * Extensions that ship in the repo but install as *external* — a real copied
 * directory and a removable row, not a `built_in` flag. Installed once, through
 * the same path a URL install takes, so they behave exactly like something the
 * operator cloned. The flag means an uninstall sticks: the app does not
 * re-install a thing the operator removed.
 */
const SHIPPED_SETTING = "extensions.shipped_installed";

export function shippedExtensionsDir(): string {
  return join(import.meta.dir, "shipped");
}

export async function installShippedExtensions(db: Database, extensionsDir: string): Promise<void> {
  if (getSetting(db, SHIPPED_SETTING) !== null) return;
  const source = shippedExtensionsDir();
  if (!existsSync(source)) {
    setSetting(db, SHIPPED_SETTING, "1");
    return;
  }
  for (const entry of readdirSync(source)) {
    const dir = join(source, entry);
    if (!statSync(dir).isDirectory()) continue;
    const manifest = readManifest(dir);
    if (manifest === null) continue;
    // Idempotent before the flag lands: a half-finished first boot re-runs.
    if (findExtensionByNameVersion(db, manifest.name, manifest.version) !== null) continue;
    await installExtensionCode({
      db,
      extensionsDir,
      sourceDir: dir,
      name: manifest.name,
      version: manifest.version,
      author: manifest.author,
    });
  }
  setSetting(db, SHIPPED_SETTING, "1");
}
