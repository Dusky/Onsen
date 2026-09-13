import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DOCK_DEFAULTS } from "@shared/types.ts";

/**
 * The left icon rail and its section panel (the redesign, §20 phase 89;
 * re-pointed at the dock registry by phase 173).
 *
 * The mockup's left side is not the config sidebar the workbench built — a
 * recent list plus links. It is a 54px rail of icons, and a panel beside it
 * carrying the chosen section: Prompt (the window being assembled), Preset
 * (the samplers), Lore (what fired), Guides (what is injected). This pins the
 * shape so the sidebar cannot quietly come back.
 *
 * What changed in phase 173 is *where each half lives*, not what either half
 * says. The rail file owns the rail's own chrome; the four panels it used to
 * declare inline are now in `DockPanels.tsx`, shared with the right rail
 * because either of them may host any of the seven. So the panel assertions
 * below read that file, and the shape assertions read `DOCK_DEFAULTS` — the
 * arrangement is now a stated default rather than a hardcoded list, and the
 * default is the thing worth pinning.
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
const PANELS = readFileSync(
  join(import.meta.dir, "..", "client", "components", "DockPanels.tsx"),
  "utf8",
);

describe("the left side is an icon rail, not a sidebar", () => {
  test("the sections are whatever the default says, and nothing is hardcoded", () => {
    // Four until phase 178 added Models. The point of this test was never the
    // number: it is that the old sidebar cannot come back as a hardcoded list,
    // which is why it reads the default rather than counting glyphs.
    expect(DOCK_DEFAULTS.left).toEqual(["prompt", "preset", "models", "lore", "guides"]);
    // Each one is a real entry in the registry the rail renders from, not a
    // name the arrangement mentions and nothing answers to.
    for (const id of DOCK_DEFAULTS.left) expect(PANELS).toContain(`  ${id}: {`);
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
    expect(PANELS).toContain("usePreviewPrompt");
    expect(PANELS).toContain("debug.blocks");
  });

  test("the budget bar and the evictions are on the same panel", () => {
    expect(PANELS).toContain("<BudgetBar");
    expect(PANELS).toContain("debug.evicted");
    expect(PANELS).toContain("strings.chat.inspectorEvicted");
  });

  test("the top states the window in one line, not a legend", () => {
    // One summary line — used / budget · % free — and the stripe carries the
    // colour, while the block list below carries the labels (§20 phase 129).
    expect(PANELS).toContain("promptSummary");
    expect(PANELS).not.toContain("leftRail.free");
  });

  test("blocks carry their provenance, and the lore trace and raw view are there", () => {
    expect(PANELS).toContain("placementOf");
    expect(PANELS).toContain("debug.loreTrace");
    expect(PANELS).toContain("strings.leftRail.viewRaw");
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
    expect(PANELS).toContain("<PresetFields");
    // And does not reimplement the half it used to.
    expect(PANELS).not.toContain("GROUPS.map");
    expect(PANELS).not.toContain("<Slider");
    expect(PANELS).not.toContain("download(preset");
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

  test("the scene's ban list stays the panel's own, because it is per scene", () => {
    expect(PANELS).toContain("useBans");
    expect(PANELS).toContain("useAddBan");
  });

  test("the preset tab is still a manager: make, import, choose, and a model", () => {
    expect(PANELS).toContain("useCreatePreset");
    expect(PANELS).toContain("useImportPreset");
    expect(PANELS).toContain("connectionProfileId");
    // Promote and remove moved with the rest into `PresetFields`.
    expect(FIELDS).toContain("useDeletePreset");
    expect(FIELDS).toContain("download(preset");
  });

  test("lore is editable without a scene, and guides can be written, reordered and flushed", () => {
    expect(PANELS).toContain("useLoreActivation");
    expect(PANELS).toContain("<LorePane");
    expect(PANELS).toContain("<GuidesBody");
    expect(PANELS).toContain("onMove");
    expect(PANELS).toContain("useRebuildGuides");
    expect(PANELS).toContain("useFlushGuides");
  });

  test("the prompt is editable without a scene", () => {
    expect(PANELS).toContain("<PromptManager");
    expect(PANELS).toContain("sceneId === null");
  });

  test("the guides' prompts are editable without a scene", () => {
    // §149: the generated notes are per scene, but what each guide asks is
    // not — so outside a roleplay the Guides tab edits the prompts.
    expect(PANELS).toContain("<GuidePrompts");
    expect(PANELS).toContain("useUpdateTask");
    expect(PANELS).toContain('startsWith("guide_")');
  });
});
