import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import { applyUpdate, checkForUpdates, readUpdateStatus } from "../updates.ts";
import { getSetting, setSetting } from "../db/queries/settings.ts";

/**
 * System endpoints (SPEC §17). The updater's logic lives in `server/updates.ts`;
 * these routes only carry it, so the failure modes arrive as they were decided
 * there: a refusal is a 409 with the reason, never a silently degraded 200.
 */

export function systemRoutes(ctx: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  const repoDir = ctx.config.repoDir;

  // Local facts only — no network, so the settings screen can ask on load.
  /**
   * Reading preferences (SPEC §5, §16).
   *
   * Server-side because there is no browser storage in this app (HANDOFF
   * non-negotiable 8) — and because a preference that lived in one browser
   * would be the wrong shape for a §5 feature anyway: the point of head sync is
   * that the phone and the desktop are two views of one install.
   */
  app.get("/preferences", (c) =>
    c.json({ completionChime: getSetting(ctx.db, "completion_chime") === "1" }),
  );

  app.patch("/preferences", async (c) => {
    let body: Record<string, unknown> = {};
    try {
      const parsed: unknown = await c.req.json();
      if (typeof parsed === "object" && parsed !== null) body = parsed as Record<string, unknown>;
    } catch {
      /* An empty body changes nothing. */
    }
    if (typeof body["completionChime"] === "boolean") {
      setSetting(ctx.db, "completion_chime", body["completionChime"] ? "1" : "0");
    }
    return c.json({ completionChime: getSetting(ctx.db, "completion_chime") === "1" });
  });

  app.get("/update", async (c) => c.json(await readUpdateStatus(repoDir)));

  // Fetches the remote, then reports against it. Network failures are a field,
  // not a status code: the local half of the answer is still true.
  app.post("/update/check", async (c) => c.json(await checkForUpdates(repoDir)));

  app.post("/update/apply", async (c) => {
    const result = await applyUpdate(repoDir);
    if (!result.applied) {
      return c.json({ error: { code: "update_refused", message: result.message } }, 409);
    }
    return c.json(result.status);
  });

  return app;
}
