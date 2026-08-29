import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import { isInjectionRole } from "../../shared/types.ts";
import { opKind } from "../tasks/registry.ts";
import {
  listTaskRuns,
  listTasks,
  toTaskDto,
  toTaskRunDto,
  updateTask,
} from "../db/queries/tasks.ts";
import type { UpdateTaskRequest } from "../../shared/types.ts";

/**
 * Background tasks over HTTP (SPEC §7).
 *
 * The run log is the reason this exists as much as the configuration is. A
 * background task must never fail a user-facing generation, so every failure it
 * has is swallowed on purpose — and a swallowed failure that cannot be read
 * anywhere is indistinguishable from the feature quietly not working.
 */
export function taskRoutes(ctx: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  function profileUlid(id: number | null): string | null {
    if (id === null) return null;
    const row = ctx.db
      .query("SELECT ulid FROM connection_profiles WHERE id = $id")
      .get({ id }) as { ulid: string } | null;
    return row?.ulid ?? null;
  }

  app.get("/", (c) =>
    c.json(listTasks(ctx.db).map((row) => toTaskDto(row, profileUlid(row.connection_profile_id)))),
  );

  app.patch("/:key", async (c) => {
    const kind = opKind(c.req.param("key"));
    if (kind === null) {
      return c.json({ error: { code: "not_found", message: "No such task." } }, 404);
    }

    let body: UpdateTaskRequest = {};
    try {
      const parsed: unknown = await c.req.json();
      if (typeof parsed === "object" && parsed !== null) body = parsed as UpdateTaskRequest;
    } catch {
      return c.json({ error: { code: "bad_request", message: "Expected a JSON body." } }, 400);
    }

    const patch: Parameters<typeof updateTask>[2] = {};
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") {
        return c.json({ error: { code: "bad_request", message: "enabled must be a boolean." } }, 400);
      }
      patch.enabled = body.enabled;
    }
    if ("connectionProfileId" in body) {
      if (body.connectionProfileId === null) {
        patch.connectionProfileId = null;
      } else {
        const row = ctx.db
          .query("SELECT id FROM connection_profiles WHERE ulid = $ulid")
          .get({ ulid: body.connectionProfileId }) as { id: number } | null;
        if (row === null) {
          return c.json(
            { error: { code: "bad_request", message: "No such connection profile." } },
            400,
          );
        }
        patch.connectionProfileId = row.id;
      }
    }
    if (body.injectionRole !== undefined) {
      if (!isInjectionRole(body.injectionRole)) {
        return c.json(
          { error: { code: "bad_request", message: "Unknown injection role." } },
          400,
        );
      }
      patch.injectionRole = body.injectionRole;
    }
    if (body.autoTrigger !== undefined) {
      if (typeof body.autoTrigger !== "boolean") {
        return c.json(
          { error: { code: "bad_request", message: "autoTrigger must be a boolean." } },
          400,
        );
      }
      patch.autoTrigger = body.autoTrigger;
    }
    if (body.buttonVisible !== undefined) {
      if (typeof body.buttonVisible !== "boolean") {
        return c.json(
          { error: { code: "bad_request", message: "buttonVisible must be a boolean." } },
          400,
        );
      }
      patch.buttonVisible = body.buttonVisible;
    }
    if ("promptTemplate" in body) {
      const template = body.promptTemplate;
      if (template !== null && typeof template !== "string") {
        return c.json(
          { error: { code: "bad_request", message: "The prompt must be text, or nothing." } },
          400,
        );
      }
      // An empty override is not an empty prompt: it means the built-in.
      patch.promptTemplate = template === null || template.trim() === "" ? null : template;
    }

    const row = updateTask(ctx.db, kind, patch);
    return c.json(toTaskDto(row, profileUlid(row.connection_profile_id)));
  });

  /** What this task has actually been doing, most recent first. */
  app.get("/:key/runs", (c) => {
    const kind = opKind(c.req.param("key"));
    if (kind === null) {
      return c.json({ error: { code: "not_found", message: "No such task." } }, 404);
    }
    const sceneUlids = new Map(
      (ctx.db.query("SELECT id, ulid FROM scenes").all() as { id: number; ulid: string }[]).map(
        (row) => [row.id, row.ulid],
      ),
    );
    return c.json(
      listTaskRuns(ctx.db, kind.key).map((row) =>
        toTaskRunDto(row, row.scene_id === null ? null : (sceneUlids.get(row.scene_id) ?? null)),
      ),
    );
  });

  return app;
}
