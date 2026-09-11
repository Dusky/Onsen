import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The left icon rail and its section panel (the redesign, §20 phase 89).
 *
 * The mockup's left side is not the config sidebar the workbench built — a
 * recent list plus links. It is a 54px rail of four icons, and a panel beside
 * it carrying the chosen section: Prompt (the window being assembled), Preset
 * (the samplers), Lore (what fired), Guides (what is injected). This pins the
 * shape so the sidebar cannot quietly come back.
 *
 * Settings is not a fifth icon: it moved to the header, since it is a
 * destination rather than a section and could never show an active state
 * here (design review fix 4). The collapsed and open branches share one
 * icon-strip width, 54px, rather than the 44px the collapsed branch used to
 * narrow to — which slid every glyph sideways the moment the panel opened
 * (design review fix 3).
 */

const RAIL = readFileSync(
  join(import.meta.dir, "..", "client", "components", "LeftRail.tsx"),
  "utf8",
);

describe("the left side is an icon rail, not a sidebar", () => {
  test("four glyphs lead to four sections", () => {
    expect(RAIL).toContain("id: \"prompt\"");
    expect(RAIL).toContain("id: \"preset\"");
    expect(RAIL).toContain("id: \"lore\"");
    expect(RAIL).toContain("id: \"guides\"");
  });

  test("Settings is not a fifth section here (design review fix 4)", () => {
    expect(RAIL).not.toContain("strings.leftRail.settings");
    expect(RAIL).not.toContain('navigate({ name: "settings" })');
  });

  test("the sections are scene-scoped by reading the route", () => {
    expect(RAIL).toContain("useRoute");
    expect(RAIL).toContain('route.name === "chat" ? route.sceneId : null');
  });

  test("is collapsible", () => {
    expect(RAIL).toContain("useUiStore");
    expect(RAIL).toContain("leftRailOpen");
  });

  test("collapsed is a glyph rail, not a dead sliver", () => {
    // §149: the collapsed rail shows the sections, one tap away, instead of a
    // bare chevron that reveals nothing.
    expect(RAIL).toContain("toggleLeftRail();");
  });

  test("collapsed and open share one icon-strip width (design review fix 3)", () => {
    expect(RAIL).not.toContain("w-[44px]");
    expect(RAIL.match(/w-\[54px\]/g)?.length).toBe(2);
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

  test("the top states the window in one line, not a legend", () => {
    // One summary line — used / budget · % free — and the stripe carries the
    // colour, while the block list below carries the labels (§20 phase 129).
    expect(RAIL).toContain("promptSummary");
    expect(RAIL).not.toContain("leftRail.free");
  });

  test("blocks carry their provenance, and the lore trace and raw view are there", () => {
    expect(RAIL).toContain("placementOf");
    expect(RAIL).toContain("debug.loreTrace");
    expect(RAIL).toContain("strings.leftRail.viewRaw");
  });
});

const FIELDS = readFileSync(
  join(import.meta.dir, "..", "client", "components", "PresetEditor.tsx"),
  "utf8",
);

describe("the other sections are real, not placeholders", () => {
  /**
   * The rail's own comment has claimed since phase 106 that "the rail is the
   * editor, not a teaser that hides the rest behind a button". It was true of
   * the samplers and false of everything else: the context size, the automatic
   * retries, example eviction, squashed system turns, the prefill, the ops'
   * prompts and reasoning were all in `PresetFields`, which at desktop width
   * nothing could open — `SettingsScreen` drops its `generation` category on a
   * desktop precisely to leave this the one surface (§20 phase 169).
   *
   * So the assertion is the whole editor rather than a list of the parts the
   * rail happened to reimplement. A list of parts is how the gap survived:
   * every named part was present, and the ones nobody named were not.
   */
  test("preset is the whole editor, not a chosen subset of it", () => {
    expect(RAIL).toContain("<PresetFields");
    // And does not reimplement the half it used to.
    expect(RAIL).not.toContain("GROUPS.map");
    expect(RAIL).not.toContain("<Slider");
    expect(RAIL).not.toContain("download(preset");
  });

  test("which means every section a phone can reach, a desktop can", () => {
    for (const marker of [
      "strings.settings.samplers",
      "strings.settings.contextSize",
      "strings.settings.retries",
      "strings.settings.examples",
      "strings.settings.squashSystem",
      "strings.settings.precedence",
      "strings.settings.prefill",
      "strings.settings.utilityPrompts",
      "strings.settings.reasoningTitle",
      "strings.settings.exportPresetLabel",
      "strings.settings.presetMakeDefault",
    ]) {
      expect(FIELDS).toContain(marker);
    }
  });

  test("the scene's ban list stays the rail's own, because it is per scene", () => {
    expect(RAIL).toContain("useBans");
    expect(RAIL).toContain("useAddBan");
  });

  test("the preset tab is still a manager: make, import, choose, and a model", () => {
    expect(RAIL).toContain("useCreatePreset");
    expect(RAIL).toContain("useImportPreset");
    expect(RAIL).toContain("connectionProfileId");
    // Promote and remove moved with the rest into `PresetFields`.
    expect(FIELDS).toContain("useDeletePreset");
    expect(FIELDS).toContain("download(preset");
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

  test("the guides' prompts are editable without a scene", () => {
    // §149: the generated notes are per scene, but what each guide asks is
    // not — so outside a roleplay the Guides tab edits the prompts.
    expect(RAIL).toContain("<GuidePrompts");
    expect(RAIL).toContain("useUpdateTask");
    expect(RAIL).toContain('startsWith("guide_")');
  });
});
