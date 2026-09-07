import { afterEach, describe, expect, test } from "bun:test";
import { completeSetup, createHarness, type TestHarness } from "./helpers.ts";
import type { CharacterDto } from "../shared/types.ts";

/**
 * Generating a character portrait (SPEC §20 phase 79).
 *
 * A card's portrait used to come only from import; the editor had no way to
 * make one. This pins the route that draws from the card's description through
 * the configured picture service and files it exactly where an imported card's
 * portrait goes — `characters.avatar_path` — as filing rather than editing, so
 * no version snapshot is taken.
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
  const parsed = response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  return { status: response.status, body: parsed };
}

const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("generating a portrait", () => {
  test("draws and files it where an imported card's portrait goes", async () => {
    const t = await signedIn();

    const server = Bun.serve({
      port: 0,
      fetch(request) {
        if (request.method === "POST" && request.url.includes("/sdapi/v1/txt2img")) {
          return Response.json({ images: [PIXEL] });
        }
        return new Response("not found", { status: 404 });
      },
    });

    try {
      await json(t, "POST", "/api/media/services", {
        name: "Stub draw",
        purpose: "image",
        kind: "a1111",
        baseUrl: `http://127.0.0.1:${server.port}`,
      });

      const created = await json<CharacterDto>(t, "POST", "/api/characters", {
        name: "Bell",
        description: "A quiet tracker who haunts the treeline.",
        personality: "Laconic, watchful.",
      });
      expect(created.body.hasAvatar).toBe(false);

      const generated = await json<CharacterDto>(
        t,
        "POST",
        `/api/characters/${created.body.id}/portrait/generate`,
        {},
      );
      expect(generated.status).toBe(200);
      expect(generated.body.hasAvatar).toBe(true);

      const row = t.ctx.db
        .query("SELECT avatar_path FROM characters WHERE ulid = $u")
        .get({ u: created.body.id }) as { avatar_path: string | null };
      expect(row.avatar_path).not.toBeNull();

      const served = await t.fetch(`/api/characters/${created.body.id}/avatar`);
      expect(served.status).toBe(200);
      expect(served.headers.get("Content-Type")).toContain("image/png");
    } finally {
      server.stop(true);
    }
  });

  test("filing is not editing: no version snapshot", async () => {
    const t = await signedIn();
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        if (request.method === "POST" && request.url.includes("/sdapi/v1/txt2img")) {
          return Response.json({ images: [PIXEL] });
        }
        return new Response("not found", { status: 404 });
      },
    });

    try {
      await json(t, "POST", "/api/media/services", {
        name: "Stub draw",
        purpose: "image",
        kind: "a1111",
        baseUrl: `http://127.0.0.1:${server.port}`,
      });
      const created = await json<CharacterDto>(t, "POST", "/api/characters", {
        name: "Bell",
        description: "A quiet tracker.",
      });
      const before = await json<unknown[]>(t, "GET", `/api/characters/${created.body.id}/versions`);

      await json<CharacterDto>(t, "POST", `/api/characters/${created.body.id}/portrait/generate`, {});

      const after = await json<unknown[]>(t, "GET", `/api/characters/${created.body.id}/versions`);
      expect(after.body).toHaveLength(before.body.length);
    } finally {
      server.stop(true);
    }
  });
});
