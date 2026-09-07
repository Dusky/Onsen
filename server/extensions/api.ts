import type { Database } from "bun:sqlite";
import type { SamplerSettings } from "../../shared/types.ts";

/**
 * The extension code API (SPEC §15, §20 phase 110).
 *
 * An extension's `server.ts` (or `server.js`) exports `register(ctx)`. `ctx`
 * collects what the extension adds — for now, tasks — and the host persists and
 * runs them. Code runs on the server, in the process the operator owns; the
 * trust boundary is the install, the same as cloning a repository.
 */

export interface ExtensionTask {
  /** Unique among installed extensions. A prefix keeps two suites apart. */
  key: string;
  label: string;
  description?: string;
  /** The prompt, with `{{transcript}}` and `{{lastMessage}}` filled in. */
  prompt: string;
  stage: "pre_generation" | "sidecar" | "post_generation";
  replyLimit?: number;
  timeoutMs?: number;
  samplers?: SamplerSettings;
  /**
   * Run in the extension's module after the model answers. It may write to the
   * database, but must not throw — a task that can fail a turn is a task that
   * should not be a task (SPEC §7).
   */
  apply?(reply: string, context: { db: Database; sceneId: number }): void | Promise<void>;
}

export interface ExtensionApi {
  task(config: ExtensionTask): void;
}

export interface ExtensionRegistration {
  name: string;
  tasks: ExtensionTask[];
}

export function createExtensionApi(name: string): { api: ExtensionApi; registration: ExtensionRegistration } {
  const registration: ExtensionRegistration = { name, tasks: [] };
  const api: ExtensionApi = {
    task(config) {
      registration.tasks.push(config);
    },
  };
  return { api, registration };
}
