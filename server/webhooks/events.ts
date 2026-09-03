/**
 * What a webhook can subscribe to (SPEC §15).
 *
 * The five §15 names, and nothing invented beside them. Each is a moment that
 * already exists in the app — a message landing, a generation finishing, a beat
 * being parsed, a tracker being written, lore firing — so subscribing is a
 * matter of forwarding something that happened rather than of computing
 * something new for the benefit of a listener.
 */

export const WEBHOOK_EVENTS = [
  "message.created",
  "generation.complete",
  "beat.parsed",
  "tracker.updated",
  "lore.activated",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function isWebhookEvent(value: unknown): value is WebhookEvent {
  return typeof value === "string" && (WEBHOOK_EVENTS as readonly string[]).includes(value);
}

/**
 * The envelope every delivery carries.
 *
 * `data` differs per event; everything around it does not, so a receiver can
 * route on `event` and log on `id` without knowing which events exist yet.
 */
export interface WebhookPayload {
  id: string;
  event: WebhookEvent;
  /** Milliseconds, as everything else in this app records time. */
  sentAt: number;
  /** Which roleplay this happened in. Null for an event about nothing. */
  sceneId: string | null;
  sceneTitle: string | null;
  data: Record<string, unknown>;
}

/**
 * Which subscriptions want this.
 *
 * Pure, and separate from the sender, so "would this fire" is a question that
 * can be asked without a network. A subscription bound to one scene wants only
 * that scene; one bound to none wants every scene.
 */
export interface Subscription {
  id: string;
  events: WebhookEvent[];
  sceneId: string | null;
  enabled: boolean;
}

export function subscribersOf(
  subscriptions: readonly Subscription[],
  event: WebhookEvent,
  sceneId: string | null,
): Subscription[] {
  return subscriptions.filter(
    (subscription) =>
      subscription.enabled &&
      subscription.events.includes(event) &&
      (subscription.sceneId === null || subscription.sceneId === sceneId),
  );
}
