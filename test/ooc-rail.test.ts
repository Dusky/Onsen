import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DOCK_DEFAULTS, DOCK_PANELS } from "@shared/types.ts";

/**
 * Off script lives in a rail on a desktop (§20 phase 177).
 *
 * Three shapes in three phases, which is the thing worth recording. It shipped
 * as a bottom sheet at every width. Phase 174 fixed `Sheet` app-wide and this
 * channel — having hand-rolled its own overlay — kept the bottom dock. Phase
 * 176 brought it through the shared shell, so it became a centred dialog. The
 * report on that was that a dialog was not wanted either: the off-script
 * exchange is held *while* reading, so it belongs beside the log rather than
 * over it.
 *
 * What that means structurally is that the channel is no longer a modal on a
 * desktop at all. It is a dock panel, which the rail dock rework (phase 173)
 * had already made possible without knowing it: a reader can move it to the
 * other rail or hide it, the same as the other seven.
 */

const CHAT = readFileSync(
  join(import.meta.dir, "..", "client", "screens", "ChatScreen.tsx"),
  "utf8",
);
const OOC = readFileSync(
  join(import.meta.dir, "..", "client", "components", "OocChannel.tsx"),
  "utf8",
);
const PANELS = readFileSync(
  join(import.meta.dir, "..", "client", "components", "DockPanels.tsx"),
  "utf8",
);
const UI = readFileSync(join(import.meta.dir, "..", "client", "state", "ui.ts"), "utf8");
const OPS = readFileSync(
  join(import.meta.dir, "..", "client", "screens", "chat", "useOps.tsx"),
  "utf8",
);
const LEFT = readFileSync(
  join(import.meta.dir, "..", "client", "components", "LeftRail.tsx"),
  "utf8",
);
const RIGHT = readFileSync(
  join(import.meta.dir, "..", "client", "components", "RightRail.tsx"),
  "utf8",
);

describe("it is a dock panel, not a modal", () => {
  test("the union and the shipped default both name it", () => {
    expect(DOCK_PANELS).toContain("ooc");
    expect(DOCK_DEFAULTS.right).toContain("ooc");
  });

  test("so a reader can move it or hide it like any other panel", () => {
    // Nothing special-cases `ooc` in either rail: both read their list from
    // the dock and look every panel up in the one registry.
    expect(LEFT).not.toContain('"ooc"');
    expect(RIGHT).not.toContain('"ooc"');
    expect(LEFT).toContain("PANEL_META[active]");
    expect(RIGHT).toContain("PANEL_META[active]");
  });

  test("and the registry gives it the composer op's own glyph", () => {
    expect(PANELS).toContain("MessageSquareOff");
  });
});

describe("the exchange came apart from its chrome", () => {
  test("OocExchange is the part that never changed", () => {
    expect(OOC).toContain("export function OocExchange");
    // The sheet is now a wrapper around the same component the rail hosts, so
    // the two ways in cannot drift apart.
    expect(OOC).toContain("<OocExchange {...exchange} />");
  });

  test("it fills what it is given and scrolls inside itself", () => {
    // The composer is pinned under the log, at 352px in a rail or 80dvh in a
    // sheet, so the height has to come from the parent either way.
    expect(OOC).toContain("flex h-full min-h-0 flex-col");
    expect(OOC).toContain("min-h-0 flex-1 overflow-y-auto");
  });

  test("and the composer wraps, because a rail can be dragged to 260px", () => {
    expect(OOC).toContain("flex-wrap");
  });
});

describe("the slot, because the exchange needs live scene state", () => {
  test("a second slot beside sceneInspector, filled desktop-only", () => {
    expect(UI).toContain("oocPanel: ReactNode | null;");
    expect(UI).toContain("setOocPanel(node: ReactNode | null): void;");
    expect(CHAT).toContain("setOocPanel(");
    expect(PANELS).toContain("export function OocPanel()");
  });

  test("it carries the streaming answer, which is why it cannot self-fetch", () => {
    expect(CHAT).toMatch(/pending=\{isGenerating && oocInFlight \?/);
  });

  test("and it is cleared when the chat unmounts", () => {
    expect(CHAT).toContain("setOocPanel(null);");
  });

  test("with something to say when no roleplay is open", () => {
    expect(PANELS).toContain("strings.ooc.noScene");
  });
});

describe("one way in, and it always works", () => {
  test("every entry point goes through openOoc", () => {
    expect(CHAT).toContain("const openOoc = ()");
    expect(CHAT).toContain('"ooc": openOoc,');
    expect(CHAT).toContain("onOpenOoc={openOoc}");
  });

  test("and nothing else in the client opens the sheet directly", () => {
    /*
     * The guard that was missing, and the browser found what it missed. This
     * file first asserted the two entry points it knew about — the palette
     * command and the inline "open channel" link — and passed while a third
     * was still wired straight to the sheet: the composer's own Off script op
     * in `useOps.tsx`, which is the way almost everyone actually opens it. So
     * the rail was built, shipped in the default, rendered its tab, and
     * clicking the op still raised the bottom sheet.
     *
     * Naming the call sites could not have caught that, because the one that
     * was wrong was the one nobody thought to name. Counting them can: the
     * whole client may contain exactly one `setOocOpen(true)`, and it is the
     * fallback inside `openOoc`.
     */
    const files = [
      ...readdirSync(join(import.meta.dir, "..", "client", "components")).map((name) =>
        join("client", "components", name),
      ),
      ...readdirSync(join(import.meta.dir, "..", "client", "screens"))
        .filter((name) => name.endsWith(".tsx"))
        .map((name) => join("client", "screens", name)),
      ...readdirSync(join(import.meta.dir, "..", "client", "screens", "chat")).map((name) =>
        join("client", "screens", "chat", name),
      ),
    ].filter((path) => path.endsWith(".tsx"));

    const opens = files.filter((path) =>
      readFileSync(join(import.meta.dir, "..", path), "utf8").includes("setOocOpen(true)"),
    );
    expect(opens).toEqual([join("client", "screens", "ChatScreen.tsx")]);
    expect(CHAT.match(/setOocOpen\(true\)/g)).toHaveLength(1);
    // And the ops grid — the op almost everyone uses — takes the decision
    // rather than the setter, so it cannot reach the sheet on its own.
    expect(OPS).toContain("openOoc();");
    expect(OPS).not.toContain("setOocOpen");
  });

  test("desktop selects the panel in whichever rail hosts it", () => {
    expect(CHAT).toContain('if (dock.right.includes("ooc")) {');
    expect(CHAT).toContain('if (dock.left.includes("ooc")) {');
    // Selecting a panel in a collapsed rail would open nothing visible.
    expect(CHAT).toContain("setRightRailOpen(true);");
    expect(CHAT).toContain("setLeftRailOpen(true);");
  });

  test("and falls back to the sheet wherever there is no rail to use", () => {
    // A phone, vanish mode, or a reader who hid the panel from both sides.
    expect(CHAT).toContain("if (isDesktop && !vanished) {");
    expect(CHAT).toContain("setOocOpen(true);");
  });

  test("both ways in start the same generation", () => {
    expect(CHAT).toContain("const startOoc = (question: string)");
    expect(CHAT).toContain("onStartOoc={startOoc}");
    expect(CHAT).toContain("onSend={startOoc}");
  });
});
