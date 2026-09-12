import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * A sheet is a dialog on a desktop and a sheet on a phone (§20 phases 174, 176).
 *
 * `Sheet` is the app's one modal primitive — 56 usages across 32 files plus
 * every `useConfirm()` question — and it shipped bottom-anchored at every
 * width. A bottom sheet is the right gesture where a thumb is reaching; a
 * phone shape stretched across a 1600px screen, rising from the edge
 * furthest from where a mouse-and-keyboard reader is looking, is not. This
 * came from use rather than review, which is why it is its own phase.
 *
 * The desktop treatment is `CommandPalette`'s, not a third one: top-anchored,
 * horizontally centred, square, plainly bordered. Asserted here so the two
 * modals cannot quietly diverge again.
 *
 * Phase 176 is the other half, and the reason this file grew: fixing `Sheet`
 * fixed every modal that *used* `Sheet`, and the off-script channel had
 * hand-rolled the same overlay for itself — so it alone kept docking to the
 * bottom of a desktop window after every other sheet had stopped. The shape
 * now lives in one exported `SheetShell`, and the last group of tests here is
 * the one that matters going forward: it sweeps the whole component directory
 * so the next modal with an unusual interior cannot copy the phone shape
 * instead of composing it.
 */

const COMPONENTS = join(import.meta.dir, "..", "client", "components");
const read = (name: string) => readFileSync(join(COMPONENTS, name), "utf8");

const SHEET = read("Sheet.tsx");
const PALETTE = read("CommandPalette.tsx");
const OOC = read("OocChannel.tsx");

/** The one string that anchors a modal to the bottom of the window. */
const BOTTOM_ANCHOR = "flex flex-col justify-end";

describe("it knows which shape it is", () => {
  test("by asking the same breakpoint the rest of the shell asks", () => {
    expect(SHEET).toContain("useIsDesktop");
  });

  test("and it asks once, in the shell both modals compose", () => {
    expect(SHEET).toContain("export function SheetShell");
    expect(SHEET).toContain("export function Sheet(");
    // `Sheet` is now a header and a scroll around the shell, nothing more.
    expect(SHEET).toContain("<SheetShell label={title} tone={tone} onClose={onClose}>");
  });
});

describe("the phone keeps the sheet", () => {
  test("bottom-anchored, with the rounded top the design allows it", () => {
    expect(SHEET).toContain(BOTTOM_ANCHOR);
    expect(SHEET).toContain('"16px 16px 0 0"');
  });

  test("and the safe-area allowance, which is a phone concern", () => {
    expect(SHEET).toContain("env(safe-area-inset-bottom)");
  });
});

describe("the desktop gets a dialog", () => {
  test("top-anchored and centred, the treatment the palette already uses", () => {
    const DESKTOP_ANCHOR = "flex items-start justify-center px-[16px] pt-[64px]";
    expect(SHEET).toContain(DESKTOP_ANCHOR);
    // Character for character the same, so "the palette's treatment" stays a
    // fact rather than a claim in a comment.
    expect(PALETTE).toContain(DESKTOP_ANCHOR);
  });

  test("square, because only a phone sheet earns a rounded corner", () => {
    expect(SHEET).toMatch(/borderRadius: isDesktop \? "0"/);
  });

  test("it hugs its content instead of running to the bottom edge", () => {
    /*
     * The bug: a row flex stretches its children on the cross axis, so the
     * dialog measured 886px of a 950px window and sat against the bottom —
     * the complaint this phase answers, arrived at a different way.
     *
     * The palette had it too, and less visibly: its panel carries
     * `max-h-[70vh]`, which under a stretch is a *fixed* height, so filtering
     * the list down to one command still left a 665px box that was almost all
     * empty. Both are `items-start` now, which is why the assertion above
     * compares the two strings whole.
     */
    expect(SHEET).toContain("items-start");
    expect(PALETTE).toContain("items-start");
  });

  test("all four borders, set as one shorthand and never half-cleared", () => {
    /*
     * The second bug: React writes a style key whose value is `undefined` as
     * an empty string, which removes that longhand. Pairing `border` with
     * `borderTop: undefined` expanded the shorthand and then cleared the top
     * edge, so the dialog rendered with three borders and an open top.
     * Spreading a per-branch object keeps the key absent instead.
     */
    expect(SHEET).toContain("...(isDesktop");
    expect(SHEET).not.toMatch(/borderTop: isDesktop\s*\?\s*undefined/);
  });
});

describe("the off-script channel is a dialog too", () => {
  test("it composes the shell rather than drawing its own overlay", () => {
    expect(OOC).toContain('import { SheetShell } from "./Sheet.tsx"');
    expect(OOC).toContain("<SheetShell");
    // The whole exchange is the author speaking as itself.
    expect(OOC).toContain('tone="blue"');
  });

  test("and holds no opinion of its own about where a modal sits", () => {
    // Every one of these was in this file, and every one is the shell's now.
    expect(OOC).not.toContain(BOTTOM_ANCHOR);
    expect(OOC).not.toContain("fixed inset-0");
    expect(OOC).not.toContain("16px 16px 0 0");
    expect(OOC).not.toContain("env(safe-area-inset-bottom)");
    expect(OOC).not.toContain('role="dialog"');
  });

  test("its interior is the part a plain Sheet cannot hold", () => {
    // A scrolling exchange with a composer pinned under it: the height cap is
    // on the panel, so the log takes what is left and the composer stays put.
    expect(OOC).toContain("max-h-[80dvh]");
    expect(OOC).toContain("min-h-0 flex-1 overflow-y-auto");
  });

  test("Escape is the shell's, so a sheet on top of it closes alone", () => {
    // It used to be a bare `window` keydown listener here, which meant a
    // confirmation opened over the channel closed both on one press.
    expect(OOC).not.toContain('event.key === "Escape"');
    expect(SHEET).toContain("useModalFocus(dialog, onClose)");
  });
});

describe("nothing else hand-rolls the phone shape", () => {
  /*
   * The guard that would have caught phase 176 in phase 174. `OocChannel`
   * predated `Sheet`'s fix by a long way and simply never came through it, so
   * a one-file fix looked complete and was not. A sweep is the only version of
   * this test that holds: it fails on the *next* file to copy the overlay,
   * which is the one nobody will think to add a test for.
   */
  const files = readdirSync(COMPONENTS).filter((name) => name.endsWith(".tsx"));

  test("the component directory is actually being read", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain("Sheet.tsx");
    expect(files).toContain("OocChannel.tsx");
  });

  test("only the shell anchors anything to the bottom of the window", () => {
    const anchored = files.filter((name) => read(name).includes(BOTTOM_ANCHOR));
    expect(anchored).toEqual(["Sheet.tsx"]);
  });

  test("only the shell claims a rounded top corner", () => {
    // One of exactly two places the design allows a radius, and it is a phone
    // concern — so it belongs to whoever decides the phone shape.
    const rounded = files.filter((name) => read(name).includes("16px 16px 0 0"));
    expect(rounded).toEqual(["Sheet.tsx"]);
  });

  test("a full-screen overlay is the shell, the palette, or a route", () => {
    /*
     * `fixed inset-0` is how a modal covers the window, and three files are
     * entitled to it: the shell, the palette, and `Background`, which paints
     * the scene's artwork behind everything and is not a modal at all.
     * `RouteOverlay` uses `absolute inset-0` inside the shell's own layer, so
     * it is not in this list by construction.
     */
    const overlays = files.filter((name) => read(name).includes("fixed inset-0"));
    expect(overlays.sort()).toEqual(["Background.tsx", "CommandPalette.tsx", "Sheet.tsx"]);
  });
});
