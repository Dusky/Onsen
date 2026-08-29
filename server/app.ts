import { Hono } from "hono";
import type { AppContext, AppEnv } from "./context.ts";
import { sessionMiddleware } from "./middleware/session.ts";
import { authRoutes } from "./routes/auth.ts";
import { setupRoutes } from "./routes/setup.ts";
import { connectionRoutes } from "./routes/connections.ts";
import { spaStatic } from "./static.ts";

export interface CreateAppOptions {
  /** Off in tests, where there is no built client to serve. */
  serveClient?: boolean;
}

export function createApp(ctx: AppContext, options: CreateAppOptions = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", sessionMiddleware(ctx));

  const api = new Hono<AppEnv>();
  api.get("/health", (c) => c.json({ ok: true }));
  api.route("/", authRoutes(ctx));
  api.route("/", setupRoutes(ctx));
  api.route("/connections", connectionRoutes(ctx));

  // An unknown API path is an API error, not the SPA shell — returning HTML
  // from a fetch is the kind of thing that costs an hour to diagnose.
  api.all("*", (c) =>
    c.json({ error: { code: "not_found", message: `No route for ${c.req.path}` } }, 404),
  );

  app.route("/api", api);

  if (options.serveClient !== false) {
    app.use("*", spaStatic(ctx.config.clientDir));
  }

  return app;
}
