import type { Database } from "bun:sqlite";
import type { SamplerSettings } from "../../shared/types.ts";
import type { PromptRole } from "../prompt/types.ts";
import { readExtensionState, writeExtensionState, readGlobalExtensionState, writeGlobalExtensionState } from "./state.ts";

/**
 * The extension code API (SPEC §15, §20 phase 110).
 *
 * An extension's `server.ts` (or `server.js`) exports `register(ctx)`. `ctx`
 * collects what the extension adds — tasks and prompt injections — and the host
 * persists and runs them. Code runs on the server, in the process the operator
 * owns; the trust boundary is the install, the same as cloning a repository.
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
   * Gate the task on the state of the scene, so an extension can run every N
   * messages rather than every turn. Absent means run always. The extension
   * reads whatever else it needs from `db` (§20 phase 145).
   */
  shouldRun?(context: { db: Database; sceneId: number; messageCount: number }): boolean;
  /**
   * Run in the extension's module after the model answers. It may write to the
   * database, but must not throw — a task that can fail a turn is a task that
   * should not be a task (SPEC §7).
   */
  apply?(reply: string, context: { db: Database; sceneId: number | null; messageCount: number | null }): void | Promise<void>;
}

/**
 * A prompt injection the host renders (§20 phase 145).
 *
 * The extension decides the text at prompt-build time — it reads its stored
 * state from `db` and returns the content, or null to inject nothing. The host
 * places it and costs it like any other block, so the inspector shows it.
 */
export interface ExtensionInjection {
  key: string;
  label: string;
  /** `before`/`after` land in the prefix; `in_chat` sits `depth` from the turn. */
  position: "before" | "after" | "in_chat";
  depth?: number;
  role?: PromptRole;
  render(context: { db: Database; sceneId: number }): string | null;
}

/**
 * An action button the host surfaces (§20 phases 148, 150).
 *
 * Chat-scoped (default): the operator presses it, the host runs the prompt
 * against the scene, and `apply` stores the answer. Global-scoped: pure code —
 * a `run` callback with no model call, surfaced app-wide in the extension
 * manager rather than the composer.
 */
export interface ExtensionAction {
  key: string;
  label: string;
  description?: string;
  /** `chat` (default) runs against a scene; `global` runs app-wide. */
  scope?: "chat" | "global";
  /** Chat-scoped only: the prompt, with `{{transcript}}`/`{{lastMessage}}`/`{{state}}`/`{{globalState}}`. */
  prompt?: string;
  samplers?: SamplerSettings;
  replyLimit?: number;
  timeoutMs?: number;
  /** Chat-scoped: runs after the model answers. */
  apply?(reply: string, context: { db: Database; sceneId: number | null; messageCount: number | null }): void | Promise<void>;
  /** Global-scoped only: the action itself. No model, no scene. */
  run?(context: { db: Database }): void | Promise<void>;
}

/**
 * Lifecycle callbacks the host invokes at the right moments (§20 phase 151).
 *
 * `onStartup` runs once per process, after the first load. `onEnable`/
 * `onDisable` run when the operator toggles the extension. `onUninstall` runs
 * before the directory is removed. All take `db`, so a callback can migrate or
 * clean up its own state. None may throw.
 */
export interface ExtensionLifecycle {
  onStartup?(context: { db: Database }): void | Promise<void>;
  onEnable?(context: { db: Database }): void | Promise<void>;
  onDisable?(context: { db: Database }): void | Promise<void>;
  onUninstall?(context: { db: Database }): void | Promise<void>;
}

export interface ExtensionApi {
  task(config: ExtensionTask): void;
  inject(config: ExtensionInjection): void;
  action(config: ExtensionAction): void;
  lifecycle(config: ExtensionLifecycle): void;
  /**
   * Per-scene key/value storage, pre-bound to this extension's name. Writes
   * happen in `apply`; reads happen in `shouldRun`, `render`, and the
   * `{{state:<key>}}` task macro (§146).
   */
  state: {
    read(db: Database, sceneId: number, key: string): string | null;
    write(db: Database, sceneId: number, key: string, value: string): void;
  };
  /**
   * App-wide key/value storage, pre-bound to this extension's name (§150).
   * Where `state` dies with its scene, `globalState` survives scene deletion.
   */
  globalState: {
    read(db: Database, key: string): string | null;
    write(db: Database, key: string, value: string): void;
  };
}

export interface ExtensionRegistration {
  name: string;
  tasks: ExtensionTask[];
  injections: ExtensionInjection[];
  actions: ExtensionAction[];
  lifecycle: ExtensionLifecycle | null;
}

export function createExtensionApi(name: string): { api: ExtensionApi; registration: ExtensionRegistration } {
  const registration: ExtensionRegistration = { name, tasks: [], injections: [], actions: [], lifecycle: null };
  const api: ExtensionApi = {
    task(config) {
      registration.tasks.push(config);
    },
    inject(config) {
      registration.injections.push(config);
    },
    action(config) {
      registration.actions.push(config);
    },
    lifecycle(config) {
      registration.lifecycle = config;
    },
    state: {
      read: (db, sceneId, key) => readExtensionState(db, name, sceneId, key),
      write: (db, sceneId, key, value) => writeExtensionState(db, name, sceneId, key, value),
    },
    globalState: {
      read: (db, key) => readGlobalExtensionState(db, name, key),
      write: (db, key, value) => writeGlobalExtensionState(db, name, key, value),
    },
  };
  return { api, registration };
}
