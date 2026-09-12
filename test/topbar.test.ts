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
 *
 * The header briefly grew its own row of library destinations back
 * (Characters, Authors, Lorebooks, Backgrounds, Roleplays), duplicating entry
 * points the rails already had. Design review fix 5 removed it: Characters
 * and Authors are the right rail's tabs, Lore is the left rail's Lore
 * section, Roleplays is the wordmark button, and Backgrounds moved into
 * Settings. Fix 4 moved Settings the other way, out of the left rail's icon
 * column and into the header.
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
    // It renders sections from the dock registry (§20 phase 173) — which of
    // them is a per-reader arrangement now, but they are sections either
    // way, never destinations.
    expect(RAIL).toContain("PANEL_META");
    expect(RAIL).toContain("useDock()");
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

  test("does not duplicate the rails' own destinations (design review fix 5)", () => {
    expect(HEADER).not.toContain("LIBRARIES");
    expect(HEADER).not.toContain("strings.nav.characters");
    expect(HEADER).not.toContain("strings.nav.authors");
    expect(HEADER).not.toContain("strings.nav.lorebooks");
    expect(HEADER).not.toContain("strings.nav.backgrounds");
  });

  test("carries Settings instead, set off from the toggles (design review fix 4)", () => {
    expect(HEADER).toContain("strings.nav.settings");
    expect(HEADER).toContain('navigate({ name: "settings" })');
  });
});
