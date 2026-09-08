import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The global right rail (SPEC §16, the redesign phase 90).
 *
 * The mockup's right side is three flat tabs, not the workbench's five: In
 * this scene (the cast, scene-scoped and fed in by the chat screen), Characters
 * (the library with an inline editor) and Authors (the authors with an inline
 * editor). Lore moved to the left rail, and the persona moved into the scene
 * pane. This pins that shape.
 */

const APP = readFileSync(join(import.meta.dir, "..", "client", "App.tsx"), "utf8");
const RAIL = readFileSync(
  join(import.meta.dir, "..", "client", "components", "RightRail.tsx"),
  "utf8",
);
const CHAT = readFileSync(join(import.meta.dir, "..", "client", "screens", "ChatScreen.tsx"), "utf8");

describe("the global right rail", () => {
  test("is part of the shell, not a screen", () => {
    expect(APP).toContain("<RightRail />");
  });

  test("has the mockup's three tabs, not the workbench's five", () => {
    expect(RAIL).toContain("strings.rightRail.inThisScene");
    expect(RAIL).toContain("strings.rightRail.characters");
    expect(RAIL).toContain("strings.rightRail.authors");
    expect(RAIL).not.toContain("strings.nav.lorebooks");
    expect(RAIL).not.toContain("inspectorTab");
  });

  test("the scene tab shows the slot the chat screen fills", () => {
    expect(RAIL).toContain("sceneInspector");
  });

  test("characters and authors have search, a new button and the scene markers", () => {
    expect(RAIL).toContain("strings.characters.searchPlaceholder");
    expect(RAIL).toContain("useCreateCharacter");
    expect(RAIL).toContain("useCreateAuthor");
    expect(RAIL).toContain("strings.rightRail.inScene");
    expect(RAIL).toContain("strings.rightRail.inUse");
  });

  test("the author editor samples the aside voice", () => {
    expect(RAIL).toContain("strings.authors.sampleVoice");
  });

  test("the editors state the card's share of the window, and an author can be set on the scene", () => {
    expect(RAIL).toContain("strings.characters.cardContext");
    expect(RAIL).toContain("strings.authors.use");
    expect(RAIL).toContain("useUpdateScene");
  });
});

describe("the scene pane carries the cast and the scene's people", () => {
  test("the cast rail and the reader/author footer are one pane", () => {
    expect(CHAT).toContain("<CastRail");
    expect(CHAT).toContain("strings.rightRail.you");
    expect(CHAT).toContain("strings.rightRail.author");
  });

  test("the persona edits inline, the author in its own tab", () => {
    expect(CHAT).toContain("<PersonaEditPane");
    expect(CHAT).toContain("setRightTab(\"authors\")");
  });

  test("the nested inspector tabs are gone", () => {
    expect(CHAT).not.toContain("InspectorTab");
    expect(CHAT).not.toContain('from "../components/Inspector.tsx"');
  });
});
