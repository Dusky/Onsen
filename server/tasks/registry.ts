import type { SamplerSettings } from "../../shared/types.ts";

/**
 * The kinds of background task this codebase knows how to run (SPEC §7).
 *
 * A *kind* is code: what it asks for, and what it does with the answer, are not
 * expressible as data. What is stored is the configuration of a kind — which
 * model to run it on, whether it is enabled, a replacement prompt — which is
 * §7's per-op row. A task whose behaviour is entirely data would be an
 * extension system, and §15 puts that in a much later tier for good reasons.
 *
 * Kinds are registered as they are built. Seeding rows for tasks whose feature
 * does not exist yet would be a settings screen full of switches that do
 * nothing, so this list grows one entry at a time.
 */

export type TaskStage = "pre_generation" | "sidecar" | "post_generation";

export interface TaskKind {
  key: string;
  /** Shown wherever a task is listed. */
  label: string;
  /** One line on what it is for, in the same voice as the rest of the UI. */
  description: string;
  stage: TaskStage;
  /**
   * Samplers for this kind. Deliberately not the scene's: a side call is a
   * decision or a summary, and §13's defaults exist to make prose less
   * predictable, which is the opposite of what is wanted here.
   */
  samplers: SamplerSettings;
  /** Milliseconds before the call is abandoned and the caller falls back. */
  timeoutMs: number;
  /** Characters of reply to read before stopping. A bound, not an expectation. */
  replyLimit: number;
}

export const TURN_CLASSIFIER = "turn_classifier";

export const TASK_KINDS: readonly TaskKind[] = [
  {
    key: TURN_CLASSIFIER,
    label: "Turn director",
    description: "Reads the last few turns and says who speaks next, in its own words.",
    stage: "pre_generation",
    samplers: { temperature: 0.2, top_p: 0.9 },
    timeoutMs: 12_000,
    // Two or three short lines. A reply past this is a model that has started
    // talking, and the answer is on the first line anyway.
    replyLimit: 600,
  },
];

export function taskKind(key: string): TaskKind | null {
  return TASK_KINDS.find((kind) => kind.key === key) ?? null;
}
