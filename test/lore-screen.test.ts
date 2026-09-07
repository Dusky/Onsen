import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The lore library and editor are one page (SPEC §10, §16, §20 phase 123).
 *
 * SillyTavern keeps world info on a single surface; so does this. The old two
 * routes — a list screen then an editor screen — are replaced by one `LoreScreen`
 * with the books as a rail beside the editor on a desktop and an in-place swap
 * on a phone. This pins the merge so the screens cannot quietly split again.
 */

const CLIENT = join(import.meta.dir, "..", "client");
const LORE = readFileSync(join(CLIENT, "screens", "LoreScreen.tsx"), "utf8");
const APP = readFileSync(join(CLIENT, "App.tsx"), "utf8");

describe("the lore page", () => {
  test("the books list and the editor live in one screen", () => {
    expect(LORE).toContain("function BookList");
    expect(LORE).toContain("function BookEditor");
    expect(LORE).toContain("useIsDesktop");
    // The books rail on a desktop, the in-place swap on a phone.
    expect(LORE).toContain("BookList selectedId");
    expect(LORE).toContain("<BookEditor");
  });

  test("both routes render the one screen", () => {
    expect(APP).toContain('<LoreScreen />');
    expect(APP).toContain("<LoreScreen bookId={route.bookId} />");
  });

  test("the old two screens are gone", () => {
    expect(LORE).not.toContain("LorebookEditorScreen");
    expect(APP).not.toContain("LorebooksScreen");
    expect(APP).not.toContain("LorebookEditorScreen");
  });
});
