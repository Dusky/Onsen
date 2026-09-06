import { afterEach, describe, expect, test } from "bun:test";
import { completeSetup, createHarness, type TestHarness } from "./helpers.ts";
import type { CharacterDto, SceneDto } from "../shared/types.ts";

/**
 * Generating a scene background (SPEC §12, §20 phase 77).
 *
 * `scenes.background_path` has existed with a way to *upload* into it since
 * phase 41 and nothing that generates one — GAPS §7's "auto background". This
 * pins the route that draws from the configured picture service and files the
 * image exactly where an upload would, so `hasBackground` and the VN stage
 * light up without a second path.
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

/** A 1×1 PNG, so the drawing service returns a real image rather than bytes. */
const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("generating a background", () => {
  test("draws and files it where an upload would go", async () => {
    const t = await signedIn();

    // A local A1111-shaped service that always answers with the pixel.
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
      const service = await json<{ id: string }>(t, "POST", "/api/media/services", {
        name: "Stub draw",
        purpose: "image",
        kind: "a1111",
        baseUrl: `http://127.0.0.1:${server.port}`,
      });
      expect(service.status).toBe(201);

      const character = await json<CharacterDto>(t, "POST", "/api/characters", { name: "Bell" });
      const profiles = await json<{ id: string; isDefault?: boolean }[]>(
        t,
        "GET",
        "/api/connections/profiles",
      );
      const scene = await json<SceneDto>(t, "POST", "/api/scenes", {
        title: "Ridge station",
        connectionProfileId: profiles.body[0]!.id,
      });
      await json(t, "PUT", `/api/scenes/${scene.body.id}/cast/${character.body.id}`);
      expect(scene.body.hasBackground).toBe(false);

      const generated = await json<SceneDto>(
        t,
        "POST",
        `/api/scenes/${scene.body.id}/background/generate`,
        {},
      );
      expect(generated.status).toBe(200);
      expect(generated.body.hasBackground).toBe(true);

      const row = t.ctx.db
        .query("SELECT background_path FROM scenes WHERE ulid = $u")
        .get({ u: scene.body.id }) as { background_path: string | null };
      expect(row.background_path).not.toBeNull();

      const served = await t.fetch(`/api/scenes/${scene.body.id}/background`);
      expect(served.status).toBe(200);
      expect(served.headers.get("Content-Type")).toContain("image/png");
    } finally {
      server.stop(true);
    }
  });

  test("no picture service is refused rather than invented", async () => {
    const t = await signedIn();
    const character = await json<CharacterDto>(t, "POST", "/api/characters", { name: "Bell" });
    const profiles = await json<{ id: string }[]>(t, "GET", "/api/connections/profiles");
    const scene = await json<SceneDto>(t, "POST", "/api/scenes", {
      title: "No drawer",
      connectionProfileId: profiles.body[0]!.id,
    });
    await json(t, "PUT", `/api/scenes/${scene.body.id}/cast/${character.body.id}`);

    const generated = await json(t, "POST", `/api/scenes/${scene.body.id}/background/generate`, {});
    expect(generated.status).toBe(502);
  });
});
