import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * One tag editor everywhere (SPEC §9, §12, §20 phase 117).
 *
 * Tagging used to be three implementations: chips in the character editor,
 * chips in the roleplay organise sheet, and a comma-separated string in the
 * backdrop editor. The shared `TagEditor` is the one chip editor, so a reader
 * who learns "tap × to remove" in one library sees it in every library.
 */

const ROOT = join(import.meta.dir, "..", "client");

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

const CHARACTERS = source("screens/CharacterEditorScreen.tsx");
const SCENES = source("screens/ScenesScreen.tsx");
const BACKGROUNDS = source("screens/BackgroundsScreen.tsx");
const EDITOR = source("components/TagEditor.tsx");

describe("the shared tag editor", () => {
  test("every library surface edits tags through the one component", () => {
    for (const screen of [CHARACTERS, SCENES, BACKGROUNDS]) {
      expect(screen).toContain("<TagEditor");
      expect(screen).toContain("components/TagEditor.tsx");
    }
  });

  test("the component is the chip editor, not a comma string", () => {
    expect(EDITOR).toContain("tags.map");
    expect(EDITOR).toContain("×");
    expect(EDITOR).not.toContain(".split(");
  });

  test("the character card links its bound lorebook", () => {
    expect(CHARACTERS).toContain("character.lorebook");
    expect(CHARACTERS).toContain("strings.characters.lore");
    // And pins the preset it answers with (§20 phase 140).
    expect(CHARACTERS).toContain("character.presetId");
    expect(CHARACTERS).toContain("strings.characters.preset");
  });
});
