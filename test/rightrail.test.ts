import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DOCK_DEFAULTS } from "@shared/types.ts";

/**
 * The global right rail (SPEC §16, the redesign phase 90; re-pointed at the
 * dock registry by phase 173).
 *
 * The mockup's right side is three flat tabs, not the workbench's five: In
 * this scene (the cast, scene-scoped and fed in by the chat screen), Characters
 * (the library with an inline editor) and Authors (the authors with an inline
 * editor). Lore moved to the left rail, and the persona moved into the scene
 * pane. This pins that shape.
 *
 * Phase 173 moved the three panel bodies into `DockPanels.tsx`, shared with
 * the left rail because either rail may now host any of the seven, and made
 * the tab list a stored arrangement rather than a literal. The shape is
 * asserted against `DOCK_DEFAULTS` for that reason: three tabs is still the
 * answer, it is just now the *default* answer rather than the only one.
 */

const APP = readFileSync(join(import.meta.dir, "..", "client", "App.tsx"), "utf8");
const RAIL = readFileSync(
  join(import.meta.dir, "..", "client", "components", "RightRail.tsx"),
  "utf8",
);
const PANELS = readFileSync(
  join(import.meta.dir, "..", "client", "components", "DockPanels.tsx"),
  "utf8",
);
const CHAT = readFileSync(join(import.meta.dir, "..", "client", "screens", "ChatScreen.tsx"), "utf8");
const SCENE_PANE = readFileSync(
  join(import.meta.dir, "..", "client", "screens", "chat", "ScenePane.tsx"),
  "utf8",
);

describe("the global right rail", () => {
  test("is part of the shell, not a screen", () => {
    expect(APP).toContain("<RightRail />");
  });

  test("collapsed is an icon rail, not a dead sliver", () => {
    // §149: linework icons, one tap to expand onto the tab. The icons
    // themselves moved to the registry with the panels they belong to.
    expect(RAIL).toContain("PANEL_META");
    expect(RAIL).toContain("w-[44px]");
    expect(PANELS).toContain('from "lucide-react"');
  });

  test("has the mockup's tabs by default, not the workbench's five", () => {
    // Three by default until phase 177 added off script, which is a different
    // thing from the workbench's five: those were a navigation tree stuffed
    // into a rail. These are the panels scoped to the scene being read.
    expect(DOCK_DEFAULTS.right).toEqual(["scene", "characters", "authors", "ooc"]);
    expect(PANELS).toContain("strings.rightRail.inThisScene");
    expect(PANELS).toContain("strings.rightRail.characters");
    expect(PANELS).toContain("strings.rightRail.authors");
    expect(PANELS).toContain("strings.ooc.title");
    expect(RAIL).not.toContain("strings.nav.lorebooks");
    expect(RAIL).not.toContain("inspectorTab");
  });

  test("the tab row scrolls rather than clipping what will not fit", () => {
    // Four tabs exceed the 352px default width, and the dock editor has let a
    // reader put all eight on one side since phase 173 — so this row always
    // had to hold more than it was drawn for.
    expect(RAIL).toContain("overflow-x-auto");
    expect(RAIL).toContain("shrink-0");
    expect(RAIL).toContain("whitespace-nowrap");
  });

  test("the scene and off-script tabs show the slots the chat screen fills", () => {
    expect(PANELS).toContain("sceneInspector");
    expect(PANELS).toContain("oocPanel");
  });

  test("a panel that owns its height is not wrapped in the rail's scroll", () => {
    // `ooc` pins a composer under a scrolling log; a rail-level scroll
    // container would carry the composer off the bottom edge.
    expect(PANELS).toContain("fills: true");
    expect(RAIL).toContain("meta.fills");
  });

  test("characters and authors have search, a new button and the scene markers", () => {
    expect(PANELS).toContain("strings.characters.searchPlaceholder");
    expect(PANELS).toContain("useCreateCharacter");
    expect(PANELS).toContain("useCreateAuthor");
    expect(PANELS).toContain("strings.rightRail.inScene");
    expect(PANELS).toContain("strings.rightRail.inUse");
  });

  test("the characters panel adds and removes cast members", () => {
    // The library panel is where a roleplay's roster is managed: someone in
    // the scene gets a remove, everyone else gets an add (§20 phase 183).
    expect(PANELS).toContain("useAddToCast");
    expect(PANELS).toContain("useRemoveFromCast");
    expect(PANELS).toContain("strings.rightRail.add");
    expect(PANELS).toContain("strings.rightRail.remove");
  });

  test("the author editor samples the aside voice", () => {
    expect(PANELS).toContain("strings.authors.sampleVoice");
  });

  test("the editors state the card's share of the window, and an author can be set on the scene", () => {
    expect(PANELS).toContain("strings.characters.cardContext");
    expect(PANELS).toContain("strings.authors.use");
    expect(PANELS).toContain("useUpdateScene");
  });
});

describe("the scene pane carries the cast and the scene's people", () => {
  test("the cast rail and the reader/author footer are one pane", () => {
    // The pane lives beside the screen (§20 phase 149); the screen wires it.
    expect(CHAT).toContain("<ScenePane");
    expect(SCENE_PANE).toContain("<CastRail");
    expect(SCENE_PANE).toContain("strings.rightRail.you");
    expect(SCENE_PANE).toContain("strings.rightRail.author");
  });

  test("the persona edits inline, the author in its own tab", () => {
    expect(SCENE_PANE).toContain("<PersonaEditPane");
    // Named for the side rather than the tab since phase 173: any of the
    // seven panels can be the one showing there.
    expect(CHAT).toContain('setRightActive("authors")');
  });

  test("the nested inspector tabs are gone", () => {
    expect(CHAT).not.toContain("InspectorTab");
    expect(CHAT).not.toContain('from "../components/Inspector.tsx"');
  });
});
