import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import {
  listConnectionProfiles,
  listPresets,
  listProviders,
  toConnectionProfileDto,
  toPresetDto,
  toProviderDto,
  ulidLookup,
} from "../db/queries/connections.ts";

/**
 * Read-only for now. Editing providers and profiles belongs to the connection
 * profiles screen (SPEC §16), which needs the adapters from phase 4 to offer the
 * test button that makes the screen worth having.
 */
export function connectionRoutes(ctx: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  app.get("/providers", (c) =>
    c.json(listProviders(ctx.db).map((row) => toProviderDto(row, ctx.keyring))),
  );

  app.get("/presets", (c) => c.json(listPresets(ctx.db).map(toPresetDto)));

  app.get("/profiles", (c) => {
    const providers = ulidLookup(ctx.db, "providers");
    const presets = ulidLookup(ctx.db, "presets");
    return c.json(
      listConnectionProfiles(ctx.db).map((row) =>
        toConnectionProfileDto(
          row,
          providers.get(row.provider_id) ?? "",
          row.preset_id === null ? null : (presets.get(row.preset_id) ?? null),
        ),
      ),
    );
  });

  return app;
}
