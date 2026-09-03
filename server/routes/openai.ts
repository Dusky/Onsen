import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { findSceneById, appendMessage, findMessageById } from "../db/queries/history.ts";
import { castRowsOf } from "../db/queries/authors.ts";
import {
  keyForToken,
  noteUse,
  recordRequest,
  type JoinedApiKey,
} from "../db/queries/api-keys.ts";
import { parseModelId, formatModelId } from "../openai/model-id.ts";
import { parseInlineOps } from "../openai/inline-ops.ts";
import { CLIENT_ASSEMBLED, WARNING_HEADER, checkAssembly } from "../openai/double-assembly.ts";
import { GenerationError, type GenerationService } from "../generation/service.ts";
import { ulid } from "../lib/ulid.ts";
import { scriptText } from "../scripts/runtime.ts";
import type { SceneRow } from "../db/queries/history.ts";

/**
 * The outbound OpenAI-compatible API (SPEC §19, §20 phase 37).
 *
 * Other clients — a terminal, a bot, an editor plugin, another frontend — can
 * address a configured scene as if it were a model, and the server runs the
 * whole pipeline behind it: author, cast, spotlight selection, lore, guides,
 * trackers, summaries. "This turns the prompt builder into a service rather
 * than a UI feature."
 *
 * Generations started here go through the same generation service as the UI's,
 * so they create ordinary message nodes and reach a scene open in a browser
 * over §5's head sync. That is §19's stated payoff: start a scene on your
 * phone, continue it from a terminal, and both stay in sync.
 *
 * Mounted outside `/api` and outside the session middleware. This surface is
 * addressed by machines with bearer tokens; a cookie has no business here, and
 * a cookie that worked here would make every page on the internet able to drive
 * a scene through the reader's own browser.
 */

/** The statuses this surface answers with. Hono types the argument narrowly. */
type ApiStatus = 400 | 401 | 403 | 404 | 409 | 500 | 502;

/** OpenAI's error envelope, which is what a client's SDK will try to read. */
function apiError(message: string, type: string, status: ApiStatus) {
  return { body: { error: { message, type, param: null, code: null } }, status } as const;
}

interface IncomingMessage {
  role: string;
  content: unknown;
}

/** Content can be a string or OpenAI's array-of-parts. Both are accepted. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text"
        ? String((part as { text?: unknown }).text ?? "")
        : "",
    )
    .join("");
}

export interface OpenAiRouteOptions {
  ctx: AppContext;
  generation: GenerationService;
}

export function openAiRoutes({ ctx, generation }: OpenAiRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /**
   * Bearer auth, and the two switches that have to agree.
   *
   * §19: "Off by default. Enable per-scene, explicitly." A valid key does not
   * open a scene that has not opted in, and an opted-in scene is not reachable
   * without a key. Neither alone opens anything.
   */
  function authenticate(header: string | undefined): JoinedApiKey | null {
    if (header === undefined) return null;
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match === null) return null;
    return keyForToken(ctx.db, match[1]!.trim());
  }

  /** Every scene that has opted in, with its slug. */
  function enabledScenes(): (SceneRow & { api_slug: string })[] {
    return ctx.db
      .query(
        "SELECT * FROM scenes WHERE api_enabled = 1 AND api_slug IS NOT NULL ORDER BY updated_at DESC",
      )
      .all() as (SceneRow & { api_slug: string })[];
  }

  function sceneBySlug(slug: string): (SceneRow & { api_slug: string }) | null {
    return (ctx.db
      .query("SELECT * FROM scenes WHERE api_slug = $slug AND api_enabled = 1")
      .get({ slug }) as (SceneRow & { api_slug: string }) | null) ?? null;
  }

  app.use("*", async (c, next) => {
    const key = authenticate(c.req.header("Authorization"));
    if (key === null) {
      const { body, status } = apiError(
        "Provide a bearer token. Make one in Settings.",
        "invalid_request_error",
        401,
      );
      return c.json(body, status);
    }
    c.set("apiKey" as never, key as never);
    noteUse(ctx.db, key.id);
    await next();
  });

  /**
   * What this install answers to.
   *
   * Only what the presented key can actually reach: a key scoped to one scene
   * listing every scene would be telling the holder about roleplays it cannot
   * open, which is both a leak and a lie.
   */
  app.get("/models", (c) => {
    const key = c.get("apiKey" as never) as unknown as JoinedApiKey;
    const scenes = enabledScenes().filter(
      (scene) => key.scene_id === null || key.scene_id === scene.id,
    );

    const data: { id: string; object: "model"; created: number; owned_by: string }[] = [];
    for (const scene of scenes) {
      data.push({
        id: formatModelId({ kind: "scene", slug: scene.api_slug, character: null }),
        object: "model",
        created: Math.floor(scene.created_at / 1000),
        owned_by: "onsen",
      });
      // A forced speaker per cast member, because §19's `scene/<slug>/<char>`
      // is only usable if a client can discover the names.
      for (const member of castRowsOf(ctx.db, scene.id)) {
        if (member.is_active !== 1) continue;
        data.push({
          id: formatModelId({
            kind: "scene",
            slug: scene.api_slug,
            character: slugOfName(member.name),
          }),
          object: "model",
          created: Math.floor(scene.created_at / 1000),
          owned_by: "onsen",
        });
      }
    }

    // `author/<slug>` and `passthrough/<profile>` are §19 targets this phase did
    // not build, and they are deliberately not listed: a model id a client can
    // read out of `/v1/models` and then be refused by is worse than one that
    // was never advertised.
    return c.json({ object: "list", data });
  });

  app.post("/chat/completions", async (c) => {
    const startedAt = Date.now();
    const key = c.get("apiKey" as never) as unknown as JoinedApiKey;

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await c.req.json();
      body = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      body = {};
    }

    const modelId = typeof body["model"] === "string" ? body["model"] : "";
    const finish = (status: number, warning: string | null) =>
      recordRequest(ctx.db, key.id, {
        model: modelId,
        status,
        warning,
        durationMs: Date.now() - startedAt,
      });

    const target = parseModelId(modelId);
    if (target === null) {
      finish(404, null);
      const { body: error, status } = apiError(
        `The model \`${modelId}\` does not exist. Ask /v1/models what this install answers to.`,
        "invalid_request_error",
        404,
      );
      return c.json(error, status);
    }

    if (target.kind === "author") {
      finish(400, null);
      const { body: error, status } = apiError(
        "author/<slug> is not built yet: it needs a stateless prompt path, and this one always has a scene behind it.",
        "invalid_request_error",
        400,
      );
      return c.json(error, status);
    }
    if (target.kind === "passthrough") {
      finish(400, null);
      const { body: error, status } = apiError(
        "passthrough/<profile> is not built yet.",
        "invalid_request_error",
        400,
      );
      return c.json(error, status);
    }

    const scene = sceneBySlug(target.slug);
    if (scene === null) {
      finish(404, null);
      const { body: error, status } = apiError(
        `No roleplay answers to \`${modelId}\`. It may exist but not have the API switched on.`,
        "invalid_request_error",
        404,
      );
      return c.json(error, status);
    }
    if (key.scene_id !== null && key.scene_id !== scene.id) {
      finish(403, null);
      const { body: error, status } = apiError(
        "That key is scoped to a different roleplay.",
        "invalid_request_error",
        403,
      );
      return c.json(error, status);
    }

    const messages = Array.isArray(body["messages"])
      ? (body["messages"] as IncomingMessage[])
      : [];

    // §19's double-assembly protection. A warning and never a refusal: a false
    // positive that rejected the request would break a client over a heuristic.
    const system = messages
      .filter((message) => message.role === "system")
      .map((message) => textOf(message.content))
      .join("\n\n");
    const assembly = checkAssembly(system);
    const warning = assembly.assembled ? CLIENT_ASSEMBLED : null;
    if (warning !== null) c.header(WARNING_HEADER, warning);

    // §19's history reconciliation. `last_message` is the default and the only
    // mode built: take the final user message, ignore the rest, use the stored
    // history. It works with any client and keeps the tree canonical.
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    if (lastUser === undefined) {
      finish(400, warning);
      const { body: error, status } = apiError(
        "Send at least one user message.",
        "invalid_request_error",
        400,
      );
      return c.json(error, status);
    }

    const ops = parseInlineOps(textOf(lastUser.content));

    // A steer is scene state, so it is applied before the turn rather than
    // carried into it (§7).
    if (ops.clearSteer) {
      ctx.db.query("UPDATE scenes SET director_note = NULL WHERE id = $id").run({ id: scene.id });
    } else if (ops.steer !== null) {
      ctx.db
        .query("UPDATE scenes SET director_note = $note WHERE id = $id")
        .run({ id: scene.id, note: ops.steer });
    }

    // `((as: name))` beats the model id, which beats the turn director: the
    // more specific instruction, given later, wins.
    const spotlightId = resolveSpeaker(scene, ops.as ?? target.character);

    if (ops.text.trim() !== "") {
      appendMessage(ctx.db, {
        sceneId: scene.id,
        parentId: scene.active_leaf_id,
        kind: "user",
        authorType: "user",
        // The same stage the composer's own messages go through (§14), because
        // a script that fixes the reader's habits should not care which client
        // they typed into.
        content: scriptText(ctx.db, "user_input", ops.text, { sceneId: scene.id }),
      });
    }

    const fresh = findSceneById(ctx.db, scene.id);
    if (fresh === null) {
      finish(500, warning);
      const { body: error, status } = apiError("That roleplay went away.", "server_error", 500);
      return c.json(error, status);
    }

    let snapshot;
    try {
      snapshot = generation.start({
        scene: fresh,
        ...(spotlightId === null ? {} : { spotlightId }),
        ...(ops.nudge === null ? {} : { nudge: ops.nudge }),
        ...(ops.ooc === null ? {} : { ooc: { question: ops.ooc } }),
      });
    } catch (caught) {
      const status: ApiStatus =
        caught instanceof GenerationError && caught.code === "already_generating" ? 409 : 400;
      finish(status, warning);
      const { body: error } = apiError(
        caught instanceof Error ? caught.message : "That turn could not be started.",
        status === 409 ? "rate_limit_error" : "invalid_request_error",
        status,
      );
      return c.json(error, status);
    }

    const completionId = `chatcmpl-${ulid().toLowerCase()}`;
    const created = Math.floor(Date.now() / 1000);

    if (body["stream"] === true) {
      finish(200, warning);
      return streamCompletion(generation, snapshot.id, modelId, completionId, created);
    }

    const settled = await generation.awaitSettled(snapshot.id);
    const text = settled?.buffer ?? "";
    const failed = settled?.status === "error";
    finish(failed ? 502 : 200, warning);
    if (failed) {
      const { body: error, status } = apiError(
        settled?.error ?? "The turn failed.",
        "server_error",
        502,
      );
      return c.json(error, status);
    }

    return c.json({
      id: completionId,
      object: "chat.completion",
      created,
      model: modelId,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: text },
          finish_reason: settled?.status === "cancelled" ? "length" : "stop",
        },
      ],
      // Reported as this app counts them, which is an estimate and says so in
      // its own UI. A client reading these for billing is reading the wrong
      // number from the wrong app.
      usage: {
        prompt_tokens: settled?.meta?.promptTokens ?? 0,
        completion_tokens: settled?.meta?.completionTokens ?? 0,
        total_tokens:
          (settled?.meta?.promptTokens ?? 0) + (settled?.meta?.completionTokens ?? 0),
      },
    });
  });

  /** A cast member's name as it appears in a model id. */
  function slugOfName(name: string): string {
    return name
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
  }

  /** Which cast member a name in a model id or an `((as:))` refers to. */
  function resolveSpeaker(scene: SceneRow, name: string | null): number | null {
    if (name === null) return null;
    const wanted = slugOfName(name);
    const member = castRowsOf(ctx.db, scene.id).find(
      (candidate) => candidate.is_active === 1 && slugOfName(candidate.name) === wanted,
    );
    return member?.id ?? null;
  }

  return app;
}

/**
 * OpenAI's streaming shape, over this app's generation stream.
 *
 * The two do not line up on their own: this app's stream carries absolute
 * offsets so a reconnecting phone can resume, and OpenAI's carries deltas. The
 * offset is what the conversion needs — a client that missed nothing still gets
 * each token exactly once, and one that reconnects gets a new completion rather
 * than a duplicated one, which is what every OpenAI client already expects.
 */
function streamCompletion(
  generation: GenerationService,
  generationId: string,
  model: string,
  completionId: string,
  created: number,
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let sent = 0;

      const send = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const chunk = (delta: Record<string, unknown>, finish: string | null) => ({
        id: completionId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta, finish_reason: finish }],
      });

      // The role arrives in its own first chunk, as OpenAI's does. Clients that
      // build a message from the deltas rely on it being there once.
      send(chunk({ role: "assistant", content: "" }, null));

      const unsubscribe = generation.subscribe(generationId, 0, (event) => {
        if (closed) return;
        if (event.type === "chunk") {
          // Absolute offsets in, deltas out.
          const text = event.text;
          const from = Math.max(0, sent - event.offset);
          const delta = text.slice(from);
          if (delta !== "") {
            sent = event.offset + text.length;
            send(chunk({ content: delta }, null));
          }
          return;
        }
        if (event.type === "done" || event.type === "cancelled" || event.type === "error") {
          send(chunk({}, event.type === "done" ? "stop" : "length"));
          if (!closed) {
            closed = true;
            try {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            } catch {
              /* already gone */
            }
          }
          unsubscribe?.();
        }
      });

      if (unsubscribe === null) {
        send(chunk({}, "stop"));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
