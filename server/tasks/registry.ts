import type { SamplerSettings } from "../../shared/types.ts";

/**
 * Every named operation this codebase knows how to run (SPEC §7).
 *
 * "Task" is the table's name and the primitive's name; what it holds is §7's
 * per-op configuration row, and an *op* is anything with one. Two kinds share
 * the table because they share the row:
 *
 * - a **side call** runs off the main path on its own model and returns text —
 *   the turn classifier, impersonate, and every post-generation pass;
 * - a **turn instruction** is a block in the prompt of a user-facing generation
 *   — nudge, steer, expand, correct, continue.
 *
 * What an op *does* is code. What is stored is what a user gets to change about
 * it: whether it is on, which model it runs on, the words it uses, where those
 * words are injected, and whether its button is shown. An op whose behaviour
 * were entirely data would be the extension system §15 puts in a later tier.
 *
 * Ops are registered as they are built. There is no row for a feature that does
 * not exist, because a settings screen full of switches that do nothing is
 * worse than a short one.
 */

export type TaskStage = "pre_generation" | "sidecar" | "post_generation";

/** Where an op's text is injected. Which works best varies by model (§7). */
export type InjectionRole = "system" | "user" | "assistant";

export const INJECTION_ROLES: readonly InjectionRole[] = ["system", "user", "assistant"];

interface OpBase {
  key: string;
  /** Shown wherever an op is listed. */
  label: string;
  /** One line on what it is for, in the same voice as the rest of the UI. */
  description: string;
  stage: TaskStage;
  /**
   * The variables an override may use, beyond the ordinary macro set. Declared
   * rather than discovered so the editor can list them: a template language
   * whose variables are undocumented is a template language nobody can use.
   */
  variables: readonly string[];
  /** Whether hiding this op's button means anything. */
  hideable: boolean;
}

export interface SideCallOp extends OpBase {
  runs: "side_call";
  /**
   * Samplers for this op. Deliberately not the scene's: a side call is a
   * decision or a summary, and §13's defaults exist to make prose less
   * predictable, which is the opposite of what is wanted here.
   */
  samplers: SamplerSettings;
  /** Milliseconds before the call is abandoned and the caller falls back. */
  timeoutMs: number;
  /** Characters of reply to read before stopping. A bound, not an expectation. */
  replyLimit: number;
}

export interface TurnOp extends OpBase {
  runs: "turn";
  /** Where this op's text lands by default. Overridable per §7. */
  injectionRole: InjectionRole;
}

export type OpKind = SideCallOp | TurnOp;
/** The primitive only runs side calls; the name is the table's, not the shape's. */
export type TaskKind = SideCallOp;

export const TURN_CLASSIFIER = "turn_classifier";
export const IMPERSONATE = "impersonate";
export const NUDGE = "nudge";
export const STEER = "steer";
export const EXPAND = "expand";
export const CORRECT = "correct";
export const CONTINUE = "continue";

export const OP_KINDS: readonly OpKind[] = [
  {
    key: TURN_CLASSIFIER,
    runs: "side_call",
    label: "Turn director",
    description: "Reads the last few turns and says who speaks next, in its own words.",
    stage: "pre_generation",
    samplers: { temperature: 0.2, top_p: 0.9 },
    timeoutMs: 12_000,
    // Two or three short lines. A reply past this is a model that has started
    // talking, and the answer is on the first line anyway.
    replyLimit: 600,
    variables: ["cast", "transcript", "reader"],
    hideable: false,
  },
  {
    key: IMPERSONATE,
    runs: "side_call",
    label: "As me",
    description: "Turns a line of shorthand into a full message in your character's voice.",
    stage: "sidecar",
    samplers: { temperature: 0.9, min_p: 0.05 },
    // The user is watching this one, so it is given room — but not the whole
    // turn's worth, because a draft that overruns the composer is not a draft.
    timeoutMs: 60_000,
    replyLimit: 2_400,
    variables: ["input", "persona", "transcript"],
    hideable: true,
  },
  {
    key: NUDGE,
    runs: "turn",
    label: "Nudge",
    description: "One instruction for the next turn only. Never becomes a message.",
    stage: "pre_generation",
    injectionRole: "system",
    variables: ["input"],
    hideable: true,
  },
  {
    key: STEER,
    runs: "turn",
    label: "Steer",
    description: "A note applied to every turn until you clear it.",
    stage: "pre_generation",
    injectionRole: "system",
    variables: ["input"],
    hideable: true,
  },
  {
    key: EXPAND,
    runs: "turn",
    label: "Write it longer",
    description: "Asks for the same turn again with more happening in it.",
    stage: "pre_generation",
    injectionRole: "system",
    variables: ["original"],
    hideable: true,
  },
  {
    key: CORRECT,
    runs: "turn",
    label: "Rewrite this",
    description: "Changes what you name and keeps everything that was working.",
    stage: "pre_generation",
    injectionRole: "system",
    variables: ["original", "input"],
    hideable: true,
  },
  {
    key: CONTINUE,
    runs: "turn",
    label: "Continue",
    description: "Carries on from where a turn stopped, mid-flow.",
    stage: "pre_generation",
    injectionRole: "system",
    variables: ["original"],
    hideable: true,
  },
];

export function opKind(key: string): OpKind | null {
  return OP_KINDS.find((kind) => kind.key === key) ?? null;
}

/** A side call, or null when the key names a turn instruction instead. */
export function taskKind(key: string): SideCallOp | null {
  const kind = opKind(key);
  return kind !== null && kind.runs === "side_call" ? kind : null;
}
