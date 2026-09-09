import type { ExtensionAction, ExtensionInjection, ExtensionTask } from "./api.ts";
import type { Database } from "bun:sqlite";
import type { BlockPlacement, PromptExtensionBlock } from "../prompt/types.ts";

/**
 * The live registry of extension tasks, injections and actions (§20 phases
 * 110, 145, 148).
 *
 * The `apply` and `render` callbacks are code and cannot be stored; they live
 * here, rebuilt at startup by loading every installed extension's module. The
 * persisted half — key, prompt, stage, samplers — lives in the `tasks` table.
 */

interface RegisteredTask {
  task: ExtensionTask;
  moduleName: string;
}

interface RegisteredInjection {
  injection: ExtensionInjection;
  moduleName: string;
}

interface RegisteredAction {
  action: ExtensionAction;
  moduleName: string;
}

const tasks = new Map<string, RegisteredTask>();
const injections = new Map<string, RegisteredInjection>();
const actions = new Map<string, RegisteredAction>();

export function registerExtensionTask(task: ExtensionTask, moduleName: string): void {
  tasks.set(task.key, { task, moduleName });
}

export function registerExtensionInjection(injection: ExtensionInjection, moduleName: string): void {
  injections.set(`${moduleName}:${injection.key}`, { injection, moduleName });
}

export function registerExtensionAction(action: ExtensionAction, moduleName: string): void {
  actions.set(action.key, { action, moduleName });
}

export function clearExtensionTasks(): void {
  tasks.clear();
  injections.clear();
  actions.clear();
}

/**
 * Drop everything one extension registered, without touching the others.
 *
 * This is the uninstall half of `registerExtensionTask`/`registerExtensionInjection`/
 * `registerExtensionAction`: it stops an extension's callbacks firing in the
 * running process the moment its pack is removed, rather than waiting for the
 * next restart to rebuild the registry.
 */
export function unregisterExtensionModule(moduleName: string): void {
  for (const [key, entry] of tasks) {
    if (entry.moduleName === moduleName) tasks.delete(key);
  }
  for (const [key, entry] of injections) {
    if (entry.moduleName === moduleName) injections.delete(key);
  }
  for (const [key, entry] of actions) {
    if (entry.moduleName === moduleName) actions.delete(key);
  }
}

export function extensionTaskOf(key: string): RegisteredTask | null {
  return tasks.get(key) ?? null;
}

export function postGenerationExtensionTasks(): RegisteredTask[] {
  return [...tasks.values()].filter((entry) => entry.task.stage === "post_generation");
}

export function extensionInjections(): RegisteredInjection[] {
  return [...injections.values()];
}

export function extensionActions(): RegisteredAction[] {
  return [...actions.values()];
}

export function extensionActionOf(key: string): RegisteredAction | null {
  return actions.get(key) ?? null;
}

/**
 * Render every registered injection for a scene, at prompt build time (§145).
 *
 * `render` reads the extension's stored state synchronously — the async half of
 * the work belongs in `apply`, which runs after a turn and can store what the
 * next prompt will read.
 */
export function collectExtensionInjections(db: Database, sceneId: number): PromptExtensionBlock[] {
  const out: PromptExtensionBlock[] = [];
  for (const entry of injections.values()) {
    const injection = entry.injection;
    try {
      const content = injection.render({ db, sceneId });
      if (content === null || content.trim() === "") continue;
      const placement: BlockPlacement =
        injection.position === "in_chat"
          ? { kind: "depth", depth: injection.depth ?? 0 }
          : { kind: "prefix" };
      out.push({
        key: `${entry.moduleName}:${injection.key}`,
        label: injection.label,
        content,
        placement,
        role: injection.role ?? "system",
      });
    } catch {
      /* A broken injection must not reach the turn. */
    }
  }
  return out;
}
