/**
 * Themes (SPEC §20 phase 45).
 *
 * The one endpoint that is not JSON is `GET /themes/active.css`, which is what
 * the client puts in a `<style>` element. Serving it as CSS rather than as a
 * string in the state means the browser caches and parses it as CSS, and means
 * the app's colours do not depend on React having rendered.
 */
import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import {
  activeTheme,
  deleteTheme,
  findTheme,
  insertTheme,
  listThemes,
  setActiveTheme,
  toThemeDto,
  updateTheme,
} from "../db/queries/themes.ts";
import { cssConcerns, safeTokens, themeCss } from "../themes/index.ts";
import type { ThemeDto, ThemeImportDto } from "../../shared/types.ts";

const MAX_CSS = 64 * 1024;
const MAX_NAME = 60;

function badRequest(message: string) {
  return { error: { code: "bad_request", message } };
}
function notFound() {
  return { error: { code: "not_found", message: "No such theme." } };
}

function asTokens(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export function themeRoutes(ctx: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /**
   * The active theme's stylesheet.
   *
   * Outside the auth wall on purpose: it is the login screen's colours too, and
   * it discloses nothing but the reader's own taste.
   */
  app.get("/active.css", (c) => {
    const row = activeTheme(ctx.db);
    c.header("Content-Type", "text/css; charset=utf-8");
    // Never cached: a theme edit has to be one reload, not one reload plus a
    // hard refresh.
    c.header("Cache-Control", "no-store");
    return c.body(row === null ? "" : themeCss(toThemeDto(row)));
  });

  app.use("*", requireAuth());

  app.get("/", (c) => {
    const active = activeTheme(ctx.db);
    return c.json({
      themes: listThemes(ctx.db).map(toThemeDto),
      activeId: active === null ? null : active.ulid,
    });
  });

  app.post("/", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = typeof body["name"] === "string" ? body["name"].trim() : "";
    if (name === "" || name.length > MAX_NAME) return c.json(badRequest("Name it."), 400);

    // Deriving from a shipped theme is how you edit one: the original stays
    // where it is, and the copy is yours.
    const from = typeof body["from"] === "string" ? findTheme(ctx.db, body["from"]) : null;
    const base = from?.base ?? (body["base"] === "light" ? "light" : "dark");
    const tokens = from === null ? asTokens(body["tokens"]) : toThemeDto(from).tokens;

    try {
      const row = insertTheme(ctx.db, { name, base, tokens, customCss: from?.custom_css ?? "" });
      return c.json(toThemeDto(row), 201);
    } catch {
      return c.json(badRequest("A theme already has that name."), 409);
    }
  });

  app.patch("/:themeId", async (c) => {
    const row = findTheme(ctx.db, c.req.param("themeId"));
    if (row === null) return c.json(notFound(), 404);
    if (row.is_builtin === 1) {
      return c.json(badRequest("A shipped theme cannot be changed. Duplicate it first."), 409);
    }

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Parameters<typeof updateTheme>[2] = {};
    if (typeof body["name"] === "string" && body["name"].trim() !== "") {
      patch.name = body["name"].trim().slice(0, MAX_NAME);
    }
    if ("tokens" in body) patch.tokens = asTokens(body["tokens"]);
    if (typeof body["customCss"] === "string") {
      if (body["customCss"].length > MAX_CSS) {
        return c.json(badRequest("That CSS is too long."), 413);
      }
      patch.customCss = body["customCss"];
    }
    // Approving what an import brought: the reader has seen it, so it moves
    // from pending into the stylesheet.
    if (body["approvePendingCss"] === true) {
      patch.customCss = row.custom_css_pending;
      patch.pendingCss = "";
    }
    if (body["discardPendingCss"] === true) patch.pendingCss = "";

    return c.json(toThemeDto(updateTheme(ctx.db, row.id, patch)));
  });

  app.delete("/:themeId", (c) => {
    const row = findTheme(ctx.db, c.req.param("themeId"));
    if (row === null) return c.json(notFound(), 404);
    if (row.is_builtin === 1) return c.json(badRequest("A shipped theme cannot be deleted."), 409);
    deleteTheme(ctx.db, row.id);
    // Deleting the one in force falls back to the default rather than to
    // nothing; `activeTheme` handles that, so there is no pointer to fix here.
    return c.body(null, 204);
  });

  app.post("/:themeId/activate", (c) => {
    const row = findTheme(ctx.db, c.req.param("themeId"));
    if (row === null) return c.json(notFound(), 404);
    setActiveTheme(ctx.db, row.ulid);
    return c.json(toThemeDto(row));
  });

  app.get("/:themeId/export", (c) => {
    const row = findTheme(ctx.db, c.req.param("themeId"));
    if (row === null) return c.json(notFound(), 404);
    const dto = toThemeDto(row);
    const filename = dto.name.replace(/[^\w -]/g, "");
    c.header("Content-Disposition", `attachment; filename="${filename}.json"`);
    return c.json({
      onsenTheme: 1,
      name: dto.name,
      base: dto.base,
      tokens: dto.tokens,
      customCss: dto.customCss,
    });
  });

  /**
   * Import a theme file.
   *
   * The tokens land; the CSS does not. It goes to `pendingCss` with a list of
   * what it could do, and stays inert until the reader approves it — a theme
   * from somebody else is their code, and CSS can reach the network.
   */
  app.post("/import", async (c) => {
    let raw: unknown;
    try {
      const form = await c.req.formData();
      const file = form.get("file");
      raw = JSON.parse(file instanceof File ? await file.text() : String(form.get("theme") ?? ""));
    } catch {
      try {
        raw = await c.req.json();
      } catch {
        return c.json(badRequest("Send a theme file."), 400);
      }
    }

    if (typeof raw !== "object" || raw === null) return c.json(badRequest("Not a theme."), 400);
    const doc = raw as Record<string, unknown>;
    const name = typeof doc["name"] === "string" && doc["name"].trim() !== ""
      ? doc["name"].trim().slice(0, MAX_NAME)
      : "Imported theme";

    const offered = asTokens(doc["tokens"]);
    const kept = safeTokens(offered);
    const dropped = Object.keys(offered).filter((key) => !(key in kept));

    const css = typeof doc["customCss"] === "string" ? doc["customCss"].slice(0, MAX_CSS) : "";

    let unique = name;
    for (let attempt = 2; ; attempt += 1) {
      const clash = ctx.db
        .query("SELECT 1 AS hit FROM themes WHERE name = $name COLLATE NOCASE")
        .get({ name: unique });
      if (clash === null) break;
      unique = `${name} ${attempt}`;
    }

    const row = insertTheme(ctx.db, {
      name: unique,
      base: doc["base"] === "light" ? "light" : "dark",
      tokens: kept,
      pendingCss: css,
    });

    const body: ThemeImportDto = {
      theme: toThemeDto(row) satisfies ThemeDto,
      concerns: css === "" ? [] : cssConcerns(css),
      droppedTokens: dropped,
    };
    return c.json(body, 201);
  });

  return app;
}
