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
const SCREEN = readFileSync(
  join(import.meta.dir, "..", "client", "screens", "BackgroundsScreen.tsx"),
  "utf8",
);
const SETTINGS = readFileSync(
  join(import.meta.dir, "..", "client", "screens", "SettingsScreen.tsx"),
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
    // The backdrop manager is one screen, not a Settings section plus a screen
    // (§20 phase 122): the library and these controls live on the screen alone.
    expect(SCREEN).toContain("useGenerateBackground");
    expect(SCREEN).toContain("useSetDefaultBackground");
    expect(SCREEN).toContain("useUpdateBackgroundOpacity");
    expect(SETTINGS).not.toContain("BackgroundsSection");
  });

  test("the editor is a pane on desktop and a sheet on a phone", () => {
    // One body, two containers (§20 phase 116): the screen picks by pointer,
    // so the fixed 420px pane cannot squeeze onto a phone.
    expect(SCREEN).toContain("useIsDesktop");
    expect(SCREEN).toContain("isDesktop ?");
    expect(SCREEN).toContain("<aside");
    expect(SCREEN).toContain("<Sheet");
    // The header wraps instead of overflowing at 390px.
    expect(SCREEN).toContain("flex-wrap");
  });

  test("the editor saves behind one button, not per field on blur", () => {
    // The dirty state gates a single Save (§20 phase 118); the silent per-field
    // blur-save is gone, and a "Saved" note confirms the write landed.
    expect(SCREEN).toContain("disabled={!dirty}");
    expect(SCREEN).toContain("strings.characters.saved");
    expect(SCREEN).not.toContain("onBlur={() => { if (name.trim()");
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
