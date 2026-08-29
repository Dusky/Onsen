import { afterEach, describe, expect, test } from "bun:test";
import { createHarness, completeSetup, VALID_SETUP, type TestHarness } from "./helpers.ts";
import type { BootstrapDto } from "../shared/types.ts";
import { SESSION_COOKIE } from "../server/middleware/session.ts";
import { bumpSessionGeneration } from "../server/db/queries/settings.ts";

let harness: TestHarness | null = null;
function h(): TestHarness {
  harness ??= createHarness();
  return harness;
}
afterEach(() => {
  harness?.cleanup();
  harness = null;
});

function login(t: TestHarness, password: string): Promise<Response> {
  return t.fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

describe("auth", () => {
  test("login before setup is a conflict, not an invalid password", async () => {
    const response = await login(h(), "anything at all");
    expect(response.status).toBe(409);
  });

  test("issues an HttpOnly, SameSite=Lax, long-lived session cookie", async () => {
    const t = h();
    await completeSetup(t);
    t.cookie = null;

    const response = await login(t, VALID_SETUP.password);
    expect(response.status).toBe(200);

    const raw = response.headers.get("set-cookie") ?? "";
    expect(raw).toContain(`${SESSION_COOKIE}=`);
    expect(raw).toContain("HttpOnly");
    expect(raw).toContain("SameSite=Lax");
    expect(raw).toContain("Path=/");
    // Thirty days: being signed out weekly on a self-hosted single-user app
    // would be a bug, not a security posture.
    expect(raw).toContain("Max-Age=2592000");
    // Secure is opt-in, because the default deployment is plain HTTP behind a
    // tunnel and a Secure cookie would never be sent.
    expect(raw).not.toContain("Secure");
  });

  test("rejects a wrong password and an empty one", async () => {
    const t = h();
    await completeSetup(t);
    t.cookie = null;

    expect((await login(t, "wrong password")).status).toBe(401);
    expect((await login(t, "")).status).toBe(401);

    const boot = (await (await t.fetch("/api/bootstrap")).json()) as BootstrapDto;
    expect(boot.authenticated).toBe(false);
  });

  test("guards the API behind the session", async () => {
    const t = h();
    await completeSetup(t);

    expect((await t.fetch("/api/connections/profiles")).status).toBe(200);

    t.cookie = null;
    const denied = await t.fetch("/api/connections/profiles");
    expect(denied.status).toBe(401);
    expect((await denied.json()).error.code).toBe("unauthorized");
  });

  test("logout clears the cookie", async () => {
    const t = h();
    await completeSetup(t);

    const response = await t.fetch("/api/auth/logout", { method: "POST" });
    expect(response.headers.get("set-cookie") ?? "").toContain("Max-Age=0");

    t.cookie = null;
    expect((await t.fetch("/api/connections/profiles")).status).toBe(401);
  });

  test("rejects a forged cookie", async () => {
    const t = h();
    await completeSetup(t);
    t.cookie = `${SESSION_COOKIE}=eyJpYXQiOjEsImV4cCI6OTk5OTk5OTk5OTk5OSwiZ2VuIjoxfQ.forgedsignature`;
    expect((await t.fetch("/api/connections/profiles")).status).toBe(401);
  });

  test("bumping the session generation invalidates existing cookies", async () => {
    const t = h();
    await completeSetup(t);
    expect((await t.fetch("/api/connections/profiles")).status).toBe(200);

    // This is what a password change will do — revocation without a session table.
    bumpSessionGeneration(t.ctx.db);
    expect((await t.fetch("/api/connections/profiles")).status).toBe(401);
  });

  test("rate-limits repeated failed logins", async () => {
    const t = h();
    await completeSetup(t);
    t.cookie = null;

    let sawLimit = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      const response = await login(t, "wrong password");
      if (response.status === 429) {
        sawLimit = true;
        expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
        expect((await response.json()).error.retryAfter).toBeGreaterThan(0);
        break;
      }
    }
    expect(sawLimit).toBe(true);
  });

  test("a correct password clears the penalty so a typo does not lock you out", async () => {
    const t = h();
    await completeSetup(t);
    t.cookie = null;

    for (let attempt = 0; attempt < 8; attempt++) await login(t, "wrong password");
    const good = await login(t, VALID_SETUP.password);
    expect(good.status).toBe(200);

    // The counter was reset, so there is fresh headroom rather than an
    // immediate 429.
    expect((await login(t, "wrong password")).status).toBe(401);
  });
});

describe("api surface", () => {
  test("an unknown API path returns JSON, not the SPA shell", async () => {
    const response = await h().fetch("/api/nope");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect((await response.json()).error.code).toBe("not_found");
  });

  test("health needs no session", async () => {
    const response = await h().fetch("/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
