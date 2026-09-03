import type { Database } from "bun:sqlite";
import { ulid } from "../lib/ulid.ts";
import { decryptSecret, type Keyring } from "../lib/crypto.ts";
import {
  clearFailures,
  listWebhooks,
  noteFailure,
  parseEvents,
  recordDelivery,
  type JoinedWebhook,
} from "../db/queries/webhooks.ts";
import { subscribersOf, type WebhookEvent, type WebhookPayload } from "./events.ts";
import { DELIVERY_HEADER, EVENT_HEADER, SIGNATURE_HEADER, signPayload } from "./sign.ts";

/**
 * Delivering outbound webhooks (SPEC §15).
 *
 * One rule governs everything here: **a webhook can never affect a turn.**
 * §15's whole argument for out-of-process integration is that it is safer than
 * a plugin, and that stops being true the moment a receiver that stopped
 * answering can stall a generation. So sending is never awaited by the code
 * that emits, every failure is swallowed into the delivery log, and the request
 * carries a timeout well under any patience a person has.
 *
 * The one thing that is not swallowed is the *record*. A receiver failing
 * silently is exactly the failure §18 forbids, and a webhook is the one feature
 * whose failures happen entirely off-screen.
 */

/** How long a receiver has to answer. */
const TIMEOUT_MS = 5_000;

/** Attempts per delivery, first included. */
const ATTEMPTS = 3;

/** Consecutive failures before a subscription is switched off. */
const FAILURE_LIMIT = 20;

/** How much of a receiver's answer is read before it is discarded. */
const MAX_RESPONSE_BYTES = 2_048;

export interface WebhookSenderOptions {
  db: Database;
  keyring: Keyring;
  /** Injected in tests, so no request ever leaves the process (§23). */
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

export class WebhookSender {
  private readonly db: Database;
  private readonly keyring: Keyring;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly now: () => number;
  private stopped = false;
  /** Deliveries in flight, so a shutdown can wait for them rather than cut them. */
  private readonly inFlight = new Set<Promise<void>>();

  constructor(options: WebhookSenderOptions) {
    this.db = options.db;
    this.keyring = options.keyring;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
  }

  shutdown(): void {
    this.stopped = true;
  }

  /** Resolves once every delivery started so far has finished. For tests. */
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.all([...this.inFlight]);
  }

  /**
   * Whether anything at all wants this event.
   *
   * Called on the emitting paths before a payload is built, so an install with
   * no subscriptions — which is every install until someone writes one — pays
   * one indexed query rather than the cost of assembling a body nobody wants.
   */
  anyFor(event: WebhookEvent): boolean {
    const row = this.db
      .query("SELECT events FROM webhooks WHERE enabled = 1")
      .all() as { events: string }[];
    return row.some((subscription) => parseEvents(subscription.events).includes(event));
  }

  /**
   * Send an event to everyone subscribed to it.
   *
   * Deliberately not async from the caller's point of view: it starts the work
   * and returns. Nothing on a turn's path may wait for a receiver.
   */
  emit(
    event: WebhookEvent,
    where: { sceneId: string | null; sceneTitle: string | null },
    data: Record<string, unknown>,
  ): void {
    if (this.stopped) return;

    const subscriptions = listWebhooks(this.db);
    const wanted = subscribersOf(
      subscriptions.map((row) => ({
        id: row.ulid,
        events: parseEvents(row.events),
        sceneId: row.scene_ulid,
        enabled: row.enabled === 1,
      })),
      event,
      where.sceneId,
    );
    if (wanted.length === 0) return;

    const payload: WebhookPayload = {
      id: ulid(),
      event,
      sentAt: this.now(),
      sceneId: where.sceneId,
      sceneTitle: where.sceneTitle,
      data,
    };
    const body = JSON.stringify(payload);

    for (const subscription of wanted) {
      const row = subscriptions.find((candidate) => candidate.ulid === subscription.id);
      if (row === undefined) continue;
      this.track(this.deliver(row, event, body, payload.id));
    }
  }

  /** Send one payload to one subscription, by hand. The "test it" button. */
  async deliverOnce(
    row: JoinedWebhook,
    event: WebhookEvent,
    data: Record<string, unknown>,
  ): Promise<{ ok: boolean; status: number | null; detail: string | null }> {
    const payload: WebhookPayload = {
      id: ulid(),
      event,
      sentAt: this.now(),
      sceneId: row.scene_ulid,
      sceneTitle: null,
      data,
    };
    return this.attempt(row, event, JSON.stringify(payload), payload.id, 1);
  }

  private track(promise: Promise<void>): void {
    this.inFlight.add(promise);
    void promise.finally(() => this.inFlight.delete(promise));
  }

  /**
   * Deliver, retrying a failure a couple of times before giving up.
   *
   * The backoff is short and fixed. A webhook is about something that just
   * happened, and a delivery that arrives four minutes later is worse than one
   * that does not arrive at all — the receiver has already drawn the next turn.
   */
  private async deliver(
    row: JoinedWebhook,
    event: WebhookEvent,
    body: string,
    deliveryId: string,
  ): Promise<void> {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      if (this.stopped) return;
      const result = await this.attempt(row, event, body, deliveryId, attempt);
      if (result.ok) {
        clearFailures(this.db, row.id);
        return;
      }
      if (attempt < ATTEMPTS) await sleep(attempt * 500);
    }
    noteFailure(
      this.db,
      row.id,
      FAILURE_LIMIT,
      `Switched off after ${FAILURE_LIMIT} deliveries in a row failed.`,
    );
  }

  private async attempt(
    row: JoinedWebhook,
    event: WebhookEvent,
    body: string,
    deliveryId: string,
    attempt: number,
  ): Promise<{ ok: boolean; status: number | null; detail: string | null }> {
    const startedAt = this.now();
    let secret: string;
    try {
      secret = decryptSecret(this.keyring, row.secret);
    } catch {
      const detail = "This subscription's signing key could not be read.";
      this.log(row.id, event, "failed", null, detail, 0, attempt);
      return { ok: false, status: null, detail };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(row.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [SIGNATURE_HEADER]: signPayload(secret, body, Math.floor(this.now() / 1000)),
          [EVENT_HEADER]: event,
          [DELIVERY_HEADER]: deliveryId,
          "User-Agent": "Onsen",
        },
        body,
        signal: controller.signal,
        // A redirect is the classic way a signed request ends up somewhere its
        // sender did not choose. The subscription named a URL; that is the one
        // that gets the payload.
        redirect: "manual",
      });

      // The answer is read and thrown away, so a receiver streaming a reply
      // cannot hold the connection open, and so the socket is not left dangling.
      let detail: string | null = null;
      try {
        const text = await response.text();
        detail = text.slice(0, MAX_RESPONSE_BYTES) || null;
      } catch {
        /* A body that will not read does not change the status. */
      }

      const ok = response.status >= 200 && response.status < 300;
      const duration = this.now() - startedAt;
      this.log(
        row.id,
        event,
        ok ? "ok" : "failed",
        response.status,
        ok ? null : (detail ?? `The receiver answered ${response.status}.`),
        duration,
        attempt,
      );
      return { ok, status: response.status, detail: ok ? null : detail };
    } catch (caught) {
      const detail =
        controller.signal.aborted
          ? `No answer in ${TIMEOUT_MS / 1000} seconds.`
          : caught instanceof Error
            ? caught.message
            : "The request failed.";
      this.log(row.id, event, "failed", null, detail, this.now() - startedAt, attempt);
      return { ok: false, status: null, detail };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Never throws: a log write that failed must not become a thrown delivery. */
  private log(
    webhookId: number,
    event: string,
    status: "ok" | "failed",
    responseCode: number | null,
    detail: string | null,
    durationMs: number,
    attempt: number,
  ): void {
    try {
      recordDelivery(this.db, webhookId, {
        event,
        status,
        responseCode,
        detail,
        durationMs,
        attempt,
      });
    } catch {
      /* The database may be closing under a shutdown. */
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Whether a URL can be subscribed.
 *
 * http and https only, and no credentials in the URL — a signed payload
 * carrying basic-auth in its destination would put a second secret somewhere
 * this app does not encrypt.
 *
 * Private and loopback addresses are deliberately *allowed*. This is
 * single-user self-hosted software, and the most likely receiver is a bridge
 * running on the same machine; refusing 127.0.0.1 would block the main use case
 * to prevent a request the operator asked for. What is guarded instead is the
 * thing the operator did not ask for: redirects are not followed.
 */
export function urlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "That is not a URL.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "A webhook has to be http or https.";
  }
  if (url.username !== "" || url.password !== "") {
    return "Put credentials in a header your receiver checks, not in the URL.";
  }
  return null;
}
