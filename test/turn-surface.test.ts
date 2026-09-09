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
const TOKENIZER = readFileSync(
  join(import.meta.dir, "..", "server", "prompt", "tokenizer.ts"),
  "utf8",
);
const STRINGS = readFileSync(join(import.meta.dir, "..", "client", "strings.ts"), "utf8");
const CHAT = readFileSync(join(import.meta.dir, "..", "client", "screens", "ChatScreen.tsx"), "utf8");
const OPS_GRID = readFileSync(
  join(import.meta.dir, "..", "client", "components", "OpsGrid.tsx"),
  "utf8",
);
const STATS_SHEET = readFileSync(
  join(import.meta.dir, "..", "client", "screens", "chat", "StatsSheet.tsx"),
  "utf8",
);
const SHEETS = readFileSync(
  join(import.meta.dir, "..", "client", "screens", "chat", "ChatSheets.tsx"),
  "utf8",
);

describe("the turn surface", () => {
  test("every turn action is a glyph, the words live in the palette", () => {
    // The three story actions went back to glyphs (§20 phase 130); the words
    // stay in the palette and the long-press sheet, which is their one home.
    expect(BLOCK).not.toContain("text: true");
    expect(BLOCK).toContain("turnReroll");
    expect(BLOCK).toContain("turnBranch");
    expect(BLOCK).toContain("turnEdit");
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
    // Priced with the same characters-per-token ratio the server's estimator
    // uses (§20 phase 114), never a second hardcoded number the two could
    // disagree on.
    expect(COMPOSER).toContain("CHARS_PER_TOKEN");
    expect(COMPOSER).not.toContain("draft.length / 4");
    expect(TOKENIZER).toContain("CHARS_PER_TOKEN");
    expect(TOKENIZER).toContain("shared/types.ts");
  });

  test("the placeholder invites a turn or none", () => {
    expect(STRINGS).toContain("Write your turn, or send nothing and let the scene run");
  });

  test("the versions sheet can delete a sibling, and the scene rolls up as stats", () => {
    // The overlays live beside the screen (§20 phase 149); the screen wires them.
    expect(SHEETS).toContain("deleteVersionConfirm");
    expect(CHAT).toContain("onDeleteMessage={(messageId) => remove.mutate(messageId)}");
    expect(STATS_SHEET).toContain("StatsSheet");
    expect(CHAT).toContain("<ChatSheets");
    expect(CHAT).toContain("useSceneStats");
  });

  test("a direction is attached to its reply, collapsed, not a message", () => {
    expect(BLOCK).toContain("function Direction");
    expect(BLOCK).toContain("message.generation?.nudge");
    expect(BLOCK).toContain("directionNote");
  });

  test("a leading slash opens the palette from the composer", () => {
    expect(CHAT).toContain("handleDraftChange");
    expect(CHAT).toContain("startsWith(\"/\")");
    expect(SHEETS).toContain("initialQuery={paletteSeed}");
  });

  test("the ops grid carries CONTINUE and TOOLS, and the header shrinks to SETUP", () => {
    // §149: the full-width "reply without me" button folded into a `→ CONTINUE`
    // cell, the marks/stats header chips folded into a `⋯ TOOLS` sheet.
    expect(CHAT).toContain('key: "run_on"');
    expect(CHAT).toContain('key: "tools"');
    expect(SHEETS).toContain("strings.chat.opTools");
    expect(CHAT).not.toContain("strings.chat.stats");
    expect(CHAT).not.toContain("strings.chat.checkpoints");
    // The desktop Direct row carries the keyboard hints the design specifies.
    expect(CHAT).toContain("hint={strings.chat.keyboardHints}");
  });

  test("the desktop ops are glyph-only with tooltips, so nine fit one row", () => {
    // §149: a glyph is the icon; the words live in the tooltip (title) and the
    // accessible label, not inline as a second span that forces a wrap.
    expect(OPS_GRID).toContain("aria-label={op.label}");
    expect(OPS_GRID).toContain("title={why === undefined ? op.label : `${op.label} — ${why}`}");
  });

  test("the send button is a fixed icon; who replies lives in the footer", () => {
    // §149: the button used to grow and carry a name ("then X replies") or the
    // speaker's initials. It is now a fixed ↑; the speaker is the footer's
    // right side, opposite the model.
    expect(COMPOSER).not.toContain("speakerInitials");
    expect(COMPOSER).not.toContain("sendThen");
    expect(COMPOSER).toContain("strings.chat.willReply");
  });
});
