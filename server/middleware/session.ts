import type { MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { issueSessionToken, verifySessionToken } from "../lib/crypto.ts";
import { getSessionGeneration } from "../db/queries/settings.ts";

export const SESSION_COOKIE = "onsen_session";

/**
 * "Long-lived" per SPEC §17 — this is a single-user self-hosted app opened from
 * a phone, and being logged out weekly would be a bug, not a security posture.
 * Revocation is by generation counter, not expiry.
 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function issueSession(c: Context<AppEnv>, ctx: AppContext): void {
  const now = Date.now();
  const token = issueSessionToken(ctx.keyring, {
    iat: now,
    exp: now + SESSION_TTL_MS,
    gen: getSessionGeneration(ctx.db),
  });
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    secure: ctx.config.secureCookies,
  });
}

export function clearSession(c: Context<AppEnv>, ctx: AppContext): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: ctx.config.secureCookies });
}

export function isAuthenticated(c: Context<AppEnv>, ctx: AppContext): boolean {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return false;
  return verifySessionToken(ctx.keyring, token, getSessionGeneration(ctx.db)) !== null;
}

/** Populates `authenticated` for every request without rejecting anything. */
export function sessionMiddleware(ctx: AppContext): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set("authenticated", isAuthenticated(c, ctx));
    await next();
  };
}

/** Guards everything that is not bootstrap, setup, or login. */
export function requireAuth(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!c.get("authenticated")) {
      return c.json({ error: { code: "unauthorized", message: "Sign in to continue." } }, 401);
    }
    await next();
  };
}
