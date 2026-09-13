import { afterEach, describe, expect, test } from "bun:test";
import { completeSetup, createHarness, type TestHarness } from "./helpers.ts";
import { resolveRoute } from "../server/generation/route.ts";
import type { ConnectionProfileDto } from "../shared/types.ts";

/**
 * A context window per connection profile (§20 phase 186).
 *
 * The prompt budget is the smaller of the preset's window and the model's own,
 * and the model's own was hardcoded to 32k for every OpenAI-compatible
 * provider. The window is a property of the model a profile names, so the
 * reader sets it there and the route carries it into the adapter.
 */

let harness: TestHarness | null = null;

async function signedIn(): Promise<TestHarness> {
  if (harness === null) {
    harness = createHarness();
    await completeSetup(harness);
  }
  return harness;
}

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

async function json<T>(
  t: TestHarness,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const response = await t.fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as T };
}

describe("the profile's context window", () => {
  test("round-trips, and null clears back to the provider default", async () => {
    const t = await signedIn();
    const profiles = await json<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
    const id = profiles.body[0]!.id;

    const set = await json<ConnectionProfileDto>(t, "PATCH", `/api/connections/profiles/${id}`, {
      contextSize: 131_072,
    });
    expect(set.body.contextSize).toBe(131_072);

    const cleared = await json<ConnectionProfileDto>(
      t,
      "PATCH",
      `/api/connections/profiles/${id}`,
      { contextSize: null },
    );
    expect(cleared.body.contextSize).toBe(null);
  });

  test("resolveRoute carries it into the adapter's config", async () => {
    const t = await signedIn();
    const profiles = await json<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
    const id = profiles.body[0]!.id;
    await json(t, "PATCH", `/api/connections/profiles/${id}`, { contextSize: 131_072 });

    const row = t.ctx.db
      .query("SELECT id FROM connection_profiles WHERE ulid = $ulid")
      .get({ ulid: id }) as { id: number };
    const route = resolveRoute(t.ctx.db, t.ctx.keyring, { profileId: row.id });
    expect(route.maxContext).toBe(131_072);
  });

  test("a value outside the range, or the wrong type, is refused", async () => {
    const t = await signedIn();
    const profiles = await json<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
    const id = profiles.body[0]!.id;
    expect((await json(t, "PATCH", `/api/connections/profiles/${id}`, { contextSize: 12 })).status).toBe(400);
    expect((await json(t, "PATCH", `/api/connections/profiles/${id}`, { contextSize: "big" })).status).toBe(400);
  });
});
