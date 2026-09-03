import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import { findScene } from "../db/queries/history.ts";
import {
  deleteEntity,
  editEntity,
  findEntity,
  listEntities,
  listRelations,
  turnsSince,
  type MemoryEntityRow,
} from "../db/queries/memory.ts";
import { isMemoryKind } from "../../shared/types.ts";
import type { MemoryRunner } from "../memory/runner.ts";

/**
 * Narrative memory's HTTP surface (SPEC §11 layer 3).
 *
 * Everything here is about making the graph visible and editable, which is what
 * §11 means by "user edits are sticky": the rule is only worth having if there
 * is somewhere to edit. Extraction can also be asked for by hand — a scene that
 * has just been switched on has nothing in it, and waiting a turn to find out
 * whether the feature works is a poor first impression.
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

export function memoryRoutes(ctx: AppContext, memory: MemoryRunner): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  app.get("/scenes/:sceneId", (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) return c.json(notFound("roleplay"), 404);

    const entities = listEntities(ctx.db, scene.id);
    const relations = listRelations(ctx.db, scene.id);
    const nameById = new Map(entities.map((entity) => [entity.id, entity.name]));

    const toDto = (entity: MemoryEntityRow) => ({
      id: entity.ulid,
      kind: entity.kind,
      name: entity.name,
      content: entity.content,
      salience: entity.salience,
      turnsSince: turnsSince(ctx.db, scene.id, entity.last_seen_message_id),
      userEdited: entity.user_edited === 1,
      links: relations
        .filter((r) => r.from_entity_id === entity.id || r.to_entity_id === entity.id)
        .map((r) => {
          const from = nameById.get(r.from_entity_id) ?? "something";
          const to = nameById.get(r.to_entity_id) ?? "something";
          return `${from} ${r.kind} ${to}`;
        }),
      updatedAt: entity.updated_at,
    });

    return c.json({ enabled: scene.memory_enabled === 1, entities: entities.map(toDto) });
  });

  /** Switch it on for a roleplay. §11: off by default. */
  app.patch("/scenes/:sceneId", async (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) return c.json(notFound("roleplay"), 404);
    const input = await body(c);
    if (typeof input["enabled"] === "boolean") {
      ctx.db
        .query("UPDATE scenes SET memory_enabled = $on, updated_at = $now WHERE id = $id")
        .run({ id: scene.id, on: input["enabled"] ? 1 : 0, now: Date.now() });
    }
    const row = findScene(ctx.db, scene.ulid)!;
    return c.json({ enabled: row.memory_enabled === 1 });
  });

  /**
   * Read the recent turns now.
   *
   * Awaited, unlike the automatic path: this one the reader pressed a button
   * for, and a button that returns before it has done anything is a button that
   * appears not to work.
   */
  app.post("/scenes/:sceneId/extract", async (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) return c.json(notFound("roleplay"), 404);
    if (scene.memory_enabled !== 1) {
      return c.json(badRequest("Switch memory on for this roleplay first."), 400);
    }
    await memory.extract(scene);
    return c.json({ entities: listEntities(ctx.db, scene.id).length });
  });

  app.patch("/entities/:entityId", async (c) => {
    const entity = findEntity(ctx.db, c.req.param("entityId"));
    if (entity === null) return c.json(notFound("entity"), 404);
    const input = await body(c);

    const patch: Parameters<typeof editEntity>[2] = {};
    if (typeof input["name"] === "string" && input["name"].trim() !== "") {
      patch.name = input["name"].trim().slice(0, 120);
    }
    if (typeof input["content"] === "string") patch.content = input["content"].slice(0, 2_000);
    if (isMemoryKind(input["kind"])) patch.kind = input["kind"];
    if (typeof input["salience"] === "number" && Number.isFinite(input["salience"])) {
      patch.salience = input["salience"];
    }

    // Editing is what protects it — there is no separate flag to set, because a
    // route that had to remember to set one eventually would not.
    editEntity(ctx.db, entity.id, patch);
    return c.json({ ok: true });
  });

  app.delete("/entities/:entityId", (c) => {
    const entity = findEntity(ctx.db, c.req.param("entityId"));
    if (entity === null) return c.json(notFound("entity"), 404);
    deleteEntity(ctx.db, entity.id);
    return c.body(null, 204);
  });

  return app;
}
