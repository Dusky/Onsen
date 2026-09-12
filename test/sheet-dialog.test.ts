import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A sheet is a dialog on a desktop and a sheet on a phone (§20 phase 174).
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
 */

const SHEET = readFileSync(
  join(import.meta.dir, "..", "client", "components", "Sheet.tsx"),
  "utf8",
);
const PALETTE = readFileSync(
  join(import.meta.dir, "..", "client", "components", "CommandPalette.tsx"),
  "utf8",
);

describe("it knows which shape it is", () => {
  test("by asking the same breakpoint the rest of the shell asks", () => {
    expect(SHEET).toContain("useIsDesktop");
  });
});

describe("the phone keeps the sheet", () => {
  test("bottom-anchored, with the rounded top the design allows it", () => {
    expect(SHEET).toContain("flex flex-col justify-end");
    expect(SHEET).toContain('"16px 16px 0 0"');
  });

  test("and the safe-area allowance, which is a phone concern", () => {
    expect(SHEET).toContain("env(safe-area-inset-bottom)");
  });
});

describe("the desktop gets a dialog", () => {
  test("top-anchored and centred, the treatment the palette already uses", () => {
    expect(SHEET).toContain("flex items-start justify-center px-[16px] pt-[64px]");
    expect(PALETTE).toContain("flex justify-center px-[16px] pt-[64px]");
  });

  test("square, because only a phone sheet earns a rounded corner", () => {
    expect(SHEET).toMatch(/borderRadius: isDesktop \? "0"/);
  });

  test("it hugs its content instead of running to the bottom edge", () => {
    // The bug: a row flex stretches its children on the cross axis, so the
    // dialog measured 886px of a 950px window and sat against the bottom —
    // the complaint this phase answers, arrived at a different way.
    expect(SHEET).toContain("items-start");
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
