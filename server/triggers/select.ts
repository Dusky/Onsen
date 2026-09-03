/**
 * Which triggers fire, and in what order (SPEC §14).
 *
 * Pure, and separated from the runner for the same reason §10's activation
 * model is: what fires and why is a question worth being able to ask without a
 * database, a clock, or a generation in flight.
 */

export const TRIGGER_EVENTS = [
  "scene_start",
  "user_message",
  "before_generation",
  "after_generation",
  "lore_activation",
] as const;
export type TriggerEvent = (typeof TRIGGER_EVENTS)[number];

export const TRIGGER_ACTIONS = ["guide", "tracker", "script"] as const;
export type TriggerAction = (typeof TRIGGER_ACTIONS)[number];

export interface EventTrigger {
  id: string;
  name: string;
  event: TriggerEvent;
  action: TriggerAction;
  /** A guide kind, a tracker kind, or a regex script's ULID. */
  actionRef: string;
  /** `lore_activation` only: which entry's automation id fires this. */
  automationId: string | null;
  scope: "global" | "scene";
  sceneId: string | null;
  enabled: boolean;
  runOrder: number;
}

export interface FiringContext {
  event: TriggerEvent;
  /** The scene this happened in. */
  sceneId: string | null;
  /**
   * The automation ids carried by the lore entries that just activated (§10).
   * Empty for every event but `lore_activation`.
   */
  automationIds?: readonly string[];
}

/**
 * The triggers this event fires, in run order.
 *
 * A scene-scoped trigger fires only in its own scene; a global one fires
 * everywhere. `lore_activation` additionally needs the entry's automation id to
 * match, which is what makes it a named action rather than "something
 * activated".
 */
export function triggersFor(
  triggers: readonly EventTrigger[],
  context: FiringContext,
): EventTrigger[] {
  const automation = new Set(context.automationIds ?? []);
  return triggers
    .filter((trigger) => trigger.enabled && trigger.event === context.event)
    .filter((trigger) =>
      trigger.scope === "global" ? true : trigger.sceneId === (context.sceneId ?? null),
    )
    .filter((trigger) =>
      trigger.event !== "lore_activation"
        ? true
        : trigger.automationId !== null && automation.has(trigger.automationId),
    )
    .sort((a, b) => a.runOrder - b.runOrder || a.id.localeCompare(b.id));
}
