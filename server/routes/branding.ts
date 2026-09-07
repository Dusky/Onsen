import { join } from "node:path";
import { unlinkSync } from "node:fs";
import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { getSetting, setSetting, SettingKey } from "../db/queries/settings.ts";
import { requireAuth } from "../middleware/session.ts";
import { ulid } from "../lib/ulid.ts";

/**
 * The app mark (SPEC §16, §20 phase 94).
 *
 * The logo ships as a built-in file and can be replaced by an upload or turned
 * off, from Settings → Branding. The uploaded file lives in `brandingDir` like
 * every other user file; the show/hide is an `app_settings` row. The built-in
 * stays a static asset (`/logo.png`), so this route only serves the upload.
 */

const MAX_LOGO_BYTES = 8 * 1024 * 1024;

/** Where the uploaded mark is, or null when the built-in is in use. */
function customLogoPath(ctx: AppContext): string | null {
  const name = getSetting(ctx.db, SettingKey.brandingLogoPath);
  return name === null ? null : join(ctx.config.brandingDir, name);
}

function showLogo(ctx: AppContext): boolean {
  return getSetting(ctx.db, SettingKey.brandingShowLogo) !== "0";
}

function extensionOf(name: string): string {
  const match = /\.[a-zA-Z0-9]+$/.exec(name);
  return match === null ? "" : match[0]!.toLowerCase();
}

export function brandingRoutes(ctx: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  app.get("/", (c) => {
    const custom = getSetting(ctx.db, SettingKey.brandingLogoPath) !== null;
    return c.json({
      showLogo: showLogo(ctx),
      isCustom: custom,
      // `no-store` on the upload keeps a replacement from showing the old bytes;
      // the built-in is a normal static asset.
      logoUrl: custom ? "/branding/logo" : "/logo.png",
    });
  });

  app.patch("/", async (c) => {
    let body: { showLogo?: unknown };
    try {
      body = (await c.req.json()) as { showLogo?: unknown };
    } catch {
      return c.json({ error: { code: "bad_request", message: "Expected a JSON body." } }, 400);
    }
    if (typeof body.showLogo === "boolean") {
      setSetting(ctx.db, SettingKey.brandingShowLogo, body.showLogo ? "1" : "0");
    }
    const custom = getSetting(ctx.db, SettingKey.brandingLogoPath) !== null;
    return c.json({
      showLogo: showLogo(ctx),
      isCustom: custom,
      logoUrl: custom ? "/branding/logo" : "/logo.png",
    });
  });

  /** Serve the uploaded mark. Absent without one; the built-in is `/logo.png`. */
  app.get("/logo", async (c) => {
    const path = customLogoPath(ctx);
    if (path === null) {
      return c.json({ error: { code: "not_found", message: "No uploaded mark." } }, 404);
    }
    const file = Bun.file(path);
    if (!(await file.exists())) {
      return c.json({ error: { code: "not_found", message: "No such file." } }, 404);
    }
    c.header("Cache-Control", "no-store");
    return c.body(file.stream(), 200, { "Content-Type": file.type });
  });

  /** Replace the mark with an upload. */
  app.post("/logo", async (c) => {
    let file: File | null = null;
    try {
      const form = await c.req.formData();
      const candidate = form.get("file");
      if (candidate instanceof File) file = candidate;
    } catch {
      return c.json({ error: { code: "bad_request", message: "Expected a file upload." } }, 400);
    }
    if (file === null) {
      return c.json({ error: { code: "bad_request", message: "No image was uploaded." } }, 400);
    }
    if (file.size === 0 || file.size > MAX_LOGO_BYTES) {
      return c.json({ error: { code: "too_large", message: "That image is too large." } }, 413);
    }
    if (!file.type.startsWith("image/")) {
      return c.json({ error: { code: "bad_request", message: "That is not an image." } }, 400);
    }

    // A fresh name on every upload, so the old one can be swept once the new
    // bytes are safely on disk.
    const name = `${ulid()}${extensionOf(file.name) || ".png"}`;
    await Bun.write(join(ctx.config.brandingDir, name), new Uint8Array(await file.arrayBuffer()));

    const previous = customLogoPath(ctx);
    setSetting(ctx.db, SettingKey.brandingLogoPath, name);
    if (previous !== null) {
      try {
        unlinkSync(previous);
      } catch {
        /* Already gone, or the first upload. */
      }
    }

    return c.json({
      showLogo: showLogo(ctx),
      isCustom: true,
      logoUrl: "/branding/logo",
    });
  });

  /** Put the built-in mark back. */
  app.delete("/logo", (c) => {
    const path = customLogoPath(ctx);
    if (path !== null) {
      try {
        unlinkSync(path);
      } catch {
        /* Already gone. */
      }
    }
    setSetting(ctx.db, SettingKey.brandingLogoPath, "");
    return c.json({ showLogo: showLogo(ctx), isCustom: false, logoUrl: "/logo.png" });
  });

  return app;
}
