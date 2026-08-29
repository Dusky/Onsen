import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import { findScene, findMessage, activePath, speakerLookup } from "../db/queries/history.ts";
import {
  isBeatBound,
  isImpersonatePerson,
  isReviseMode,
  isTurnScope,
  type ImpersonateResponse,
} from "../../shared/types.ts";
import { buildImpersonatePrompt, cleanImpersonation } from "../generation/impersonate.ts";
import { createEstimatingTokenizer } from "../prompt/index.ts";
import { IMPERSONATE, taskKind } from "../tasks/registry.ts";
import type { TaskRunner } from "../tasks/runner.ts";
import type { PassPipeline } from "../passes/pipeline.ts";
import type { GuideRunner } from "../guides/runner.ts";
import {
  activeGuides,
  editGuide,
  findGuide,
  flushGuides,
  toGuideDto,
} from "../db/queries/guides.ts";
import { isGuideKind } from "../../shared/types.ts";
import { findAnnotation, revertAnnotation } from "../db/queries/annotations.ts";
import { messageDto } from "../db/queries/history.ts";
import { capabilitiesFor } from "../adapters/index.ts";
import type { ProviderKind } from "../../shared/types.ts";
import type { SceneRow } from "../db/queries/history.ts";
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

/**
 * Which provider a scene generates on, for the capability checks an op has to
 * make before offering itself. Unknown means unknown, not "assume the best":
 * an op that pretends to work is worse than one that says it cannot.
 */
function providerKindOf(ctx: AppContext, scene: SceneRow): ProviderKind | null {
  if (scene.connection_profile_id === null) return null;
  const row = ctx.db
    .query(
      `SELECT p.kind FROM connection_profiles cp JOIN providers p ON p.id = cp.provider_id
        WHERE cp.id = $id`,
    )
    .get({ id: scene.connection_profile_id }) as { kind: ProviderKind } | null;
  return row?.kind ?? null;
}

/**
 * Continue needs the provider to accept a partial assistant turn (SPEC §7).
 * Where it cannot, the op says so rather than producing a fresh turn that
 * pretends to be a continuation.
 */
function canContinue(ctx: AppContext, scene: SceneRow): boolean {
  const kind = providerKindOf(ctx, scene);
  if (kind === null) return false;
  try {
    return capabilitiesFor(kind).supportsPrefill;
  } catch {
    // An adapter that does not exist yet has no capabilities to read.
    return false;
  }
}

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
  tasks: TaskRunner,
  passes: PassPipeline,
  guides: GuideRunner,
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
      nudge?: unknown;
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

    // A one-shot instruction for this generation only (SPEC §7). Never stored
    // as a message: direction is not something the reader said.
    if (body.nudge !== undefined && typeof body.nudge !== "string") {
      return c.json({ error: { code: "bad_request", message: "The nudge must be text." } }, 400);
    }
    const nudge = typeof body.nudge === "string" && body.nudge.trim() !== "" ? body.nudge : undefined;

    try {
      const snapshot = service.start({
        scene,
        ...(parentId === undefined ? {} : { parentId }),
        ...(profileId === undefined ? {} : { connectionProfileId: profileId }),
        ...(spotlightId === undefined ? {} : { spotlightId }),
        ...(scope === undefined ? {} : { scope }),
        ...(beatBound === undefined ? {} : { beatBound }),
        ...(nudge === undefined ? {} : { nudge }),
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
   * Produce a better version of a turn that already exists (SPEC §7).
   *
   * Expand, correct and continue are one endpoint because they are one shape:
   * hand the model what it wrote and ask for something different. The result is
   * always a sibling of the target, so asking for a longer version and
   * disliking it costs a swipe and nothing else.
   */
  app.post("/:sceneId/messages/:messageId/revise", async (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }
    const message = findMessage(ctx.db, c.req.param("messageId"));
    if (message === null || message.scene_id !== scene.id) {
      return c.json({ error: { code: "not_found", message: "No such message." } }, 404);
    }

    let body: { mode?: unknown; instructions?: unknown } = {};
    try {
      const parsed: unknown = await c.req.json();
      if (typeof parsed === "object" && parsed !== null) body = parsed;
    } catch {
      /* Falls through to the validation below. */
    }
    if (!isReviseMode(body.mode)) {
      return c.json(
        { error: { code: "bad_request", message: "Expand, correct or continue?" } },
        400,
      );
    }
    if (body.instructions !== undefined && typeof body.instructions !== "string") {
      return c.json(
        { error: { code: "bad_request", message: "The instructions must be text." } },
        400,
      );
    }
    // Continue needs the provider to accept a partial assistant turn. Where it
    // cannot, saying so beats producing a fresh turn that pretends to be a
    // continuation (SPEC §7).
    if (body.mode === "continue" && !canContinue(ctx, scene)) {
      return c.json(
        {
          error: {
            code: "unsupported",
            message: "This provider cannot continue a message it has already finished.",
          },
        },
        422,
      );
    }

    const instructions =
      typeof body.instructions === "string" && body.instructions.trim() !== ""
        ? body.instructions.trim()
        : undefined;

    try {
      return c.json(
        service.start({
          scene,
          revise: {
            message,
            mode: body.mode,
            ...(instructions === undefined ? {} : { instructions }),
          },
        }),
        201,
      );
    } catch (caught) {
      if (caught instanceof GenerationError) {
        const status =
          caught.code === "already_generating" ? 409 : caught.code === "not_revisable" ? 422 : 400;
        return c.json({ error: { code: caught.code, message: caught.message } }, status);
      }
      throw caught;
    }
  });

  /**
   * Impersonate (SPEC §7): expand an outline into a turn in the reader's voice.
   *
   * The result lands in the composer and never auto-sends, which is what makes
   * this op safe — it is the one place the author is asked to write the
   * reader's character, and nothing it produces reaches the story without the
   * user pressing send.
   */
  app.post("/:sceneId/impersonate", async (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }

    let body: { outline?: unknown; person?: unknown } = {};
    try {
      const parsed: unknown = await c.req.json();
      if (typeof parsed === "object" && parsed !== null) body = parsed;
    } catch {
      /* An empty body is "write something for me", which is a real ask. */
    }
    const outline = typeof body.outline === "string" ? body.outline : "";
    const person = isImpersonatePerson(body.person) ? body.person : "first";

    const speakers = speakerLookup(ctx.db);
    const persona =
      scene.persona_id === null
        ? { name: null, description: null }
        : ((ctx.db
            .query("SELECT name, description FROM personas WHERE id = $id")
            .get({ id: scene.persona_id }) as { name: string; description: string | null } | null) ??
          { name: null, description: null });
    const author =
      scene.author_id === null
        ? null
        : ((ctx.db.query("SELECT name FROM authors WHERE id = $id").get({ id: scene.author_id }) as
            | { name: string }
            | null)?.name ?? null);

    const outcome = await tasks.run({
      kind: taskKind(IMPERSONATE)!,
      sceneId: scene.id,
      fallbackProfileId: scene.connection_profile_id,
      prompt: buildImpersonatePrompt(
        {
          persona,
          outline,
          person,
          author,
          history: activePath(ctx.db, scene.id)
            .filter((row) => row.is_hidden === 0)
            .slice(-8)
            .map((row) => ({
              speaker:
                row.character_id === null
                  ? row.author_type === "user"
                    ? (persona.name ?? "The reader")
                    : "Narration"
                  : (speakers.nameById.get(row.character_id) ?? "Someone"),
              content: row.content,
            })),
        },
        createEstimatingTokenizer(),
      ),
    });

    const response: ImpersonateResponse = outcome.ok
      ? { text: cleanImpersonation(outcome.text), detail: null }
      : { text: null, detail: outcome.detail };
    return c.json(response, outcome.ok ? 200 : 502);
  });

  /* -------------------------------------------------------------- */
  /* Persistent guides (SPEC §8)                                     */
  /* -------------------------------------------------------------- */

  /**
   * Write or rewrite one guide, or every guide that is switched on.
   *
   * Awaited: the user pressed rebuild and is looking at the panel, so the
   * answer comes back with the response rather than making them poll.
   */
  app.post("/:sceneId/guides/rebuild", async (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }

    let kind: unknown;
    try {
      const parsed: unknown = await c.req.json();
      if (typeof parsed === "object" && parsed !== null) kind = (parsed as { kind?: unknown }).kind;
    } catch {
      /* No body means every guide that is on. */
    }
    if (kind !== undefined && !isGuideKind(kind)) {
      return c.json({ error: { code: "bad_request", message: "No such guide." } }, 400);
    }

    await guides.refresh(scene, {
      automatic: false,
      ...(kind === undefined ? {} : { kinds: [kind] }),
    });
    return c.json(activeGuides(ctx.db, scene.id).map(toGuideDto));
  });

  /** Hand-edit a guide, which pins it against the next refresh (SPEC §8). */
  app.patch("/:sceneId/guides/:guideId", async (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }
    const guide = findGuide(ctx.db, c.req.param("guideId"));
    if (guide === null || guide.scene_id !== scene.id) {
      return c.json({ error: { code: "not_found", message: "No such guide." } }, 404);
    }

    let content: unknown;
    try {
      const parsed: unknown = await c.req.json();
      if (typeof parsed === "object" && parsed !== null) {
        content = (parsed as { content?: unknown }).content;
      }
    } catch {
      /* Falls through to the check below. */
    }
    if (typeof content !== "string" || content.trim() === "") {
      return c.json(
        { error: { code: "bad_request", message: "A guide with nothing in it is a flush." } },
        400,
      );
    }

    return c.json(toGuideDto(editGuide(ctx.db, guide.id, content.trim())));
  });

  /**
   * Flush one guide, or all of them (SPEC §8).
   *
   * Every version goes, not just the one in force: a flush means "stop
   * injecting this", and leaving older versions behind would resurrect one the
   * moment the reader rewound.
   */
  app.delete("/:sceneId/guides/:kind", (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }
    const raw = c.req.param("kind");
    if (raw !== "all" && !isGuideKind(raw)) {
      return c.json({ error: { code: "not_found", message: "No such guide." } }, 404);
    }
    flushGuides(ctx.db, scene.id, raw === "all" ? null : raw);
    return c.json(activeGuides(ctx.db, scene.id).map(toGuideDto));
  });

  /**
   * Read a finished turn by hand (SPEC §7.5: auto-run per scene, or manual per
   * message).
   *
   * Awaited, unlike the automatic run — the user asked and is waiting, so the
   * response carries the findings rather than making them poll for something
   * they just pressed a button for.
   */
  app.post("/:sceneId/messages/:messageId/passes", async (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }
    const message = findMessage(ctx.db, c.req.param("messageId"));
    if (message === null || message.scene_id !== scene.id) {
      return c.json({ error: { code: "not_found", message: "No such message." } }, 404);
    }
    if (message.author_type === "user") {
      return c.json(
        {
          error: {
            code: "bad_request",
            message: "These passes read what the author wrote, not what you wrote.",
          },
        },
        400,
      );
    }

    await passes.run({ scene, message, automatic: false });
    return c.json(messageDto(ctx.db, findMessage(ctx.db, message.ulid)!, scene.ulid));
  });

  /**
   * Put back what a pass changed (SPEC §7.5: the original is always retained so
   * the user can see and revert).
   */
  app.post("/:sceneId/annotations/:annotationId/revert", (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }
    const annotation = findAnnotation(ctx.db, c.req.param("annotationId"));
    if (annotation === null) {
      return c.json({ error: { code: "not_found", message: "No such note." } }, 404);
    }
    const message = ctx.db
      .query("SELECT * FROM messages WHERE id = $id")
      .get({ id: annotation.message_id }) as { ulid: string; scene_id: number } | null;
    if (message === null || message.scene_id !== scene.id) {
      return c.json({ error: { code: "not_found", message: "No such note." } }, 404);
    }
    if (annotation.original_content === null) {
      return c.json(
        { error: { code: "bad_request", message: "That note did not change anything." } },
        400,
      );
    }

    revertAnnotation(ctx.db, annotation, findMessage(ctx.db, message.ulid)!);
    return c.json(messageDto(ctx.db, findMessage(ctx.db, message.ulid)!, scene.ulid));
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
