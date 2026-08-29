import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { clearSession, isAuthenticated, issueSession } from "../middleware/session.ts";
import { createRateLimiter } from "../middleware/rate-limit.ts";
import {
  SettingKey,
  getSetting,
  isSetupCompleted,
} from "../db/queries/settings.ts";
import type { BootstrapDto, LoginRequest } from "../../shared/types.ts";

/**
 * Single-user password auth (SPEC §17). There is no user table and no
 * registration: the setup wizard sets the one password, and that password plus a
 * signed cookie is the whole model. Deployment is expected to be behind
 * Tailscale or a Cloudflare Tunnel, with the password as defence in depth.
 */
export function authRoutes(ctx: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Ten attempts per five minutes is generous for a human at a phone keyboard
  // and useless for guessing an eight-character password.
  const limiter = createRateLimiter({ scope: "login", limit: 10, windowMs: 5 * 60 * 1000 });

  app.get("/bootstrap", (c) => {
    const body: BootstrapDto = {
      setupCompleted: isSetupCompleted(ctx.db),
      authenticated: isAuthenticated(c, ctx),
    };
    return c.json(body);
  });

  app.post("/auth/login", limiter.middleware, async (c) => {
    const hash = getSetting(ctx.db, SettingKey.passwordHash);
    if (hash === null) {
      return c.json(
        { error: { code: "setup_required", message: "This install has not been set up yet." } },
        409,
      );
    }

    let body: Partial<LoginRequest>;
    try {
      body = (await c.req.json()) as Partial<LoginRequest>;
    } catch {
      return c.json({ error: { code: "bad_request", message: "Expected a JSON body." } }, 400);
    }

    const password = typeof body.password === "string" ? body.password : "";
    // Verify even against an empty password so a missing field costs the same
    // time as a wrong one.
    const ok = await Bun.password.verify(password, hash);
    if (!ok) {
      return c.json({ error: { code: "invalid_password", message: "Incorrect password." } }, 401);
    }

    limiter.reset(limiter.keyFor(c.req.raw));
    issueSession(c, ctx);
    return c.json({ ok: true });
  });

  app.post("/auth/logout", (c) => {
    clearSession(c, ctx);
    return c.json({ ok: true });
  });

  return app;
}
