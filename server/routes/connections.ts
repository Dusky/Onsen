import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import {
  countConnectionProfiles,
  deleteConnectionProfile,
  deleteProvider,
  findConnectionProfileByUlid,
  findProviderById,
  findProviderByUlid,
  insertConnectionProfile,
  insertProvider,
  listConnectionProfiles,
  listPresets,
  listProviders,
  toConnectionProfileDto,
  toPresetDto,
  toProviderDto,
  ulidLookup,
  updateConnectionProfile,
  updateProvider,
} from "../db/queries/connections.ts";
import { encryptSecret } from "../lib/crypto.ts";
import { PROVIDER_KINDS, type ProviderKind } from "../../shared/types.ts";

/**
 * Providers and connection profiles (SPEC §20 phase 13).
 *
 * A profile is provider + model + preset under a name, and the reason it is an
 * entity rather than three fields on a scene is per-operation routing (§7):
 * bookkeeping goes to a cheap local model, prose to an expensive one, and both
 * are one tap to switch. Until this phase you could only use the profile the
 * setup wizard made, which made the routing that exists unreachable.
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

  /* -------------------------------------------------------------- */
  /* Providers                                                       */
  /* -------------------------------------------------------------- */

  function providerDtos() {
    return listProviders(ctx.db).map((row) => toProviderDto(row, ctx.keyring));
  }

  app.post("/providers", async (c) => {
    const body = await readJson(c);
    if (body === null) return c.json(badRequest("Expected a JSON body."), 400);

    const name = text(body["name"], 120);
    if (name === null) return c.json(badRequest("A provider needs a name."), 400);
    const kind = body["kind"];
    if (!(PROVIDER_KINDS as readonly unknown[]).includes(kind)) {
      return c.json(badRequest("Unknown provider kind."), 400);
    }

    const apiKey = text(body["apiKey"], 400);
    const row = insertProvider(ctx.db, {
      name,
      kind: kind as ProviderKind,
      baseUrl: text(body["baseUrl"], 500),
      // Encrypted here and never read back: the client only ever sees a mask.
      apiKeyEncrypted: apiKey === null ? null : encryptSecret(ctx.keyring, apiKey),
      model: text(body["model"], 200),
    });
    return c.json(toProviderDto(row, ctx.keyring), 201);
  });

  app.patch("/providers/:id", async (c) => {
    const row = findProviderByUlid(ctx.db, c.req.param("id"));
    if (row === null) return c.json(notFound("provider"), 404);

    const body = await readJson(c);
    if (body === null) return c.json(badRequest("Expected a JSON body."), 400);

    const patch: Parameters<typeof updateProvider>[2] = {};
    const name = text(body["name"], 120);
    if (name !== null) patch.name = name;
    if ("baseUrl" in body) patch.baseUrl = text(body["baseUrl"], 500);
    if ("model" in body) patch.model = text(body["model"], 200);
    if ("enabled" in body) {
      if (typeof body["enabled"] !== "boolean") {
        return c.json(badRequest("enabled must be a boolean."), 400);
      }
      patch.enabled = body["enabled"];
    }
    // Absent leaves the key alone; null clears it; a string replaces it. A form
    // that came back empty must not delete a credential nobody touched.
    if ("apiKey" in body) {
      const key = text(body["apiKey"], 400);
      patch.apiKeyEncrypted = key === null ? null : encryptSecret(ctx.keyring, key);
    }

    return c.json(toProviderDto(updateProvider(ctx.db, row.id, patch), ctx.keyring));
  });

  app.delete("/providers/:id", (c) => {
    const row = findProviderByUlid(ctx.db, c.req.param("id"));
    if (row === null) return c.json(notFound("provider"), 404);
    if (listProviders(ctx.db).length === 1) {
      return c.json(
        badRequest("This is the only provider. Add another before removing it."),
        400,
      );
    }
    deleteProvider(ctx.db, row.id);
    return c.json(providerDtos());
  });

  /* -------------------------------------------------------------- */
  /* Connection profiles                                             */
  /* -------------------------------------------------------------- */

  function profileDto(row: { id: number; provider_id: number; preset_id: number | null }) {
    const providers = ulidLookup(ctx.db, "providers");
    const presets = ulidLookup(ctx.db, "presets");
    const full = listConnectionProfiles(ctx.db).find((profile) => profile.id === row.id)!;
    return toConnectionProfileDto(
      full,
      providers.get(full.provider_id) ?? "",
      full.preset_id === null ? null : (presets.get(full.preset_id) ?? null),
    );
  }

  app.post("/profiles", async (c) => {
    const body = await readJson(c);
    if (body === null) return c.json(badRequest("Expected a JSON body."), 400);

    const name = text(body["name"], 120);
    if (name === null) return c.json(badRequest("A profile needs a name."), 400);
    const providerUlid = text(body["providerId"], 40);
    const provider = providerUlid === null ? null : findProviderByUlid(ctx.db, providerUlid);
    if (provider === null) return c.json(badRequest("No such provider."), 400);

    const preset = presetRef(body["presetId"]);
    if (preset === INVALID) return c.json(badRequest("No such preset."), 400);

    const row = insertConnectionProfile(ctx.db, {
      name,
      providerId: provider.id,
      model: text(body["model"], 200),
      presetId: preset,
      isDefault: body["isDefault"] === true,
    });
    return c.json(profileDto(row), 201);
  });

  app.patch("/profiles/:id", async (c) => {
    const row = findConnectionProfileByUlid(ctx.db, c.req.param("id"));
    if (row === null) return c.json(notFound("connection profile"), 404);

    const body = await readJson(c);
    if (body === null) return c.json(badRequest("Expected a JSON body."), 400);

    const patch: Parameters<typeof updateConnectionProfile>[2] = {};
    const name = text(body["name"], 120);
    if (name !== null) patch.name = name;
    if ("model" in body) patch.model = text(body["model"], 200);
    if ("isDefault" in body) {
      if (typeof body["isDefault"] !== "boolean") {
        return c.json(badRequest("isDefault must be a boolean."), 400);
      }
      patch.isDefault = body["isDefault"];
    }
    if ("providerId" in body) {
      const providerUlid = text(body["providerId"], 40);
      const provider = providerUlid === null ? null : findProviderByUlid(ctx.db, providerUlid);
      if (provider === null) return c.json(badRequest("No such provider."), 400);
      patch.providerId = provider.id;
    }
    if ("presetId" in body) {
      const preset = presetRef(body["presetId"]);
      if (preset === INVALID) return c.json(badRequest("No such preset."), 400);
      patch.presetId = preset;
    }

    return c.json(profileDto(updateConnectionProfile(ctx.db, row.id, patch)));
  });

  app.delete("/profiles/:id", (c) => {
    const row = findConnectionProfileByUlid(ctx.db, c.req.param("id"));
    if (row === null) return c.json(notFound("connection profile"), 404);
    // Scenes pointing at a deleted profile survive with a null and say they
    // have no connection; a roleplay with nowhere at all to generate is worse.
    if (countConnectionProfiles(ctx.db) === 1) {
      return c.json(badRequest("This is the only profile. Add another before removing it."), 400);
    }
    deleteConnectionProfile(ctx.db, row.id);
    const providers = ulidLookup(ctx.db, "providers");
    const presets = ulidLookup(ctx.db, "presets");
    return c.json(
      listConnectionProfiles(ctx.db).map((profile) =>
        toConnectionProfileDto(
          profile,
          providers.get(profile.provider_id) ?? "",
          profile.preset_id === null ? null : (presets.get(profile.preset_id) ?? null),
        ),
      ),
    );
  });

  /* -------------------------------------------------------------- */
  /* Small helpers                                                   */
  /* -------------------------------------------------------------- */

  const INVALID = Symbol("invalid");

  /** A preset reference: absent, cleared, or one that exists. */
  function presetRef(value: unknown): number | null | typeof INVALID {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") return INVALID;
    const row = ctx.db.query("SELECT id FROM presets WHERE ulid = $ulid").get({ ulid: value }) as
      | { id: number }
      | null;
    return row === null ? INVALID : row.id;
  }

  return app;
}

function badRequest(message: string) {
  return { error: { code: "bad_request", message } } as const;
}

function notFound(what: string) {
  return { error: { code: "not_found", message: `No such ${what}.` } } as const;
}

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<
  Record<string, unknown> | null
> {
  try {
    const parsed: unknown = await c.req.json();
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** A trimmed string, or null for absent, empty, or the wrong type. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.slice(0, max);
}
