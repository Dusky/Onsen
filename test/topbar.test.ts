import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The top bar and the desktop header (SPEC §16, §20 phases 80, 91).
 *
 * Phase 80 put the five destinations in one top bar on every width. The
 * redesign split the width again: the phone keeps the navigation top bar, and
 * the desktop gets the mockup's header — wordmark, scene, model, prose size,
 * base and the panel toggles — because the destinations moved into the two
 * rails. This pins that split, so the two cannot quietly diverge.
 */

const TOP = readFileSync(join(import.meta.dir, "..", "client", "components", "TopBar.tsx"), "utf8");
const APP = readFileSync(join(import.meta.dir, "..", "client", "App.tsx"), "utf8");
const HEADER = readFileSync(join(import.meta.dir, "..", "client", "components", "Header.tsx"), "utf8");
const RAIL = readFileSync(
  join(import.meta.dir, "..", "client", "components", "LeftRail.tsx"),
  "utf8",
);

describe("the top bar", () => {
  test("the phone keeps the navigation top bar", () => {
    expect(APP).toContain("<TopBar />");
    // The old cross-screen strip is gone; the top bar's indicator replaced it.
    expect(APP).not.toContain("WritingElsewhere");
  });

  test("carries the destinations and the writing indicator", () => {
    expect(TOP).toContain("strings.nav.roleplays");
    expect(TOP).toContain("strings.nav.settings");
    expect(TOP).toContain("showWriting");
  });

  test("the rail is the icon rail, not the old destination list", () => {
    expect(RAIL).not.toContain("strings.nav.roleplays");
    expect(RAIL).not.toContain("strings.nav.recent");
    expect(RAIL).toContain("id: \"prompt\"");
  });
});

describe("the desktop header", () => {
  test("the desktop renders it instead of the navigation bar", () => {
    expect(APP).toContain("<Header />");
  });

  test("carries the scene, prose, base and the toggles — the model moved to the composer", () => {
    expect(HEADER).toContain("strings.header.turns");
    expect(HEADER).not.toContain("useConnectionProfiles");
    expect(HEADER).toContain("setScale");
    expect(HEADER).toContain("setBase");
    expect(HEADER).toContain("toggleLeftRail");
    expect(HEADER).toContain("toggleRightRail");
  });
});
