import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The gutter's number is a doorway (SPEC §16 §Density rule 2, §20 phase 69).
 *
 * Rule 2 says numbers are always visible and never behind a tap. The gutter's
 * `#46 · 1.2s · 868t` is the one number on a turn that has a whole prompt
 * behind it, so the number itself is the tap — it opens the prompt inspector,
 * the same sheet the palette's "inspect" command opens. This pins that wiring
 * rather than letting the stats sink back into a dead read-only line.
 */

const BLOCK = readFileSync(
  join(import.meta.dir, "..", "client", "components", "MessageBlock.tsx"),
  "utf8",
);
const CHAT = readFileSync(
  join(import.meta.dir, "..", "client", "screens", "ChatScreen.tsx"),
  "utf8",
);

describe("the gutter's number is a doorway", () => {
  test("the stats render as a button when the turn can be inspected", () => {
    expect(BLOCK).toContain("onOpen === undefined");
    expect(BLOCK).toContain("aria-label={strings.chat.inspect}");
    expect(BLOCK).toMatch(/<button[\s\S]*?onClick=\{onOpen\}/);
  });

  test("every turn passes the inspector in", () => {
    expect(CHAT).toContain("onInspect={() => setInspecting(message)}");
  });
});
