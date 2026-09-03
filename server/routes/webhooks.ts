import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import { findScene } from "../db/queries/history.ts";
import { encryptSecret } from "../lib/crypto.ts";
import {
  deleteWebhook,
  findWebhook,
  insertWebhook,
  listDeliveries,
  listWebhooks,
  parseEvents,
  updateWebhook,
  type JoinedWebhook,
  type WebhookPatch,
} from "../db/queries/webhooks.ts";
import { WEBHOOK_EVENTS, isWebhookEvent, type WebhookEvent } from "../webhooks/events.ts";
import { urlProblem, type WebhookSender } from "../webhooks/sender.ts";

/**
 * Outbound webhooks (SPEC §15, §20 phase 35).
 *
 * The signing key is generated here rather than asked for, and returned exactly
 * once — on the response that created it. After that the column holds an
 * encrypted envelope and nothing in the app can show it again, which is the
 * same rule provider credentials follow (§17). A key the UI could re-read is
 * one that leaks through every screenshot of this screen.
 */

function badRequest(message: string) {
  return { error: { code: "bad_request", message } };
}

function notFound(what: string) {
  return { error: { code: "not_found", message: `No such ${what}.` } };
}

async function body(c: { req: { json(): Promise<unknown> } }): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await c.req.json();
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function text(value: unknown, max = 500): string | undefined {
  return typeof value === "string" ? value.slice(0, max) : undefined;
}

/** The events a request asked for, keeping only those this app can send. */
function eventsOf(value: unknown): WebhookEvent[] | null {
  if (!Array.isArray(value)) return null;
  const wanted = value.filter(isWebhookEvent);
  return wanted.length === 0 ? null : [...new Set(wanted)];
}

function toDto(row: JoinedWebhook, deliveries: ReturnType<typeof listDeliveries>) {
  return {
    id: row.ulid,
    name: row.name,
    url: row.url,
    events: parseEvents(row.events),
    sceneId: row.scene_ulid,
    enabled: row.enabled === 1,
    failures: row.failures,
    disabledReason: row.disabled_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deliveries: deliveries.map((delivery) => ({
      event: delivery.event,
      status: delivery.status,
      responseCode: delivery.response_code,
      detail: delivery.detail,
      durationMs: delivery.duration_ms,
      attempt: delivery.attempt,
      at: delivery.created_at,
    })),
  };
}

export function webhookRoutes(ctx: AppContext, sender: WebhookSender): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  app.get("/events", (c) => c.json({ events: WEBHOOK_EVENTS }));

  app.get("/", (c) =>
    c.json(listWebhooks(ctx.db).map((row) => toDto(row, listDeliveries(ctx.db, row.id, 10)))),
  );

  app.post("/", async (c) => {
    const input = await body(c);

    const name = text(input["name"], 120)?.trim() ?? "";
    if (name === "") return c.json(badRequest("A subscription needs a name."), 400);

    const url = text(input["url"], 2_000)?.trim() ?? "";
    const problem = urlProblem(url);
    if (problem !== null) return c.json(badRequest(problem), 400);

    const events = eventsOf(input["events"]);
    if (events === null) return c.json(badRequest("Pick at least one event to send."), 400);

    let sceneId: number | null = null;
    if (typeof input["sceneId"] === "string" && input["sceneId"] !== "") {
      const scene = findScene(ctx.db, input["sceneId"]);
      if (scene === null) return c.json(notFound("roleplay"), 404);
      sceneId = scene.id;
    }

    // 32 bytes, hex. Generated rather than asked for: a key the reader chose is
    // one they reused from somewhere else.
    const secret = randomBytes(32).toString("hex");
    const row = insertWebhook(ctx.db, {
      name,
      url,
      secret: encryptSecret(ctx.keyring, secret),
      events,
      sceneId,
      enabled: input["enabled"] !== false,
    });

    // The only time this is ever returned. It is not stored in a form the app
    // can read back to a browser.
    return c.json({ ...toDto(row, []), secret }, 201);
  });

  app.patch("/:webhookId", async (c) => {
    const row = findWebhook(ctx.db, c.req.param("webhookId"));
    if (row === null) return c.json(notFound("webhook"), 404);
    const input = await body(c);

    const patch: WebhookPatch = {};
    const name = text(input["name"], 120)?.trim();
    if (name !== undefined && name !== "") patch.name = name;

    const url = text(input["url"], 2_000)?.trim();
    if (url !== undefined) {
      const problem = urlProblem(url);
      if (problem !== null) return c.json(badRequest(problem), 400);
      patch.url = url;
    }

    if (input["events"] !== undefined) {
      const events = eventsOf(input["events"]);
      if (events === null) return c.json(badRequest("Pick at least one event to send."), 400);
      patch.events = events;
    }
    if (typeof input["enabled"] === "boolean") patch.enabled = input["enabled"];

    updateWebhook(ctx.db, row.id, patch);
    const stored = findWebhook(ctx.db, row.ulid)!;
    return c.json(toDto(stored, listDeliveries(ctx.db, stored.id, 10)));
  });

  /**
   * A new signing key.
   *
   * Rotation is a replace rather than an overlap: this is one sender talking to
   * one receiver, and a grace period where both keys verify would be machinery
   * for a problem a single-user app does not have.
   */
  app.post("/:webhookId/rotate", (c) => {
    const row = findWebhook(ctx.db, c.req.param("webhookId"));
    if (row === null) return c.json(notFound("webhook"), 404);
    const secret = randomBytes(32).toString("hex");
    updateWebhook(ctx.db, row.id, { secret: encryptSecret(ctx.keyring, secret) });
    return c.json({ secret });
  });

  app.delete("/:webhookId", (c) => {
    const row = findWebhook(ctx.db, c.req.param("webhookId"));
    if (row === null) return c.json(notFound("webhook"), 404);
    deleteWebhook(ctx.db, row.id);
    return c.body(null, 204);
  });

  /**
   * Send one now, and say what came back.
   *
   * The only synchronous delivery in the app, and the reason is that this is
   * the one a person is watching: "is my receiver reachable" should not be a
   * question answered by refreshing a log.
   */
  app.post("/:webhookId/test", async (c) => {
    const row = findWebhook(ctx.db, c.req.param("webhookId"));
    if (row === null) return c.json(notFound("webhook"), 404);
    const events = parseEvents(row.events);
    const result = await sender.deliverOnce(row, events[0] ?? "message.created", {
      test: true,
      note: "A test delivery from Onsen. Nothing happened in a roleplay.",
    });
    return c.json(result);
  });

  return app;
}
