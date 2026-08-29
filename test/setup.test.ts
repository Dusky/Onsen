import { afterEach, describe, expect, test } from "bun:test";
import { createHarness, completeSetup, VALID_SETUP, type TestHarness } from "./helpers.ts";
import type { BootstrapDto, ProviderDto, SetupResponse } from "../shared/types.ts";
import { decryptSecret } from "../server/lib/crypto.ts";

let harness: TestHarness | null = null;
function h(): TestHarness {
  harness ??= createHarness();
  return harness;
}
afterEach(() => {
  harness?.cleanup();
  harness = null;
});

async function postSetup(t: TestHarness, body: unknown): Promise<Response> {
  return t.fetch("/api/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("setup wizard", () => {
  test("a fresh install reports that it needs setting up", async () => {
    const boot = (await (await h().fetch("/api/bootstrap")).json()) as BootstrapDto;
    expect(boot).toEqual({ setupCompleted: false, authenticated: false });
  });

  test("creates the password, provider, profile and default preset, and signs the user in", async () => {
    const t = h();
    const response = await completeSetup(t);
    expect(response.status).toBe(201);

    const body = (await response.json()) as SetupResponse;
    expect(body.provider.name).toBe("llama.cpp");
    expect(body.profile.name).toBe("Local 70B");
    expect(body.profile.isDefault).toBe(true);
    expect(body.profile.providerId).toBe(body.provider.id);
    expect(body.preset.isDefault).toBe(true);

    // SPEC §13: modern sampler defaults, not 2023 defaults.
    expect(body.preset.samplerSettings).toMatchObject({
      temperature: 1.0,
      min_p: 0.05,
      repetition_penalty: 1.0,
      dry_multiplier: 0.8,
      xtc_probability: 0.5,
    });

    // The wizard signs the caller in, so there is no second password prompt.
    const boot = (await (await t.fetch("/api/bootstrap")).json()) as BootstrapDto;
    expect(boot).toEqual({ setupCompleted: true, authenticated: true });
  });

  test("runs only once", async () => {
    const t = h();
    await completeSetup(t);
    const second = await postSetup(t, {
      ...VALID_SETUP,
      password: "a different password",
    });
    expect(second.status).toBe(409);

    // The original password still works, so the second attempt changed nothing.
    const login = await t.fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: VALID_SETUP.password }),
    });
    expect(login.status).toBe(200);
  });

  test("rejects a short password and writes nothing", async () => {
    const t = h();
    const response = await postSetup(t, { ...VALID_SETUP, password: "short" });
    expect(response.status).toBe(400);

    const boot = (await (await t.fetch("/api/bootstrap")).json()) as BootstrapDto;
    expect(boot.setupCompleted).toBe(false);
    expect(t.ctx.db.query("SELECT count(*) AS n FROM providers").get()).toEqual({ n: 0 });
    expect(t.ctx.db.query("SELECT count(*) AS n FROM presets").get()).toEqual({ n: 0 });
  });

  test("rejects an invalid base URL and a text-completion server with no address", async () => {
    const t = h();
    const badUrl = await postSetup(t, {
      ...VALID_SETUP,
      connection: { ...VALID_SETUP.connection, baseUrl: "not a url" },
    });
    expect(badUrl.status).toBe(400);

    const noUrl = await postSetup(t, {
      ...VALID_SETUP,
      connection: { ...VALID_SETUP.connection, baseUrl: "" },
    });
    expect(noUrl.status).toBe(400);
  });

  test("rejects an unknown provider kind", async () => {
    const response = await postSetup(h(), {
      ...VALID_SETUP,
      connection: { ...VALID_SETUP.connection, kind: "telepathy" },
    });
    expect(response.status).toBe(400);
  });

  test("encrypts the API key at rest and never returns it", async () => {
    const t = h();
    const apiKey = "sk-secret-value-9876";
    const response = await postSetup(t, {
      ...VALID_SETUP,
      connection: {
        ...VALID_SETUP.connection,
        kind: "openai_compatible",
        baseUrl: "https://api.openai.com/v1",
        apiKey,
      },
    });
    expect(response.status).toBe(201);
    t.captureCookie(response);

    const stored = t.ctx.db.query("SELECT api_key_encrypted FROM providers").get() as {
      api_key_encrypted: string;
    };
    expect(stored.api_key_encrypted).not.toContain(apiKey);
    expect(decryptSecret(t.ctx.keyring, stored.api_key_encrypted)).toBe(apiKey);

    const providers = (await (await t.fetch("/api/connections/providers")).json()) as ProviderDto[];
    expect(JSON.stringify(providers)).not.toContain(apiKey);
    expect(providers[0]).toMatchObject({ hasApiKey: true, apiKeyMask: "…9876" });
  });

  test("rejects a body that is not JSON", async () => {
    const response = await h().fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{oops",
    });
    expect(response.status).toBe(400);
  });
});
