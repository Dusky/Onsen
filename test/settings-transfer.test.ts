import { afterEach, describe, expect, test } from "bun:test";
import { completeSetup, createHarness, type TestHarness } from "./helpers.ts";
import { DOCK_DEFAULTS, READER_DEFAULTS, READING_DEFAULTS, LAYOUT_PRESETS } from "../shared/types.ts";
import type { DockDto, LayoutDto, ReaderDto, ReadingDto } from "../shared/types.ts";

/**
 * The whole setup as one file (§20 phase 168).
 *
 * Packs carry content and themes export on their own; what travelled nowhere
 * was the shape of the app — the layout, the reading surface, the reader's
 * controls, which theme is on.
 *
 * The property that matters is the round trip: export, wipe, import, and the
 * setup is back. The property that matters *more* is what happens to a file
 * that is not one — this arrives from another machine, so every refusal below
 * is a refusal by design rather than a crash that happened to be safe.
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

interface Preferences {
  layout: LayoutDto;
  reading: ReadingDto;
  reader: ReaderDto;
  completionChime: boolean;
  /** Which panels dock to which rail (§20 phase 173). */
  dock: DockDto;
}

async function json<T>(t: TestHarness, method: string, path: string, body?: unknown): Promise<T> {
  const response = await t.fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  return (await response.json()) as T;
}

/** A settings file as the app would produce it. */
async function exported(t: TestHarness): Promise<Record<string, unknown>> {
  return json(t, "GET", "/api/system/settings/export");
}

/** Import a document, as a file the way the client sends it. */
async function importDoc(
  t: TestHarness,
  document: unknown,
  raw?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const form = new FormData();
  form.append(
    "file",
    new File([raw ?? JSON.stringify(document)], "onsen-settings.json", {
      type: "application/json",
    }),
  );
  const response = await t.fetch("/api/system/settings/import", { method: "POST", body: form });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe("the round trip", () => {
  test("a fresh export is the defaults, and says what it is", async () => {
    const t = await signedIn();
    const file = await exported(t);
    expect(file["onsen"]).toBe("onsen-settings");
    expect(file["version"]).toBe(1);
    expect(file["reader"]).toEqual(READER_DEFAULTS);
    expect(file["reading"]).toEqual(READING_DEFAULTS);
    expect(file["layout"]).toMatchObject({ preset: "instrument" });
    // The rails travel too (§20 phase 173): an arrangement is a decision
    // about the app's shape, which is exactly what this file is for.
    expect(file["dock"]).toEqual(DOCK_DEFAULTS);
    // The theme travels by name. A theme is already portable on its own, and
    // an import of *settings* is not where a new palette should appear in your
    // list.
    expect(typeof file["theme"]).toBe("string");
  });

  test("export, wipe, import, and the setup is back", async () => {
    const t = await signedIn();
    await json(t, "PATCH", "/api/system/preferences", {
      layout: { preset: "document" },
      reading: { scale: 1.2, measure: 860 },
      reader: { send: "modEnter", timestamps: true, media: "grid", notices: "bottomRight" },
      completionChime: true,
      dock: { left: ["prompt", "scene"], right: ["characters"], leftWidth: 300 },
    });
    const file = await exported(t);

    // Wiped back to something else entirely, so a no-op import cannot pass.
    await json(t, "PATCH", "/api/system/preferences", {
      layout: { preset: "instrument" },
      reading: READING_DEFAULTS,
      reader: READER_DEFAULTS,
      completionChime: false,
      dock: DOCK_DEFAULTS,
    });
    expect((await json<Preferences>(t, "GET", "/api/system/preferences")).reader.send).toBe("enter");

    const { status, body } = await importDoc(t, file);
    expect(status).toBe(200);
    expect(body["skipped"]).toEqual([]);

    const after = await json<Preferences>(t, "GET", "/api/system/preferences");
    expect(after.layout.preset).toBe("document");
    expect(after.reading.scale).toBeCloseTo(1.2);
    expect(after.reading.measure).toBe(860);
    expect(after.reader.send).toBe("modEnter");
    expect(after.reader.timestamps).toBe(true);
    expect(after.reader.media).toBe("grid");
    expect(after.reader.notices).toBe("bottomRight");
    expect(after.completionChime).toBe(true);
    // Including the panel that was moved, the one that was hidden by being
    // named nowhere, and the width.
    expect(after.dock.left).toEqual(["prompt", "scene"]);
    expect(after.dock.right).toEqual(["characters"]);
    expect(after.dock.leftWidth).toBe(300);
  });

  test("the theme comes back by name", async () => {
    const t = await signedIn();
    const themes = await json<{ themes: { id: string; name: string }[] }>(t, "GET", "/api/themes");
    const other = themes.themes[1] ?? themes.themes[0]!;
    await json(t, "POST", `/api/themes/${other.id}/activate`);
    const file = await exported(t);
    expect(file["theme"]).toBe(other.name);

    await json(t, "POST", `/api/themes/${themes.themes[0]!.id}/activate`);
    const { body } = await importDoc(t, file);
    expect(body["applied"]).toContain("theme");
    expect((await exported(t))["theme"]).toBe(other.name);
  });

  test("a theme this install does not have is skipped, not invented", async () => {
    // The ordinary case rather than an error: the file came from a machine with
    // a theme somebody made there.
    const t = await signedIn();
    const file = await exported(t);
    const was = file["theme"];
    const { status, body } = await importDoc(t, { ...file, theme: "Somebody Else's Palette" });
    expect(status).toBe(200);
    expect(body["skipped"]).toContain("theme");
    expect((await exported(t))["theme"]).toBe(was);
    // And nothing was created.
    const themes = await json<{ themes: { name: string }[] }>(t, "GET", "/api/themes");
    expect(themes.themes.map((theme) => theme.name)).not.toContain("Somebody Else's Palette");
  });

  test("the report names what was applied and what was not", async () => {
    // An import that quietly did four of five things is the silent-partial
    // failure §18 is written against.
    const t = await signedIn();
    const { body } = await importDoc(t, {
      onsen: "onsen-settings",
      version: 1,
      reading: { scale: 1.1 },
    });
    expect(body["applied"]).toEqual(["reading"]);
    expect(body["skipped"]).toEqual(["layout", "reader", "dock", "completionChime", "theme"]);
  });
});

describe("what it refuses", () => {
  test("a truncated file, whole rather than half-applied", async () => {
    const t = await signedIn();
    const file = await exported(t);
    const cut = JSON.stringify(file).slice(0, 60);
    const { status, body } = await importDoc(t, null, cut);
    expect(status).toBe(400);
    expect(String((body["error"] as { message?: string })?.message)).toContain("not readable JSON");
    // And changed nothing.
    expect((await json<Preferences>(t, "GET", "/api/system/preferences")).reader).toEqual(
      READER_DEFAULTS,
    );
  });

  test("a theme file, which is also a JSON object with a name", async () => {
    // Without the marker, importing the wrong file would apply nothing and
    // report success.
    const t = await signedIn();
    const { status } = await importDoc(t, { name: "Ink", tokens: { "color-bg": "#000000" } });
    expect(status).toBe(400);
  });

  test("an array, and a bare string", async () => {
    const t = await signedIn();
    expect((await importDoc(t, [1, 2, 3])).status).toBe(400);
    expect((await importDoc(t, null, '"onsen-settings"')).status).toBe(400);
  });

  test("a file with no version", async () => {
    const t = await signedIn();
    expect((await importDoc(t, { onsen: "onsen-settings" })).status).toBe(400);
    expect((await importDoc(t, { onsen: "onsen-settings", version: "one" })).status).toBe(400);
    expect((await importDoc(t, { onsen: "onsen-settings", version: 0 })).status).toBe(400);
  });

  test("a file from a newer build, rather than dropping what it does not know", async () => {
    // A newer file's extra groups are not just unknown fields — one of them may
    // be a whole group this build would silently drop, and a reader would have
    // no way to know what did not arrive.
    const t = await signedIn();
    const { status, body } = await importDoc(t, {
      onsen: "onsen-settings",
      version: 99,
      reading: { scale: 1.4 },
    });
    expect(status).toBe(400);
    expect(String((body["error"] as { message?: string })?.message)).toContain("newer version");
    expect((await json<Preferences>(t, "GET", "/api/system/preferences")).reading.scale).toBe(1);
  });
});

describe("a hostile file gets the same validation a hostile request does", () => {
  /*
   * The whole reason each group goes through the `apply*` function the PATCH
   * uses: one answer to "what does this value mean". A second copy of that
   * logic for the import path is where the two would drift, and this file
   * arrives from another machine.
   */
  test("an out-of-range slider is pinned, not written", async () => {
    const t = await signedIn();
    await importDoc(t, {
      onsen: "onsen-settings",
      version: 1,
      reading: { scale: 400, measure: -1, leading: 99, window: 1e9 },
    });
    const { reading } = await json<Preferences>(t, "GET", "/api/system/preferences");
    expect(reading.scale).toBe(1.5);
    expect(reading.measure).toBe(520);
    expect(reading.leading).toBe(2);
    expect(reading.window).toBe(1000);
  });

  test("a value the settings screen could not produce is dropped", async () => {
    const t = await signedIn();
    await importDoc(t, {
      onsen: "onsen-settings",
      version: 1,
      reader: { send: "telepathy", notices: "under the fold", media: "carousel", timestamps: true },
      layout: { attribution: "sideways", cast: "interpretive dance", avatarShape: "trapezoid" },
    });
    const { reader, layout } = await json<Preferences>(t, "GET", "/api/system/preferences");
    expect(reader.send).toBe("enter");
    expect(reader.notices).toBe("top");
    expect(reader.media).toBe("list");
    // The one good field in the group still lands.
    expect(reader.timestamps).toBe(true);
    expect(layout.attribution).toBe("stacked");
    expect(layout.cast).toBe("segments");
    expect(layout.avatarShape).toBe("circle");
  });

  test("a theme name carrying SQL selects no theme", async () => {
    const t = await signedIn();
    const before = (await exported(t))["theme"];
    const { status, body } = await importDoc(t, {
      onsen: "onsen-settings",
      version: 1,
      theme: "Ink' OR 1=1 --",
    });
    expect(status).toBe(200);
    expect(body["skipped"]).toContain("theme");
    expect((await exported(t))["theme"]).toBe(before);
    // And the themes table is intact.
    const themes = await json<{ themes: unknown[] }>(t, "GET", "/api/themes");
    expect(themes.themes.length).toBeGreaterThan(1);
  });

  test("a nested object where a boolean belongs changes nothing", async () => {
    const t = await signedIn();
    const { status } = await importDoc(t, {
      onsen: "onsen-settings",
      version: 1,
      completionChime: { valueOf: "yes" },
      layout: { reader: "not an object" },
    });
    expect(status).toBe(200);
    const { completionChime, layout } = await json<Preferences>(t, "GET", "/api/system/preferences");
    expect(completionChime).toBe(false);
    expect(layout.reader).toEqual(LAYOUT_PRESETS.instrument.reader);
  });

  test("it is behind the auth wall", async () => {
    // Every other system route is; a settings file names the reader's theme
    // and their whole layout.
    const t = createHarness();
    try {
      expect((await t.fetch("/api/system/settings/export")).status).toBe(401);
      expect((await t.fetch("/api/system/settings/import", { method: "POST" })).status).toBe(401);
    } finally {
      t.cleanup();
    }
  });
});
