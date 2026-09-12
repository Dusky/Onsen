import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DOCK_DEFAULTS,
  DOCK_PANELS,
  DOCK_WIDTH_BOUNDS,
  readDock,
} from "@shared/types.ts";
import type { DockPanel } from "@shared/types.ts";
import {
  LEFT_PANEL_MIN_WIDTH,
  RIGHT_RAIL_MIN_WIDTH,
  autoCollapseBands,
} from "../client/lib/breakpoint.ts";

/**
 * The rail dock (§20 phase 173): any of the eight panels, on either rail, in
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
  test("the arrangement the rails used to hardcode, plus off script", () => {
    expect(DOCK_DEFAULTS.left).toEqual(["prompt", "preset", "lore", "guides"]);
    /*
     * `ooc` is the one panel this default has ever gained, in phase 177, and
     * the reason it is a default change rather than something a reader opts
     * into: the shape it replaced was wrong, not merely customisable. The
     * off-script channel was a modal docked to the bottom of the window at
     * every width, and a conversation held *while* reading belongs beside the
     * log. It joins the right rail because that is where the scene-scoped live
     * panels already are, and a tab costs nothing until it is selected.
     */
    expect(DOCK_DEFAULTS.right).toEqual(["scene", "characters", "authors", "ooc"]);
    // The two widths the rails used to hardcode.
    expect(DOCK_DEFAULTS.leftWidth).toBe(326);
    expect(DOCK_DEFAULTS.rightWidth).toBe(352);
  });

  test("every panel in the union has a registry entry to render", () => {
    // The union and the registry falling out of step would be a panel that
    // can be docked and cannot be drawn. Counted against the registry rather
    // than a literal, so adding a panel cannot leave this test behind.
    for (const id of DOCK_PANELS) expect(PANELS).toContain(`  ${id}: {`);
    const entries = [...PANELS.matchAll(/^  (\w+): \{$/gm)].map((match) => match[1]!);
    expect(entries.sort()).toEqual([...DOCK_PANELS].sort());
  });

  test("every default is a panel the union actually names", () => {
    // The other direction: a typo in a default list would hide a rail rather
    // than fail anywhere, since `readDock` drops what it does not recognise.
    for (const id of [...DOCK_DEFAULTS.left, ...DOCK_DEFAULTS.right]) {
      expect(DOCK_PANELS).toContain(id);
    }
  });
});

describe("readDock falls back per field rather than refusing the lot", () => {
  /** Every panel accounted for, which is what the editor always writes. */
  const complete = (left: DockPanel[], right: DockPanel[]) => ({
    left,
    right,
    hidden: DOCK_PANELS.filter((id) => !left.includes(id) && !right.includes(id)),
  });

  test("a panel named on both sides lands on exactly one", () => {
    const dock = readDock(complete(["prompt", "scene"], ["scene", "characters"]));
    // The right side wins it, so the left drops it — never drawn twice.
    expect(dock.left).toEqual(["prompt"]);
    expect(dock.right).toEqual(["scene", "characters"]);
    expect(dock.left.filter((id) => dock.right.includes(id))).toEqual([]);
  });

  test("a panel on a side is never also hidden", () => {
    // The same contradiction in the other pair of lists, resolved the less
    // destructive way: a visible panel stays visible.
    const dock = readDock({ left: ["prompt"], right: ["scene"], hidden: ["prompt", "authors"] });
    expect(dock.left).toContain("prompt");
    expect(dock.hidden).not.toContain("prompt");
    expect(dock.hidden).toContain("authors");
  });

  test("an empty side stays empty — moving everything off a rail is a choice", () => {
    // The bug this pins: treating `[]` as "nothing was sent" and helpfully
    // restoring the default would make a deliberately emptied rail keep
    // coming back. Stated with every panel accounted for, which is what the
    // editor writes — an unaccounted panel is a different case, below.
    const dock = readDock(complete([], ["scene"]));
    expect(dock.left).toEqual([]);
    expect(dock.right).toEqual(["scene"]);
  });

  test("a panel hidden on purpose stays hidden", () => {
    const dock = readDock(complete(["prompt"], ["scene"]));
    expect([...dock.left, ...dock.right]).not.toContain("authors");
    expect(dock.hidden).toContain("authors");
  });

  test("a panel accounted for nowhere is new, and lands where it belongs", () => {
    /*
     * The upgrade path, and the bug that made it worth a field (§20 phase
     * 177). Hiding used to be an absence, so a stored preference could not
     * tell "the reader hid this" from "this did not exist yet" — and when
     * `ooc` shipped in `DOCK_DEFAULTS`, every install that had ever saved a
     * dock preference had a stored pair of lists that did not name it. The
     * rail rendered three tabs and the new panel reached nobody.
     *
     * Found by booting against the real database rather than by reasoning:
     * the tests passed and the browser showed three tabs.
     */
    const dock = readDock({ left: ["prompt"], right: ["scene"], hidden: ["authors"] });
    expect(dock.right).toContain("ooc");
    expect(dock.left).toContain("preset");
    expect(dock.hidden).toEqual(["authors"]);
    // Everything is somewhere, which is the invariant that makes this work.
    const placed = [...dock.left, ...dock.right, ...dock.hidden];
    expect(placed.sort()).toEqual([...DOCK_PANELS].sort());
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
