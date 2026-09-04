import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The installed app (SPEC §16): "web manifest plus a service worker caching the
 * app shell only. No offline chat sync."
 *
 * Structural, like `reachable.test.ts`, and deliberately: what a service worker
 * actually does needs a browser, and that is what the phase's browser drive is
 * for. What can be checked here is that the promises the manifest makes are
 * kept, and that the worker never reaches for `/api` — which is the rule a
 * future edit is most likely to break, and the one that would be worst to
 * break.
 */

const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

interface Manifest {
  name: string;
  start_url: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: Array<{ src: string; sizes: string; type: string; purpose: string }>;
}

describe("the web manifest", () => {
  const manifest = JSON.parse(read("client/public/manifest.webmanifest")) as Manifest;

  test("declares a standalone app on the dark ground", () => {
    expect(manifest.name).toBe("Onsen");
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    // The design's own background, so the splash is not a white flash (§16).
    expect(manifest.background_color).toBe("#14120f");
    expect(manifest.theme_color).toBe("#14120f");
  });

  test("every icon it names is on disk, at the size it claims", () => {
    for (const icon of manifest.icons) {
      const path = join("client/public", icon.src);
      expect(existsSync(join(root, path))).toBe(true);

      // The PNG header carries the real dimensions; a manifest that lies about
      // them gets the icon rescaled or dropped, silently.
      const bytes = readFileSync(join(root, path));
      const width = bytes.readUInt32BE(16);
      const height = bytes.readUInt32BE(20);
      expect(`${width}x${height}`).toBe(icon.sizes);
    }
  });

  test("offers a maskable icon, so a launcher may crop it", () => {
    expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
  });
});

describe("the service worker", () => {
  const template = read("client/sw-template.js");

  test("never caches anything the server owns", () => {
    // No offline chat sync (§16). A cached scene is a lie the moment the phone
    // and the desktop disagree, and a cached session response is worse.
    expect(template).toContain('url.pathname.startsWith("/api/")');
    // The only mention of /api is the bail-out; nothing fetches or caches it.
    const apiLines = template.split("\n").filter((line) => line.includes("/api"));
    expect(apiLines.every((line) => line.includes("return") || line.startsWith(" *"))).toBe(true);
  });

  test("its precache list is filled in by the build, not hardcoded", () => {
    // Hashed filenames are only known once Vite has emitted them; a hardcoded
    // list would cache the previous build's bundle forever.
    expect(template).toContain("__PRECACHE__");
    expect(template).toContain("__VERSION__");
    expect(read("vite.config.ts")).toContain("__PRECACHE__");
  });

  test("drops the caches of builds that are no longer current", () => {
    expect(template).toContain("caches.delete");
  });
});

describe("the document", () => {
  const html = read("client/index.html");

  test("links the manifest and the icons a launcher looks for", () => {
    expect(html).toContain('rel="manifest"');
    expect(html).toContain("/manifest.webmanifest");
    // iOS reads this rather than the manifest.
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain('name="theme-color"');
  });
});

describe("registration", () => {
  const main = read("client/main.tsx");

  test("happens in production only, and never throws into the app", () => {
    expect(main).toContain("import.meta.env.PROD");
    expect(main).toContain('"serviceWorker" in navigator');
    expect(main).toContain("catch");
  });
});
