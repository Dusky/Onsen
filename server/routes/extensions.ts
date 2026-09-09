import { Hono } from "hono";
import { rmSync } from "node:fs";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import { loadInstalledExtensions } from "../extensions/install.ts";
import { unregisterExtensionModule, extensionActions, extensionActionOf } from "../extensions/registry.ts";
import {
  deleteExtension,
  deleteExtensionTasks,
  findExtension,
  listExtensions,
  updateExtension,
  type ExtensionRow,
} from "../db/queries/extensions.ts";
import type { ExtensionDto, ExtensionSettingsField } from "../../shared/types.ts";

/**
 * Installed extensions, managed (SPEC §15, §20 phase 143).
 *
 * Enable/disable, settings, install and uninstall. Settings are declared by the
 * extension as a schema and rendered by the client; the server stores them and
 * hands them to `register(ctx, settings)` on every reload.
 */

function parseSchema(raw: string | null): ExtensionSettingsField[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ExtensionSettingsField[]) : [];
  } catch {
    return [];
  }
}

function parseSettings(raw: string | null): Record<string, unknown> {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toExtensionDto(row: ExtensionRow): ExtensionDto {
  return {
    id: row.ulid,
    name: row.name,
    version: row.version,
    author: row.author,
    description: row.description,
    enabled: row.enabled === 1,
    builtIn: row.built_in === 1,
    settings: parseSettings(row.settings),
    settingsSchema: parseSchema(row.settings_schema),
  };
}

export function extensionRoutes(ctx: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  app.get("/", (c) => c.json(listExtensions(ctx.db).map(toExtensionDto)));

  /** The on-demand actions enabled extensions offer (§148, §150). */
  app.get("/actions", (c) =>
    c.json(
      extensionActions().map((entry) => ({
        key: entry.action.key,
        label: entry.action.label,
        description: entry.action.description ?? null,
        scope: entry.action.scope ?? "chat",
      })),
    ),
  );

  /**
   * Run a global extension action (§150): pure code, no scene, no model. The
   * chat-scoped counterpart lives on the scene routes, where the service is.
   */
  app.post("/actions/:key/run", async (c) => {
    const entry = extensionActionOf(c.req.param("key"));
    if (entry === null || (entry.action.scope !== "global" && entry.action.run === undefined)) {
      return c.json({ error: { code: "not_found", message: "No such global action." } }, 404);
    }
    try {
      await entry.action.run!({ db: ctx.db });
      return c.json({ ok: true });
    } catch {
      return c.json({ error: { code: "failed", message: "The action failed." } }, 500);
    }
  });

  app.patch("/:extensionId", async (c) => {
    const extension = findExtension(ctx.db, c.req.param("extensionId"));
    if (extension === null) return c.json({ error: { code: "not_found", message: "No such extension." } }, 404);

    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }

    const patch: { enabled?: boolean; settings?: string } = {};
    if (typeof body["enabled"] === "boolean") patch.enabled = body["enabled"];
    if ("settings" in body && typeof body["settings"] === "object" && body["settings"] !== null) {
      patch.settings = JSON.stringify(body["settings"]);
    }
    if (patch.enabled === undefined && patch.settings === undefined) {
      return c.json({ error: { code: "bad_request", message: "Nothing to change." } }, 400);
    }

    const updated = updateExtension(ctx.db, extension.id, patch);
    // Reload so a toggle or a settings change takes effect without a restart.
    await loadInstalledExtensions(ctx.db, ctx.config.extensionsDir);
    return c.json(toExtensionDto(updated));
  });

  app.delete("/:extensionId", (c) => {
    const extension = findExtension(ctx.db, c.req.param("extensionId"));
    if (extension === null) return c.json({ error: { code: "not_found", message: "No such extension." } }, 404);
    if (extension.built_in === 1) {
      return c.json({ error: { code: "bad_request", message: "Built-in extensions cannot be removed." } }, 400);
    }

    unregisterExtensionModule(extension.name);
    deleteExtensionTasks(ctx.db, extension.name);
    deleteExtension(ctx.db, extension.id);
    rmSync(extension.dir, { recursive: true, force: true });
    return c.json({ ok: true });
  });

  return app;
}
