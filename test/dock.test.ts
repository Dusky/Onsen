import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DOCK_DEFAULTS,
  DOCK_PANELS,
  DOCK_WIDTH_BOUNDS,
  readDock,
} from "@shared/types.ts";
import {
  LEFT_PANEL_MIN_WIDTH,
  RIGHT_RAIL_MIN_WIDTH,
  autoCollapseBands,
} from "../client/lib/breakpoint.ts";

/**
 * The rail dock (§20 phase 173): any of the seven panels, on either rail, in
 * any order, at a width the reader sets.
 *
 * Mostly structural like the rest of this project's UI guards, but not
 * entirely — `readDock` and `autoCollapseBands` are pure functions with real
 * decisions in them (what a panel named twice means, what an empty side
 * means, where a collapse band lands once a width moves), so those are
 * called rather than read as text. Source-as-text is for the wiring around
 * them.
 */

const ROOT = join(import.meta.dir, "..");
const SHARED = readFileSync(join(ROOT, "shared", "types.ts"), "utf8");
const SYSTEM = readFileSync(join(ROOT, "server", "routes", "system.ts"), "utf8");
const QUERIES = readFileSync(join(ROOT, "client", "lib", "queries.ts"), "utf8");
const PANELS = readFileSync(join(ROOT, "client", "components", "DockPanels.tsx"), "utf8");
const LEFT = readFileSync(join(ROOT, "client", "components", "LeftRail.tsx"), "utf8");
const RIGHT = readFileSync(join(ROOT, "client", "components", "RightRail.tsx"), "utf8");
const EDITOR = readFileSync(join(ROOT, "client", "components", "DockEditor.tsx"), "utf8");
const UI_STATE = readFileSync(join(ROOT, "client", "state", "ui.ts"), "utf8");

describe("the default is what the app already was", () => {
  test("today's exact arrangement, so nothing moves until somebody moves it", () => {
    expect(DOCK_DEFAULTS.left).toEqual(["prompt", "preset", "lore", "guides"]);
    expect(DOCK_DEFAULTS.right).toEqual(["scene", "characters", "authors"]);
    // The two widths the rails used to hardcode.
    expect(DOCK_DEFAULTS.leftWidth).toBe(326);
    expect(DOCK_DEFAULTS.rightWidth).toBe(352);
  });

  test("every panel in the union has a registry entry to render", () => {
    // The union and the registry falling out of step would be a panel that
    // can be docked and cannot be drawn.
    for (const id of DOCK_PANELS) expect(PANELS).toContain(`  ${id}: {`);
    expect(DOCK_PANELS.length).toBe(7);
  });
});

describe("readDock falls back per field rather than refusing the lot", () => {
  test("a panel named on both sides lands on exactly one", () => {
    const dock = readDock({ left: ["prompt", "scene"], right: ["scene", "characters"] });
    expect(dock.left).toEqual(["prompt"]);
    expect(dock.right).toEqual(["scene", "characters"]);
  });

  test("an empty side stays empty — moving everything off a rail is a choice", () => {
    // The bug this pins: treating `[]` as "nothing was sent" and helpfully
    // restoring the default would make a deliberately emptied rail keep
    // coming back.
    expect(readDock({ left: [], right: ["scene"] }).left).toEqual([]);
  });

  test("a panel named nowhere is hidden, not an error", () => {
    const dock = readDock({ left: ["prompt"], right: ["scene"] });
    const placed = [...dock.left, ...dock.right];
    expect(placed).not.toContain("authors");
  });

  test("nonsense falls back to the default instead of throwing", () => {
    expect(readDock({ left: ["not-a-panel"] as unknown as [] }).left).toEqual(DOCK_DEFAULTS.left);
    expect(readDock({}).right).toEqual(DOCK_DEFAULTS.right);
  });

  test("widths clamp to the bounds and stay whole pixels", () => {
    const [min, max] = DOCK_WIDTH_BOUNDS;
    expect(readDock({ leftWidth: 10 }).leftWidth).toBe(min);
    expect(readDock({ rightWidth: 9000 }).rightWidth).toBe(max);
    expect(readDock({ leftWidth: 300.6 }).leftWidth).toBe(301);
    expect(readDock({ leftWidth: Number.NaN }).leftWidth).toBe(DOCK_DEFAULTS.leftWidth);
  });

  test("it is exported for both sides of the wire to share", () => {
    expect(SHARED).toContain("export function readDock");
    expect(SHARED).toContain("export const DOCK_DEFAULTS");
  });
});

describe("the server stores it like every other preference", () => {
  test("read back through the validator, not trusted as stored", () => {
    expect(SYSTEM).toContain("function dock(): DockDto");
    expect(SYSTEM).toMatch(/function dock\(\)[\s\S]{0,700}readDock\(\{/);
  });

  test("a patch merges onto what is stored, so one move does not reset the rest", () => {
    expect(SYSTEM).toContain("readDock({ ...dock(), ...(value as Record<string, unknown>) })");
  });

  test("it travels in the preferences payload and in a settings file", () => {
    expect(SYSTEM).toContain("dock: dock(),");
    expect(SYSTEM).toContain('applyDock(body["dock"])');
    expect(SYSTEM).toContain('["dock", applyDock]');
  });

  test("the client reads it with the shipped arrangement standing in", () => {
    expect(QUERIES).toContain("export function useDock(): DockDto");
    expect(QUERIES).toContain("usePreferences().data?.dock ?? DOCK_DEFAULTS");
  });
});

describe("the rails render an arrangement, not a list they own", () => {
  for (const [name, source, side] of [
    ["LeftRail", LEFT, "left"],
    ["RightRail", RIGHT, "right"],
  ] as const) {
    test(`${name} takes its panels and its width from the dock`, () => {
      expect(source).toContain("useDock()");
      expect(source).toContain(`dock.${side}`);
      expect(source).toContain(`dock.${side}Width`);
    });

    test(`${name} draws nothing at all when its side is empty`, () => {
      // A hollow icon column with no icons in it is worse than no rail.
      expect(source).toContain("if (panels.length === 0) return null;");
    });

    test(`${name} falls back when the remembered panel is no longer its own`, () => {
      // Moving the active panel to the other side must not leave this one
      // rendering a blank body.
      expect(source).toContain("panels.includes(storedActive) ? storedActive : panels[0]!");
    });
  }

  test("neither rail keeps the width it used to hardcode", () => {
    for (const source of [LEFT, RIGHT]) {
      expect(source).not.toContain("w-[326px]");
      expect(source).not.toContain("w-[352px]");
    }
  });

  test("the store remembers a panel per side, not a fixed union per side", () => {
    expect(UI_STATE).toContain("leftActive: DockPanel;");
    expect(UI_STATE).toContain("rightActive: DockPanel;");
    expect(UI_STATE).not.toContain("leftSection");
    expect(UI_STATE).not.toContain("rightTab");
  });
});

describe("the collapse bands follow the widths", () => {
  test("at the shipped widths they are exactly the two figures already in use", () => {
    const bands = autoCollapseBands(DOCK_DEFAULTS.leftWidth, DOCK_DEFAULTS.rightWidth);
    expect(bands.rightRailMinWidth).toBe(RIGHT_RAIL_MIN_WIDTH);
    expect(bands.leftPanelMinWidth).toBe(LEFT_PANEL_MIN_WIDTH);
  });

  test("a wider rail needs that many more px of window, and a narrower one fewer", () => {
    const wider = autoCollapseBands(DOCK_DEFAULTS.leftWidth + 40, DOCK_DEFAULTS.rightWidth + 10);
    expect(wider.rightRailMinWidth).toBe(RIGHT_RAIL_MIN_WIDTH + 50);
    // The right rail is already shut by the time the left band matters, so
    // only the left panel's own width moves it.
    expect(wider.leftPanelMinWidth).toBe(LEFT_PANEL_MIN_WIDTH + 40);
  });
});

describe("the editor is an opt-in, and it does not drag", () => {
  test("three-way per panel, reordered with the buttons this app already uses", () => {
    expect(EDITOR).toContain("<Segmented");
    expect(EDITOR).toContain("strings.settings.blockUp");
    expect(EDITOR).toContain("strings.settings.blockDown");
  });

  test("no drag-and-drop, per the house rule PromptManager already states", () => {
    for (const marker of ["draggable", "onDragStart", "onDragOver", "onDrop"]) {
      expect(EDITOR).not.toContain(marker);
    }
  });

  test("it can always be put back, so an arrangement is never a trap", () => {
    expect(EDITOR).toContain("set(DOCK_DEFAULTS)");
  });

  test("desktop only — the rails it edits do not exist on a phone", () => {
    expect(EDITOR).toContain("useIsDesktop");
    expect(EDITOR).toContain("if (!isDesktop) return null;");
  });
});
