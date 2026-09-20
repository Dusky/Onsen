import { createExtensionApi, type ExtensionApi, type ExtensionRegistration } from "./api.ts";
import { createRng, hashString, rollDice } from "../prompt/random.ts";
import type { ExtensionSettingsField } from "../../shared/types.ts";

/**
 * The seed behind one roll (§20 phase 233).
 *
 * Exported so it can be tested directly. The first version seeded on
 * `Date.now()` alone and two rolls in the same millisecond came back
 * identical — a loaded die. Testing that statistically is a test that passes
 * either way, because the clock does tick between most rolls; testing the
 * derivation is deterministic and pins the actual fix. `index` is how many
 * rolls came before this one in the scene.
 */
export function rollSeed(sceneId: number, index: number, now: number): number {
  return hashString(`tabletop::${sceneId}::${index}::${now}`);
}

/** One recorded roll (§20 phase 233). */
interface Roll {
  at: number;
  dice: string;
  total: number;
  difficulty: number;
  outcome: "success" | "failure";
  /** True once it has reached a prompt, so the story tells it once. */
  narrated: boolean;
}

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

/**
 * Tabletop, the first slice (SPEC §20 phase 40, built in §20 phase 233).
 *
 * §40 has described a tabletop module since the spec was written, and it
 * prescribes its own scope, which this follows rather than reopens:
 *
 * > If this is picked up later, split it: **rolls and checks as recorded
 * > events first, stats only if the checks get used.**
 *
 * So there are no stats, no inventory, no schema language and no builder UI.
 * §40 calls the user-defined schemas "a product in its own right" and it is
 * right; this is the half that is worth having on its own.
 *
 * **The rule it exists to keep is §22's**: don't roll dice in the model.
 * Pressing *Roll* runs `rollDice` server-side — the same function `{{roll:}}`
 * has used since §3 — records the result, and injects it into the next prompt
 * as settled fact the model narrates. The model never decides the number and
 * never sees the roll before it is fixed, which is the whole point of a check.
 *
 * An extension rather than core, per §15 and the product note: §21 lists a
 * code-executing runtime as a non-goal, and a built-in needs none — the code
 * ships in the host and the row exists so the manager can toggle it. Seeded
 * disabled, like every built-in.
 *
 * The idea of committing to a difficulty *before* the result is revealed came
 * from reading about ST's Multihog D&D Framework. It is GPL-3.0 and this
 * repository ships no licence, so it is a reference for what capability is
 * worth having and **never a source of code or text** — the same rule the
 * regex/renderer work followed. Nothing here is ported.
 */
const tabletop: BuiltinExtension = {
  name: "Tabletop",
  version: "1.0.0",
  author: "Onsen",
  description: "Rolls dice server-side and hands the result to the story as settled fact.",
  settings: [
    {
      key: "dice",
      label: "What a roll is",
      type: "string",
      default: "d20",
    },
    {
      key: "difficulty",
      label: "What a roll has to beat",
      type: "number",
      default: 11,
    },
  ],
  register(api, settings) {
    const dice = String(settings["dice"] ?? "d20");
    const difficulty = Number(settings["difficulty"] ?? 11);
    /*
     * One key holding a JSON array rather than a key per roll.
     *
     * `extension_state` is keyed `(extension_name, scene_id, key)` and the API
     * reads one key at a time — there is no "list my keys" — so a roll per key
     * could be written and never read back. A log under one key is what the
     * store can actually serve.
     *
     * Not a tracker row, which was the first candidate and the wrong one: a
     * tracker is the scene's state *rebuilt* each turn, with a CHECK
     * constraint pinning `kind` to 'scene' or 'characters'. A roll is an
     * append-only fact about a moment. Forcing one into the other would have
     * cost a migration and meant something the tracker contract does not say.
     */
    const LOG = "rolls";

    const readLog = (db: Parameters<typeof api.state.read>[0], sceneId: number): Roll[] => {
      const raw = api.state.read(db, sceneId, LOG);
      if (raw === null) return [];
      try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as Roll[]) : [];
      } catch {
        // A malformed log loses the history, never the turn (§8's rule, one
        // layer over): an extension that throws here would fail a generation.
        api.log.warn("the roll log was not readable; starting a new one");
        return [];
      }
    };

    api.action({
      key: "roll",
      label: "Roll",
      description: `Rolls ${dice} against ${difficulty} and tells the story what happened.`,
      // No `prompt`, so the host runs this instead of calling a model.
      run({ db, sceneId }) {
        if (sceneId === null) return;
        const history = readLog(db, sceneId);
        const rng = createRng(rollSeed(sceneId, history.length, Date.now()));
        const rolled = rollDice(dice, rng);
        if (rolled === null) {
          api.log.warn(`"${dice}" is not a roll this understands; nothing was rolled`);
          return `"${dice}" is not a roll this understands. Nothing was rolled.`;
        }
        const total = Number(rolled);
        const roll: Roll = {
          at: Date.now(),
          dice,
          total,
          difficulty,
          outcome: total >= difficulty ? "success" : "failure",
          narrated: false,
        };
        // Newest last, and bounded: a long scene should not carry a thousand
        // rolls into every prompt build.
        const log = [...history, roll].slice(-50);
        api.state.write(db, sceneId, LOG, JSON.stringify(log));
        api.log.info(`rolled ${dice} → ${total} against ${difficulty}: ${roll.outcome}`);
        // Said back to the reader, who pressed a button and is owed an answer
        // before the next turn arrives.
        return `${dice}: ${total} against ${difficulty} — ${roll.outcome}.`;
      },
    });

    api.inject({
      key: "roll",
      label: "The roll",
      // Next to the turn rather than in the prefix: it is a fact about *now*,
      // and a fact about now read a hundred messages up is a fact about then.
      position: "in_chat",
      depth: 0,
      role: "system",
      render({ db, sceneId }) {
        const log = readLog(db, sceneId);
        const pending = log.filter((roll) => roll.narrated !== true);
        if (pending.length === 0) return null;
        /*
         * Marked narrated as it is rendered, so a roll reaches the model once.
         * A roll that kept reappearing would have the story tell it twice,
         * which reads as the app losing its place.
         */
        const seen = log.map((roll) => ({ ...roll, narrated: true }));
        api.state.write(db, sceneId, LOG, JSON.stringify(seen));
        return pending
          .map(
            (roll) =>
              `[Rolled ${roll.dice}: ${roll.total} against ${roll.difficulty} — ` +
              `${roll.outcome}. This already happened. Narrate the outcome; do not ` +
              `change the number and do not roll again.]`,
          )
          .join("\n");
      },
    });
  },
};

export const BUILTINS: BuiltinExtension[] = [proofread, loreScout, tabletop];
