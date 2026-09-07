import type { ExtensionTask } from "./api.ts";

/**
 * The live registry of extension tasks (§20 phase 110).
 *
 * The `apply` callbacks are code and cannot be stored; they live here, rebuilt
 * at startup by loading every installed extension's module. The persisted half
 * — key, prompt, stage, samplers — lives in the `tasks` table.
 */

interface RegisteredTask {
  task: ExtensionTask;
  moduleName: string;
}

const tasks = new Map<string, RegisteredTask>();

export function registerExtensionTask(task: ExtensionTask, moduleName: string): void {
  tasks.set(task.key, { task, moduleName });
}

export function clearExtensionTasks(): void {
  tasks.clear();
}

export function extensionTaskOf(key: string): RegisteredTask | null {
  return tasks.get(key) ?? null;
}

export function postGenerationExtensionTasks(): RegisteredTask[] {
  return [...tasks.values()].filter((entry) => entry.task.stage === "post_generation");
}
