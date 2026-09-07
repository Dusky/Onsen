import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The global top bar (SPEC §16, §20 phase 80).
 *
 * The destinations used to live in the desktop rail and the mobile tab bar, two
 * places for the same five things. Phase 80 puts them in one top bar, on every
 * screen and every width, with the wordmark and the cross-screen writing
 * indicator — SillyTavern's shape. This pins that the nav moved and the rail
 * shrank, so the two cannot quietly diverge again.
 */

const TOP = readFileSync(join(import.meta.dir, "..", "client", "components", "TopBar.tsx"), "utf8");
const APP = readFileSync(join(import.meta.dir, "..", "client", "App.tsx"), "utf8");
const SIDEBAR = readFileSync(
  join(import.meta.dir, "..", "client", "components", "Sidebar.tsx"),
  "utf8",
);

describe("the top bar", () => {
  test("is rendered in the shell, on both layouts", () => {
    expect(APP).toContain("<TopBar />");
    // The old cross-screen strip is gone; the top bar's indicator replaced it.
    expect(APP).not.toContain("WritingElsewhere");
  });

  test("carries the destinations and the writing indicator", () => {
    expect(TOP).toContain("strings.nav.roleplays");
    expect(TOP).toContain("strings.nav.settings");
    expect(TOP).toContain("showWriting");
  });

  test("the rail shrank to the recent list", () => {
    expect(SIDEBAR).not.toContain("strings.nav.roleplays");
    expect(SIDEBAR).toContain("strings.nav.recent");
  });
});
