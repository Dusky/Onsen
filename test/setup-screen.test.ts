import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The pre-auth screens sit inside the query provider (§20 phase 74).
 *
 * `SetupScreen` mounts `ModelPicker`, which calls a react-query hook. Until
 * phase 74 only the authenticated shell was wrapped in `QueryClientProvider`,
 * so a first run in a browser landed on a blank page with "No QueryClient set"
 * — and no test caught it, because the API path the harness uses works without
 * the screen. The provider now wraps all three branches.
 */

const APP = readFileSync(join(import.meta.dir, "..", "client", "App.tsx"), "utf8");

describe("the pre-auth screens sit inside the query provider", () => {
  test("setup, login and the shell each have one", () => {
    const count = APP.split("<QueryClientProvider client={queryClient}>").length - 1;
    expect(count).toBe(3);
  });

  test("the theme base reaches the document as data-theme", () => {
    // §20 phase 75: the bootstrap carries the active theme's base, and the app
    // sets it before any branch renders, so a theme's dark/light is honoured
    // rather than following the OS preference.
    expect(APP).toContain("document.documentElement.dataset.theme = boot.themeBase");
  });
});
