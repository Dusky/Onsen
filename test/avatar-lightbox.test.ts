import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The portrait sheet (§20 phase 187).
 *
 * A turn's masthead portrait is a 40px thumbnail; clicking it opens the full
 * picture. Pinned structurally — the lightbox is the app's ordinary `Sheet`
 * modal, and the thumbnail is a real button, not a decorative glyph.
 */

const BLOCK = readFileSync(join(import.meta.dir, "..", "client", "components", "MessageBlock.tsx"), "utf8");
const LIGHTBOX = readFileSync(join(import.meta.dir, "..", "client", "components", "ImageLightbox.tsx"), "utf8");

describe("the portrait sheet", () => {
  test("the masthead portrait is a button that opens the full picture", () => {
    expect(BLOCK).toContain("ImageLightbox");
    expect(BLOCK).toContain("strings.chat.viewPicture");
    expect(BLOCK).toContain("onClick={() => setOpen(true)}");
  });

  test("it is the ordinary sheet, not a second overlay", () => {
    // `Sheet` owns the phone and desktop shapes, the backdrop and the Escape.
    expect(LIGHTBOX).toContain("<Sheet");
    expect(LIGHTBOX).not.toContain("fixed inset-0");
  });

  test("the picture fills the sheet without stretching", () => {
    expect(LIGHTBOX).toContain("maxHeight: \"70dvh\"");
    expect(LIGHTBOX).toContain("width: \"auto\"");
  });

  test("it still builds no HTML string", () => {
    expect(LIGHTBOX).not.toContain("dangerouslySetInnerHTML");
  });
});
