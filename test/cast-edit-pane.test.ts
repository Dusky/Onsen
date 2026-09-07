import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The mid-scene edit pane (SPEC §16, §20 phase 82).
 *
 * On a desktop, editing a cast member must not leave the log: the right pane
 * swaps for the character's card, and the card renders the same `EditorField`s
 * the full editor does — the same single-component contract the settings
 * editors took, so the pane and the screen cannot drift. On a phone there is no
 * pane, so the same action navigates to the full editor.
 */

const PANE = readFileSync(
  join(import.meta.dir, "..", "client", "components", "CastEditPane.tsx"),
  "utf8",
);
const CHAT = readFileSync(
  join(import.meta.dir, "..", "client", "screens", "ChatScreen.tsx"),
  "utf8",
);

describe("the mid-scene edit pane", () => {
  test("renders the shared editor fields, not its own", () => {
    expect(PANE).toContain("<EditorField");
    expect(PANE).toContain("useUpdateCharacter");
    expect(PANE).toContain("strings.characters.openEditor");
  });

  test("the pane swaps in on desktop and the action reaches it", () => {
    expect(CHAT).toContain("<CastEditPane");
    expect(CHAT).toContain("setEditingCastId(castActing.characterId)");
    expect(CHAT).toContain("strings.chat.editCard");
  });
});

describe("the persona pane", () => {
  const PERSONA = readFileSync(
    join(import.meta.dir, "..", "client", "components", "PersonaEditPane.tsx"),
    "utf8",
  );

  test("edits the reader in place, with the shared fields", () => {
    expect(PERSONA).toContain("<EditorField");
    expect(PERSONA).toContain("useUpdatePersona");
  });

  test("is a pane the chat shows, not a screen", () => {
    expect(CHAT).toContain("<PersonaEditPane");
  });
});
