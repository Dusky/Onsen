import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import { seedDemo } from "../demo/seed.ts";

/**
 * Demo content (first run): a cast, a scene, and the author's own user guide in
 * the data bank. Idempotent — running it twice finds what it made and adds
 * nothing twice.
 */
export function demoRoutes(ctx: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  app.post("/seed", async (c) => {
    const result = await seedDemo(ctx.db, ctx.keyring);
    return c.json(result, 201);
  });

  return app;
}
