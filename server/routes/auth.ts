import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { clearSession, isAuthenticated, issueSession, requireAuth } from "../middleware/session.ts";
import { createRateLimiter } from "../middleware/rate-limit.ts";
import { activeTheme } from "../db/queries/themes.ts";
import {
  SettingKey,
  bumpSessionGeneration,
  getSetting,
  isSetupCompleted,
  setSetting,
} from "../db/queries/settings.ts";
import { badRequest } from "../lib/routes.ts";
import { MIN_PASSWORD_LENGTH } from "../../shared/types.ts";
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
    const theme = activeTheme(ctx.db);
    const body: BootstrapDto = {
      setupCompleted: isSetupCompleted(ctx.db),
      authenticated: isAuthenticated(c, ctx),
      themeBase: theme?.base ?? null,
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

  /**
   * Changing the password, and the only way to revoke a session (SPEC §17).
   *
   * The revocation half already existed and had no caller.
   * `bumpSessionGeneration` was referenced nowhere, while `verifySessionToken`
   * has always rejected a token whose `gen` differs from the stored one — so
   * the machinery to invalidate every outstanding cookie at once was complete,
   * wired up, and unreachable. Logging out only clears the browser's own
   * cookie; a token copied off a shared machine stayed valid for its full
   * 30-day TTL with nothing an operator could do about it.
   *
   * So this route is the password change *and* the revocation, which is the
   * right pairing: the moment you would want to change the password is the
   * moment you want everything else signed out.
   *
   * Its own rate limiter rather than the login one, on a separate scope. The
   * threat is different — someone who already holds a session guessing the
   * password to take the install over — and sharing the bucket would let a
   * successful change reset the login limiter as a side effect.
   */
  const changeLimiter = createRateLimiter({
    scope: "password",
    limit: 10,
    windowMs: 5 * 60 * 1000,
  });

  app.post("/auth/password", requireAuth(), changeLimiter.middleware, async (c) => {
    const hash = getSetting(ctx.db, SettingKey.passwordHash);
    if (hash === null) {
      return c.json(
        { error: { code: "setup_required", message: "This install has not been set up yet." } },
        409,
      );
    }

    let body: { current?: unknown; next?: unknown };
    try {
      body = (await c.req.json()) as { current?: unknown; next?: unknown };
    } catch {
      return c.json(badRequest("Expected a JSON body."), 400);
    }

    const current = typeof body.current === "string" ? body.current : "";
    const next = typeof body.next === "string" ? body.next : "";
    if (next.length < MIN_PASSWORD_LENGTH) {
      return c.json(
        badRequest(`A password needs at least ${MIN_PASSWORD_LENGTH} characters.`),
        400,
      );
    }

    // Verified even when the field was missing, so a malformed request costs
    // the same time as a wrong password — the same reason login does it.
    if (!(await Bun.password.verify(current, hash))) {
      return c.json(
        { error: { code: "invalid_password", message: "Incorrect password." } },
        401,
      );
    }

    // Hashing is async and slow by design, so it happens before the
    // transaction rather than holding a write lock open across it — the note
    // `setup.ts` leaves at its own hash call.
    const nextHash = await Bun.password.hash(next);
    ctx.db.transaction(() => {
      setSetting(ctx.db, SettingKey.passwordHash, nextHash);
      bumpSessionGeneration(ctx.db);
    })();

    changeLimiter.reset(changeLimiter.keyFor(c.req.raw));
    // Every cookie in the world is now stale, this one included. Re-issuing at
    // the new generation keeps the person who just changed it signed in, which
    // is the difference between a password change and a lockout.
    issueSession(c, ctx);
    return c.json({ ok: true });
  });

  return app;
}
