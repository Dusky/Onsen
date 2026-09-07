import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The left icon rail and its section panel (the redesign, §20 phase 89).
 *
 * The mockup's left side is not the config sidebar the workbench built — a
 * recent list plus links. It is a 46px rail of five icons, and a panel beside
 * it carrying the chosen section: Prompt (the window being assembled), Preset
 * (the samplers), Lore (what fired), Guides (what is injected). This pins the
 * shape so the sidebar cannot quietly come back.
 */

const RAIL = readFileSync(
  join(import.meta.dir, "..", "client", "components", "LeftRail.tsx"),
  "utf8",
);

describe("the left side is an icon rail, not a sidebar", () => {
  test("five glyphs lead to five places", () => {
    expect(RAIL).toContain("id: \"prompt\"");
    expect(RAIL).toContain("id: \"preset\"");
    expect(RAIL).toContain("id: \"lore\"");
    expect(RAIL).toContain("id: \"guides\"");
    expect(RAIL).toContain("strings.leftRail.settings");
  });

  test("the sections are scene-scoped by reading the route", () => {
    expect(RAIL).toContain("useRoute");
    expect(RAIL).toContain('route.name === "chat" ? route.sceneId : null');
  });

  test("is collapsible", () => {
    expect(RAIL).toContain("useUiStore");
    expect(RAIL).toContain("leftRailOpen");
  });
});

describe("the prompt panel shows the window, not a link", () => {
  test("it assembles the next turn's prompt, block by block", () => {
    expect(RAIL).toContain("usePreviewPrompt");
    expect(RAIL).toContain("debug.blocks");
  });

  test("the budget bar and the evictions are on the same panel", () => {
    expect(RAIL).toContain("<BudgetBar");
    expect(RAIL).toContain("debug.evicted");
    expect(RAIL).toContain("strings.chat.inspectorEvicted");
  });

  test("blocks carry their provenance, and the lore trace and raw view are there", () => {
    expect(RAIL).toContain("placementOf");
    expect(RAIL).toContain("debug.loreTrace");
    expect(RAIL).toContain("strings.leftRail.viewRaw");
  });
});

describe("the other sections are real, not placeholders", () => {
  test("preset carries the samplers and the scene's ban list", () => {
    expect(RAIL).toContain("PANEL_SAMPLERS");
    expect(RAIL).toContain("<Slider");
    expect(RAIL).toContain("useBans");
    expect(RAIL).toContain("useAddBan");
  });

  test("lore is editable without a scene, and guides can be written, reordered and flushed", () => {
    expect(RAIL).toContain("useLoreActivation");
    expect(RAIL).toContain("<LorePane");
    expect(RAIL).toContain("<GuidesBody");
    expect(RAIL).toContain("onMove");
    expect(RAIL).toContain("useRebuildGuides");
    expect(RAIL).toContain("useFlushGuides");
  });

  test("the prompt is editable without a scene", () => {
    expect(RAIL).toContain("<PromptManager");
    expect(RAIL).toContain('sceneId === null');
  });
});
