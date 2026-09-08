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

  test("the destinations that do not fit a phone hide behind a more menu", () => {
    // Six labels do not fit a 390px bar; the tail goes behind a pinned "more"
    // button rather than scrolling off the edge (§20 phase 120).
    expect(TOP).toContain("PRIMARY");
    expect(TOP).toContain("OVERFLOW");
    expect(TOP).toContain("strings.nav.more");
    expect(TOP).toContain("sm:hidden");
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

  test("links the libraries — the full editors — by their names (§20 phase 139)", () => {
    expect(HEADER).toContain("LIBRARIES");
    expect(HEADER).toContain("strings.nav.characters");
    expect(HEADER).toContain("strings.nav.authors");
    expect(HEADER).toContain("strings.nav.lorebooks");
    expect(HEADER).toContain("strings.nav.backgrounds");
  });
});
