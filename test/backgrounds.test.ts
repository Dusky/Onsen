import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { completeSetup, createHarness, type TestHarness } from "./helpers.ts";

/**
 * The backdrop behind everything (SPEC §12, §20 phase 108).
 *
 * A library of generated backgrounds, one of which is the default; the opacity
 * is the reader's, and the chrome goes translucent while one shows. This pins
 * the layering, the settings surface and the opacity round-trip.
 */

const BACKGROUND = readFileSync(
  join(import.meta.dir, "..", "client", "components", "Background.tsx"),
  "utf8",
);
const CSS = readFileSync(join(import.meta.dir, "..", "client", "styles", "app.css"), "utf8");
const SECTION = readFileSync(
  join(import.meta.dir, "..", "client", "components", "BackgroundsSection.tsx"),
  "utf8",
);

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

async function json<T>(t: TestHarness, method: string, path: string, body?: unknown) {
  const response = await t.fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const parsed = response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  return { status: response.status, body: parsed };
}

interface BackgroundsDto {
  backgrounds: { id: string; isDefault: boolean }[];
  defaultId: string | null;
  opacity: number;
}

describe("the backdrop", () => {
  test("the scene wins over the default, then the built-in", () => {
    expect(BACKGROUND).toContain("hasBackground");
    expect(BACKGROUND).toContain("defaultId");
    expect(BACKGROUND).toContain("/default-background.jpg");
  });

  test("the chrome goes translucent while one shows", () => {
    expect(CSS).toContain('data-background="1"');
    expect(CSS).toContain("color-mix");
  });

  test("the manager generates, picks and sets opacity", () => {
    expect(SECTION).toContain("useGenerateBackground");
    expect(SECTION).toContain("useSetDefaultBackground");
    expect(SECTION).toContain("useUpdateBackgroundOpacity");
  });

  test("the opacity round-trips", async () => {
    const t = await signedIn();
    const first = await json<BackgroundsDto>(t, "GET", "/api/backgrounds");
    expect(first.body.opacity).toBeGreaterThan(0);

    const patched = await json<BackgroundsDto>(t, "PATCH", "/api/backgrounds", { opacity: 0.7 });
    expect(patched.body.opacity).toBeCloseTo(0.7);

    const read = await json<BackgroundsDto>(t, "GET", "/api/backgrounds");
    expect(read.body.opacity).toBeCloseTo(0.7);
  });
});
