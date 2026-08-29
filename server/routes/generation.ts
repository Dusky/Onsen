import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import { findScene, findMessage } from "../db/queries/history.ts";
import { isBeatBound, isTurnScope } from "../../shared/types.ts";
import { GenerationError, type GenerationEvent, type GenerationService } from "../generation/service.ts";

/**
 * Generation over HTTP (SPEC §5).
 *
 * The client starts a generation and gets an identifier back immediately, then
 * opens a separate SSE stream for the output. Splitting them is what makes the
 * stream resumable: the request that started the work is long gone by the time
 * a phone comes back from being suspended, and the stream can be reopened from
 * any offset as many times as the network requires.
 */

/** SPEC §5: heartbeat every 15s so proxies do not close an idle stream. */
const HEARTBEAT_MS = 15_000;

function sseFrame(event: GenerationEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Mounted under /scenes, alongside the scene routes.
 *
 * Kept separate from the /generations router rather than mounting one router at
 * the API root: a router's wildcard middleware applies to everything under its
 * prefix, and at the root that would make this module's auth guard swallow the
 * API's own 404 handler.
 */
export function sceneGenerationRoutes(
  ctx: AppContext,
  service: GenerationService,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  /**
   * Start generating. Returns as soon as the work is queued; the generation
   * continues whether or not anyone is listening.
   */
  app.post("/:sceneId/generate", async (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }

    let body: {
      parentId?: string | null;
      connectionProfileId?: string | null;
      characterId?: string | null;
      scope?: unknown;
      beatBound?: unknown;
    } = {};
    try {
      const parsed: unknown = await c.req.json();
      if (typeof parsed === "object" && parsed !== null) body = parsed;
    } catch {
      // An empty body is the common case: generate from the active leaf using
      // the scene's own profile.
    }

    // Naming a parent is how a reroll asks for a sibling rather than a
    // continuation, and how a branch generates from a rewound point.
    let parentId: number | null | undefined;
    if (body.parentId === null) {
      parentId = null;
    } else if (typeof body.parentId === "string") {
      const parent = findMessage(ctx.db, body.parentId);
      if (parent === null || parent.scene_id !== scene.id) {
        return c.json({ error: { code: "not_found", message: "No such parent message." } }, 404);
      }
      parentId = parent.id;
    }

    let profileId: number | null | undefined;
    if (typeof body.connectionProfileId === "string") {
      const profile = ctx.db
        .query("SELECT id FROM connection_profiles WHERE ulid = $ulid")
        .get({ ulid: body.connectionProfileId }) as { id: number } | null;
      if (profile === null) {
        return c.json(
          { error: { code: "not_found", message: "No such connection profile." } },
          404,
        );
      }
      profileId = profile.id;
    }

    // Naming a character forces who speaks this turn.
    let spotlightId: number | undefined;
    if (typeof body.characterId === "string") {
      const member = ctx.db
        .query(
          `SELECT c.id FROM scene_members m JOIN characters c ON c.id = m.character_id
            WHERE m.scene_id = $scene_id AND c.ulid = $ulid`,
        )
        .get({ scene_id: scene.id, ulid: body.characterId }) as { id: number } | null;
      if (member === null) {
        return c.json(
          { error: { code: "not_found", message: "That character is not in this roleplay." } },
          404,
        );
      }
      spotlightId = member.id;
    }

    // One character or several (SPEC §3.5). An unrecognised scope is a client
    // sending something this server does not have; a spotlight is the safe read.
    const scope = isTurnScope(body.scope) ? body.scope : undefined;
    if (body.beatBound !== undefined && !isBeatBound(body.beatBound)) {
      return c.json(
        { error: { code: "bad_request", message: "That is not a beat bound." } },
        400,
      );
    }
    const beatBound = isBeatBound(body.beatBound) ? body.beatBound : undefined;

    try {
      const snapshot = service.start({
        scene,
        ...(parentId === undefined ? {} : { parentId }),
        ...(profileId === undefined ? {} : { connectionProfileId: profileId }),
        ...(spotlightId === undefined ? {} : { spotlightId }),
        ...(scope === undefined ? {} : { scope }),
        ...(beatBound === undefined ? {} : { beatBound }),
      });
      return c.json(snapshot, 201);
    } catch (caught) {
      if (caught instanceof GenerationError) {
        const status = caught.code === "already_generating" ? 409 : 400;
        return c.json({ error: { code: caught.code, message: caught.message } }, status);
      }
      throw caught;
    }
  });

  /**
   * Recast one character's part of a beat (SPEC §7).
   *
   * The rest of the beat is held fixed and passed as context, and the result is
   * spliced into that segment's offsets. This is the per-character correction
   * affordance: swiping rerolls the whole exchange, which is a different and
   * much blunter thing to want.
   */
  app.post("/:sceneId/messages/:messageId/recast", async (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }
    const message = findMessage(ctx.db, c.req.param("messageId"));
    if (message === null || message.scene_id !== scene.id) {
      return c.json({ error: { code: "not_found", message: "No such message." } }, 404);
    }
    if (message.kind !== "beat") {
      return c.json(
        {
          error: {
            code: "bad_request",
            message: "Only a beat has parts to recast. Reroll the message instead.",
          },
        },
        400,
      );
    }

    let ordinal: unknown;
    try {
      const parsed: unknown = await c.req.json();
      if (typeof parsed === "object" && parsed !== null) {
        ordinal = (parsed as { ordinal?: unknown }).ordinal;
      }
    } catch {
      // Falls through to the validation below.
    }
    if (typeof ordinal !== "number" || !Number.isInteger(ordinal) || ordinal < 0) {
      return c.json(
        { error: { code: "bad_request", message: "Which part of the beat?" } },
        400,
      );
    }

    try {
      return c.json(service.start({ scene, recast: { message, ordinal } }), 201);
    } catch (caught) {
      if (caught instanceof GenerationError) {
        const status =
          caught.code === "already_generating" ? 409 : caught.code === "not_recastable" ? 422 : 400;
        return c.json({ error: { code: caught.code, message: caught.message } }, status);
      }
      throw caught;
    }
  });

  return app;
}

/** Mounted under /generations. */
export function generationRoutes(service: GenerationService): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  /** A snapshot, for a client that would rather poll than hold a stream open. */
  app.get("/:generationId", (c) => {
    const snapshot = service.get(c.req.param("generationId"));
    return snapshot === null
      ? c.json({ error: { code: "not_found", message: "No such generation." } }, 404)
      : c.json(snapshot);
  });

  /**
   * The stream. `?offset=N` replays everything past N and then continues live,
   * so a client that missed part of the output loses nothing (SPEC §5.3–5.4).
   */
  app.get("/:generationId/stream", (c) => {
    const id = c.req.param("generationId");
    const requested = Number(c.req.query("offset") ?? "0");
    const offset = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 0;

    if (service.get(id) === null) {
      return c.json({ error: { code: "not_found", message: "No such generation." } }, 404);
    }

    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const send = (text: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            // The client went away between the check and the write.
            closed = true;
          }
        };

        const finish = () => {
          if (closed) return;
          closed = true;
          if (heartbeat !== null) clearInterval(heartbeat);
          unsubscribe?.();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };

        unsubscribe = service.subscribe(id, offset, (event) => {
          send(sseFrame(event));
          // Only the three terminal events end the stream. A `director` event
          // is news about the turn, not the end of it — closing on anything
          // that merely is not a chunk would cut the stream off before a word
          // of prose arrived.
          if (event.type === "done" || event.type === "cancelled" || event.type === "error") {
            finish();
          }
        });

        if (unsubscribe === null) {
          finish();
          return;
        }

        // A comment line is a no-op to the client and enough to keep a proxy
        // from closing an idle connection.
        heartbeat = setInterval(() => send(": heartbeat\n\n"), HEARTBEAT_MS);
      },

      cancel() {
        // The client disconnected. The generation keeps running (SPEC §5.4) —
        // this only stops us writing to a socket that is gone.
        if (heartbeat !== null) clearInterval(heartbeat);
        unsubscribe?.();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // Tells nginx not to buffer, which would defeat streaming entirely.
        "X-Accel-Buffering": "no",
      },
    });
  });

  /** Abort, keeping whatever was produced (SPEC §5.6). */
  app.post("/:generationId/cancel", (c) => {
    const snapshot = service.cancel(c.req.param("generationId"));
    return snapshot === null
      ? c.json({ error: { code: "not_found", message: "No such generation." } }, 404)
      : c.json(snapshot);
  });

  return app;
}
