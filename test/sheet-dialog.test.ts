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
     * `fixed inset-0` is how a modal covers the window, and four files are
     * entitled to it: the shell, the palette and its sibling the global
     * search (both keyboard-first full-screen dialogs, distinct from the
     * bottom-sheet `Sheet`), and `Background`, which paints the scene's
     * artwork behind everything and is not a modal at all. `RouteOverlay`
     * uses `absolute inset-0` inside the shell's own layer, so it is not in
     * this list by construction.
     */
    const overlays = files.filter((name) => read(name).includes("fixed inset-0"));
    expect(overlays.sort()).toEqual([
      "Background.tsx",
      "CommandPalette.tsx",
      "SearchOverlay.tsx",
      "Sheet.tsx",
    ]);
  });
});

/**
 * A modal's focus hook only ever runs while the modal is open (§20 phase 223).
 *
 * `useModalFocus` takes the element that opened the modal from
 * `document.activeElement` on its **first render**, and puts focus back there in
 * its **unmount cleanup**. Both halves assume the component is mounted when the
 * modal opens and unmounted when it closes. A component that instead mounts
 * once and returns null while closed satisfies neither: it captures whatever
 * was focused when the app booted, and its cleanup never runs at all.
 *
 * That shipped. `SearchOverlay` read `searchOpen`, called the hook, and then
 * `if (!open) return null` — and closing the search dropped focus on `<body>`
 * where the command palette, mounted conditionally, restores the button that
 * opened it. Measured, not read: `BUTTON[Search]` → Escape → `BODY`.
 *
 * The guard that was in place could not see it, because it was a list of
 * filenames allowed to use `fixed inset-0` and the new file was added to the
 * list. So this one sweeps for the shape instead: whatever function calls the
 * hook must not be able to render nothing, because that is what "mounted while
 * closed" looks like in source. Split the gate into a parent, as
 * `SearchOverlay` now does, and the hook lives in a component that only exists
 * while it is open.
 */
describe("a modal is mounted only while it is open", () => {
  const files = readdirSync(COMPONENTS).filter((name) => name.endsWith(".tsx"));

  /** The body of the function containing `useModalFocus`, source-sliced. */
  function hookOwner(source: string): string {
    const call = source.indexOf("useModalFocus(");
    if (call === -1) return "";
    // Back to the nearest function header, forward to its closing brace at
    // column zero — enough structure for a file written in this repo's style.
    const header = source.lastIndexOf("\nfunction ", call);
    const exported = source.lastIndexOf("\nexport function ", call);
    const from = Math.max(header, exported);
    const close = source.indexOf("\n}", call);
    return from === -1 || close === -1 ? source : source.slice(from, close);
  }

  test("nothing that calls useModalFocus can render nothing", () => {
    const callers = files.filter((name) => read(name).includes("useModalFocus("));
    // The sweep has to find the modals, or it is passing over an empty set.
    expect(callers.length).toBeGreaterThanOrEqual(3);

    const selfGating = callers.filter((name) => /return null/.test(hookOwner(read(name))));
    expect(selfGating).toEqual([]);
  });

  test("and the hook is what every one of them uses", () => {
    // The other half of the rule: a modal that hand-rolls focus instead is not
    // caught by the test above, and `OocChannel` was exactly that once.
    const dialogs = files.filter((name) => read(name).includes('role="dialog"'));
    const missing = dialogs.filter((name) => !read(name).includes("useModalFocus("));
    expect(missing).toEqual([]);
  });
});
