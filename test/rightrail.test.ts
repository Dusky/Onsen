import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The global right rail (SPEC §16, §20 phase 87).
 *
 * The right rail was chat-only; the complaint was that it vanished on every
 * other screen. It now lives at the shell level — on every desktop page unless
 * collapsed — and is where the entities live: the cast, the author, the lore
 * and the persona, each editable in place, with a Scene tab while a roleplay is
 * open.
 */

const APP = readFileSync(join(import.meta.dir, "..", "client", "App.tsx"), "utf8");
const RAIL = readFileSync(
  join(import.meta.dir, "..", "client", "components", "RightRail.tsx"),
  "utf8",
);

describe("the global right rail", () => {
  test("is part of the shell, not a screen", () => {
    expect(APP).toContain("<RightRail />");
  });

  test("holds the entities, not just the scene", () => {
    expect(RAIL).toContain("strings.nav.characters");
    expect(RAIL).toContain("strings.nav.authors");
    expect(RAIL).toContain("strings.nav.lore");
    expect(RAIL).toContain("strings.chat.inspectorTabPersona");
    expect(RAIL).toContain("strings.chat.inspectorTabScene");
  });
});
