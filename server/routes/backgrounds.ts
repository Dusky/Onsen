import { join } from "node:path";
import { unlinkSync } from "node:fs";
import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import { getSetting, setSetting, SettingKey } from "../db/queries/settings.ts";
import {
  deleteBackground,
  findBackground,
  insertBackground,
  listBackgrounds,
  setDefaultBackground,
} from "../db/queries/backgrounds.ts";
import { ulid } from "../lib/ulid.ts";
import type { MediaRunner } from "../media/runner.ts";

/**
 * The background library (SPEC §12, §20 phase 108).
 *
 * A generated backdrop, held as a library: the default — the one shown when no
 * scene is open or the scene has none — is one row, and every generated image
 * is another the reader can pick from. The opacity is an app setting, so the
 * chrome can sit over the picture without hiding it.
 */

function opacityOf(ctx: AppContext): number {
  const raw = getSetting(ctx.db, SettingKey.backgroundOpacity);
  const parsed = raw === null ? 0.55 : Number(raw);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0.55;
}

function toDto(row: { ulid: string; prompt: string | null; is_default: number; created_at: number }) {
  return {
    id: row.ulid,
    prompt: row.prompt,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
  };
}

export function backgroundRoutes(ctx: AppContext, media: MediaRunner | null): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  app.get("/", (c) => {
    const rows = listBackgrounds(ctx.db);
    return c.json({
      backgrounds: rows.map(toDto),
      defaultId: rows.find((row) => row.is_default === 1)?.ulid ?? null,
      opacity: opacityOf(ctx),
    });
  });

  app.patch("/", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { opacity?: unknown } | null;
    if (body !== null && typeof body.opacity === "number" && Number.isFinite(body.opacity)) {
      setSetting(ctx.db, SettingKey.backgroundOpacity, String(Math.min(1, Math.max(0, body.opacity))));
    }
    const rows = listBackgrounds(ctx.db);
    return c.json({
      backgrounds: rows.map(toDto),
      defaultId: rows.find((row) => row.is_default === 1)?.ulid ?? null,
      opacity: opacityOf(ctx),
    });
  });

  /** Draw a background, file it, and add it to the library. */
  app.post("/generate", async (c) => {
    if (media === null) return c.json(badRequest("Picture services are not available."), 400);
    const body = (await c.req.json().catch(() => null)) as { prompt?: unknown } | null;
    const prompt = typeof body?.prompt === "string" && body.prompt.trim() !== "" ? body.prompt.trim() : "An anime-style onsen at dusk, no characters.";
    let drawn;
    try {
      drawn = await media.drawImage({ prompt });
    } catch (caught) {
      return c.json({ error: { code: "service_failed", message: caught instanceof Error ? caught.message : "The picture service failed." } }, 502);
    }
    const extension = drawn.mime.split("/")[1] ?? "png";
    const path = `${ulid()}.${extension}`;
    await Bun.write(join(ctx.config.dataDir, "backgrounds", path), drawn.bytes);
    const row = insertBackground(ctx.db, { path, prompt });
    const rows = listBackgrounds(ctx.db);
    return c.json(
      { background: toDto(row), backgrounds: rows.map(toDto), defaultId: rows.find((r) => r.is_default === 1)?.ulid ?? null },
      201,
    );
  });

  app.post("/:id/default", (c) => {
    const row = findBackground(ctx.db, c.req.param("id"));
    if (row === null) return c.json(notFound("background"), 404);
    setDefaultBackground(ctx.db, row.id);
    const rows = listBackgrounds(ctx.db);
    return c.json({
      backgrounds: rows.map(toDto),
      defaultId: rows.find((r) => r.is_default === 1)?.ulid ?? null,
    });
  });

  app.delete("/:id", (c) => {
    const row = findBackground(ctx.db, c.req.param("id"));
    if (row === null) return c.json(notFound("background"), 404);
    if (row.is_default === 1) {
      return c.json(badRequest("The default background cannot be deleted. Make another the default first."), 400);
    }
    deleteBackground(ctx.db, row.id);
    try {
      unlinkSync(join(ctx.config.dataDir, "backgrounds", row.path));
    } catch {
      /* Already gone. */
    }
    return c.body(null, 204);
  });

  app.get("/:id/image", async (c) => {
    const row = findBackground(ctx.db, c.req.param("id"));
    if (row === null) return c.json(notFound("background"), 404);
    const file = Bun.file(join(ctx.config.dataDir, "backgrounds", row.path));
    if (!(await file.exists())) return c.json(notFound("background"), 404);
    c.header("Cache-Control", "no-cache");
    return c.body(file.stream(), 200, { "Content-Type": file.type });
  });

  return app;
}

function notFound(thing: string) {
  return { error: { code: "not_found", message: `No such ${thing}.` } };
}

function badRequest(message: string) {
  return { error: { code: "bad_request", message } };
}
