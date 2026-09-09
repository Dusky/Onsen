import { createExtensionApi, type ExtensionApi, type ExtensionRegistration } from "./api.ts";
import type { ExtensionSettingsField } from "../../shared/types.ts";

/**
 * Built-in extensions (SPEC §15, §20 phase 144).
 *
 * The code ships in the host, so there is no copied directory and no install
 * step: the row exists so the manager can toggle it and carry its settings. A
 * built-in is seeded disabled — an extension that runs a model every turn must
 * be something the operator chose.
 */

export interface BuiltinExtension {
  name: string;
  version: string;
  author: string;
  description: string;
  settings: ExtensionSettingsField[];
  register(api: ExtensionApi, settings: Record<string, unknown>): void | Promise<void>;
}

/** Run a built-in's `register` through the same collecting API installed code gets. */
export async function loadBuiltin(
  extension: BuiltinExtension,
  settings: Record<string, unknown>,
): Promise<ExtensionRegistration> {
  const { api, registration } = createExtensionApi(extension.name, settings);
  await extension.register(api, settings);
  return registration;
}

const proofread: BuiltinExtension = {
  name: "Proofread",
  version: "1.0.0",
  author: "Onsen",
  description: "Proofreads the latest reply and fixes slips, in the character's voice.",
  settings: [
    {
      key: "level",
      label: "How thorough",
      type: "select",
      options: ["light", "thorough"],
      default: "light",
    },
    {
      key: "rewrite",
      label: "Return the corrected text",
      type: "boolean",
      default: true,
    },
  ],
  register(api, settings) {
    const level = settings["level"] ?? "light";
    const rewrite = settings["rewrite"] ?? true;
    api.task({
      key: "proofread",
      label: "Proofread",
      prompt:
        `Proofread this reply (a ${String(level)} touch). Fix typos and grammar, keep the voice.` +
        (rewrite ? " Return the corrected text only." : " List the corrections.") +
        `\n\n{{lastMessage}}`,
      stage: "post_generation",
      samplers: { temperature: 0.2, top_p: 0.9 },
    });
  },
};

const loreScout: BuiltinExtension = {
  name: "Lore Scout",
  version: "1.0.0",
  author: "Onsen",
  description: "Proposes one world-info entry from the latest exchange.",
  settings: [],
  register(api) {
    api.task({
      key: "scout",
      label: "Lore scout",
      prompt:
        "Propose one concise world-info entry for this exchange. Give a short entry name, then one sentence of content.\n\n{{lastMessage}}",
      stage: "post_generation",
      samplers: { temperature: 0.4, top_p: 0.9 },
    });
  },
};

export const BUILTINS: BuiltinExtension[] = [proofread, loreScout];
