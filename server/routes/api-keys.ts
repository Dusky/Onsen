import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import { findScene } from "../db/queries/history.ts";
import {
  deleteApiKey,
  findApiKey,
  insertApiKey,
  listApiKeys,
  listRequests,
  revokeApiKey,
  type JoinedApiKey,
} from "../db/queries/api-keys.ts";
import { slugify } from "../openai/model-id.ts";

/**
 * Managing §19's bearer keys, and switching the API on for a roleplay.
 *
 * Two switches have to agree before anything is reachable: a scene opts in, and
 * a key exists. §19 is explicit that this is off by default and enabled per
 * scene, so neither one alone opens anything — which is also why the two live
 * on the same screen.
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

function toDto(ctx: AppContext, row: JoinedApiKey) {
  return {
    id: row.ulid,
    name: row.name,
    hint: row.token_hint,
    sceneId: row.scene_ulid,
    sceneTitle: row.scene_title,
    revoked: row.revoked_at !== null,
    lastUsedAt: row.last_used_at,
    uses: row.uses,
    createdAt: row.created_at,
    requests: listRequests(ctx.db, row.id, 10).map((request) => ({
      model: request.model,
      status: request.status,
      warning: request.warning,
      durationMs: request.duration_ms,
      at: request.created_at,
    })),
  };
}

export function apiKeyRoutes(ctx: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  app.get("/", (c) => c.json(listApiKeys(ctx.db).map((row) => toDto(ctx, row))));

  app.post("/", async (c) => {
    const input = await body(c);
    const name = typeof input["name"] === "string" ? input["name"].trim().slice(0, 120) : "";
    if (name === "") return c.json(badRequest("A key needs a name."), 400);

    let sceneId: number | null = null;
    if (typeof input["sceneId"] === "string" && input["sceneId"] !== "") {
      const scene = findScene(ctx.db, input["sceneId"]);
      if (scene === null) return c.json(notFound("roleplay"), 404);
      sceneId = scene.id;
    }

    const { row, token } = insertApiKey(ctx.db, { name, sceneId });
    // The only time this is ever returned: the column holds a hash, and there
    // is no path in this app that can produce the plaintext again.
    return c.json({ ...toDto(ctx, row), token }, 201);
  });

  app.post("/:keyId/revoke", (c) => {
    const row = findApiKey(ctx.db, c.req.param("keyId"));
    if (row === null) return c.json(notFound("key"), 404);
    revokeApiKey(ctx.db, row.id);
    return c.json(toDto(ctx, findApiKey(ctx.db, row.ulid)!));
  });

  app.delete("/:keyId", (c) => {
    const row = findApiKey(ctx.db, c.req.param("keyId"));
    if (row === null) return c.json(notFound("key"), 404);
    deleteApiKey(ctx.db, row.id);
    return c.body(null, 204);
  });

  return app;
}

/**
 * Switching the API on for one roleplay, and giving it the slug a model id
 * addresses it by.
 *
 * The slug is derived from the title on the way on rather than asked for: it is
 * a name typed into somebody else's config file, and the one thing it must be
 * is stable and safe after a slash. It is kept when the API is switched off
 * again, so switching it back on does not silently change every client's model
 * id.
 */
export function sceneApiRoutes(ctx: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  app.patch("/:sceneId", async (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) return c.json(notFound("roleplay"), 404);
    const input = await body(c);

    if (typeof input["enabled"] === "boolean") {
      if (input["enabled"] && scene.api_slug === null) {
        assignSlug(ctx, scene.id, scene.title);
      }
      ctx.db
        .query("UPDATE scenes SET api_enabled = $on, updated_at = $now WHERE id = $id")
        .run({ id: scene.id, on: input["enabled"] ? 1 : 0, now: Date.now() });
    }

    const mode = input["historyMode"];
    if (mode === "last_message" || mode === "sync" || mode === "stateless") {
      ctx.db
        .query("UPDATE scenes SET api_history_mode = $mode, updated_at = $now WHERE id = $id")
        .run({ id: scene.id, mode, now: Date.now() });
    }

    const row = findScene(ctx.db, scene.ulid)!;
    return c.json({
      enabled: row.api_enabled === 1,
      historyMode: row.api_history_mode,
      slug: row.api_slug,
      modelId: row.api_slug === null ? null : `scene/${row.api_slug}`,
    });
  });

  return app;
}

function assignSlug(ctx: AppContext, sceneId: number, title: string): void {
  const base = slugify(title);
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const taken = ctx.db
      .query("SELECT 1 AS hit FROM scenes WHERE api_slug = $slug")
      .get({ slug: candidate }) as { hit: number } | null;
    if (taken !== null) continue;
    ctx.db
      .query("UPDATE scenes SET api_slug = $slug WHERE id = $id")
      .run({ id: sceneId, slug: candidate });
    return;
  }
}
