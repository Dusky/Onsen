import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import { deleteSavedFilter, insertSavedFilter, listSavedFilters } from "../db/queries/library.ts";
import type { CharacterFilterQuery } from "../../shared/types.ts";

/**
 * Saved filters (SPEC §9, §20 phase 26): a name over a query the reader wants
 * back. No sharing, no ranking, no folders of folders — the spec asks for a
 * way to keep "my sci-fi cast" reachable, and that is a table with three
 * columns.
 */

function badRequest(message: string) {
  return { error: { code: "bad_request", message } } as const;
}

export function filterRoutes(ctx: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  app.get("/", (c) => c.json(listSavedFilters(ctx.db)));

  app.post("/", async (c) => {
    let body: { name?: unknown; query?: unknown };
    try {
      body = (await c.req.json()) as { name?: unknown; query?: unknown };
    } catch {
      return c.json(badRequest("Expected a JSON body."), 400);
    }
    if (typeof body.name !== "string" || body.name.trim() === "") {
      return c.json(badRequest("A filter needs a name."), 400);
    }
    const query: CharacterFilterQuery =
      typeof body.query === "object" && body.query !== null
        ? (body.query as CharacterFilterQuery)
        : {};
    return c.json(insertSavedFilter(ctx.db, body.name.trim(), query), 201);
  });

  app.delete("/:filterId", (c) => {
    if (!deleteSavedFilter(ctx.db, c.req.param("filterId"))) {
      return c.json({ error: { code: "not_found", message: "No such filter." } }, 404);
    }
    return c.body(null, 204);
  });

  return app;
}
