import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The portrait lightbox (§20 phase 187).
 *
 * A turn's masthead portrait is a 40px thumbnail; clicking it opens the full
 * picture. Pinned structurally — the lightbox is a full-screen image over a
 * dimmed page, and the thumbnail is a real button, not a decorative glyph.
 */

const BLOCK = readFileSync(join(import.meta.dir, "..", "client", "components", "MessageBlock.tsx"), "utf8");
const LIGHTBOX = readFileSync(join(import.meta.dir, "..", "client", "components", "ImageLightbox.tsx"), "utf8");

describe("the portrait lightbox", () => {
  test("the masthead portrait is a button that opens the full picture", () => {
    expect(BLOCK).toContain("ImageLightbox");
    expect(BLOCK).toContain("strings.chat.viewPicture");
    expect(BLOCK).toContain("onClick={() => setOpen(true)}");
  });

  test("the picture fills the viewport without stretching", () => {
    expect(LIGHTBOX).toContain("object-contain");
    expect(LIGHTBOX).toContain("fixed inset-0");
  });

  test("it closes like every other dialog — escape, and the close button", () => {
    expect(LIGHTBOX).toContain("useModalFocus");
    expect(LIGHTBOX).toContain("strings.common.close");
  });

  test("it still builds no HTML string", () => {
    expect(LIGHTBOX).not.toContain("dangerouslySetInnerHTML");
  });
});
