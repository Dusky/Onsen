import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { issueSession } from "../middleware/session.ts";
import { createRateLimiter } from "../middleware/rate-limit.ts";
import { encryptSecret } from "../lib/crypto.ts";
import { SettingKey, isSetupCompleted, setSetting } from "../db/queries/settings.ts";
import {
  insertConnectionProfile,
  insertDefaultPreset,
  insertProvider,
  toConnectionProfileDto,
  toPresetDto,
  toProviderDto,
} from "../db/queries/connections.ts";
import {
  MIN_PASSWORD_LENGTH,
  isProviderKind,
  type SetupRequest,
  type SetupResponse,
} from "../../shared/types.ts";

interface ValidatedSetup {
  password: string;
  profileName: string;
  providerName: string;
  kind: SetupRequest["connection"]["kind"];
  baseUrl: string | null;
  apiKey: string | null;
  model: string | null;
}

function trimmed(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const out = value.trim();
  return out === "" ? null : out;
}

function validate(body: unknown): { ok: true; value: ValidatedSetup } | { ok: false; message: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "Expected a JSON body." };
  }
  const input = body as Partial<SetupRequest>;

  const password = typeof input.password === "string" ? input.password : "";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }

  const connection = input.connection;
  if (typeof connection !== "object" || connection === null) {
    return { ok: false, message: "A first connection is required." };
  }
  if (!isProviderKind(connection.kind)) {
    return { ok: false, message: "Unknown provider kind." };
  }
  const providerName = trimmed(connection.providerName);
  if (providerName === null) return { ok: false, message: "The provider needs a name." };
  const profileName = trimmed(connection.profileName) ?? providerName;

  const baseUrl = trimmed(connection.baseUrl);
  if (baseUrl !== null) {
    try {
      new URL(baseUrl);
    } catch {
      return { ok: false, message: "The base URL is not a valid URL." };
    }
  }
  // A local llama.cpp or KoboldCpp server has no key but must have an address;
  // a hosted provider is the other way round.
  if (connection.kind === "text_completion" && baseUrl === null) {
    return { ok: false, message: "A text-completion server needs a base URL." };
  }

  return {
    ok: true,
    value: {
      password,
      profileName,
      providerName,
      kind: connection.kind,
      baseUrl,
      apiKey: trimmed(connection.apiKey),
      model: trimmed(connection.model),
    },
  };
}

/**
 * First-boot wizard (SPEC §17): set the password and the first connection
 * profile. Available only while the install is unconfigured, and it signs the
 * caller in on success so there is no immediate second password prompt.
 */
export function setupRoutes(ctx: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const limiter = createRateLimiter({ scope: "setup", limit: 20, windowMs: 10 * 60 * 1000 });

  app.post("/setup", limiter.middleware, async (c) => {
    if (isSetupCompleted(ctx.db)) {
      return c.json(
        { error: { code: "already_setup", message: "This install is already set up." } },
        409,
      );
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { code: "bad_request", message: "Expected a JSON body." } }, 400);
    }

    const validated = validate(body);
    if (!validated.ok) {
      return c.json({ error: { code: "invalid_setup", message: validated.message } }, 400);
    }
    const input = validated.value;

    // Hashing is async and slow by design, so it happens before the transaction
    // rather than holding a write lock open across it.
    const passwordHash = await Bun.password.hash(input.password);
    const apiKeyEncrypted =
      input.apiKey === null ? null : encryptSecret(ctx.keyring, input.apiKey);

    let response: SetupResponse | null = null;
    let raced = false;

    ctx.db.transaction(() => {
      // Re-check inside the write transaction: two wizard submissions racing
      // must not produce two passwords.
      if (isSetupCompleted(ctx.db)) {
        raced = true;
        return;
      }

      const preset = insertDefaultPreset(ctx.db, "Default");
      const provider = insertProvider(ctx.db, {
        name: input.providerName,
        kind: input.kind,
        baseUrl: input.baseUrl,
        apiKeyEncrypted,
        model: input.model,
      });
      const profile = insertConnectionProfile(ctx.db, {
        name: input.profileName,
        providerId: provider.id,
        model: input.model,
        presetId: preset.id,
        isDefault: true,
      });

      setSetting(ctx.db, SettingKey.passwordHash, passwordHash);
      setSetting(ctx.db, SettingKey.sessionGeneration, "1");
      setSetting(ctx.db, SettingKey.setupCompletedAt, String(Date.now()));

      response = {
        provider: toProviderDto(provider, ctx.keyring),
        profile: toConnectionProfileDto(profile, provider.ulid, preset.ulid),
        preset: toPresetDto(ctx.db, preset),
      };
    })();

    if (raced || response === null) {
      return c.json(
        { error: { code: "already_setup", message: "This install is already set up." } },
        409,
      );
    }

    issueSession(c, ctx);
    return c.json(response, 201);
  });

  return app;
}
