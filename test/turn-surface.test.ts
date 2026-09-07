import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The turn surface and the composer (the redesign phase 99).
 *
 * The mockup's turn header says its actions in words, the streaming turn ends
 * in an amber cursor, reasoning is labelled as what it is, and the composer
 * states the draft's cost as it is typed. This pins those, so the surface does
 * not quietly drift back to glyphs and bare text.
 */

const BLOCK = readFileSync(
  join(import.meta.dir, "..", "client", "components", "MessageBlock.tsx"),
  "utf8",
);
const COMPOSER = readFileSync(
  join(import.meta.dir, "..", "client", "components", "Composer.tsx"),
  "utf8",
);
const STRINGS = readFileSync(join(import.meta.dir, "..", "client", "strings.ts"), "utf8");

describe("the turn surface", () => {
  test("the story actions say their names, the utilities stay glyphs", () => {
    expect(BLOCK).toContain("text: true");
    expect(BLOCK).toContain("item.text === true");
    expect(BLOCK).toContain('px-[4px] text-[11.5px]"');
  });

  test("a streaming turn ends in the amber cursor", () => {
    expect(BLOCK).toContain("streamingText === undefined ? null");
    expect(BLOCK).toContain("var(--onsen-color-amber)");
    expect(BLOCK).toContain("\\u258c");
  });

  test("reasoning says what it is and that it is not sent back", () => {
    expect(STRINGS).toContain("not sent back");
  });
});

describe("the composer", () => {
  test("states the draft's cost as it is typed", () => {
    expect(COMPOSER).toContain("strings.chat.draftTokens");
    expect(COMPOSER).toContain("draft.length / 4");
  });

  test("the placeholder invites a turn or none", () => {
    expect(STRINGS).toContain("Write your turn, or send nothing and let the scene run");
  });
});
