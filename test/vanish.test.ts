import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Vanish mode (§20 phase 170): one key drops every piece of chrome — both
 * rails, the header/top bar — down to bare log; the same key, or the always-
 * present handle, brings it back.
 *
 * Structural, like the rest of this project's UI guards: no DOM rendering, the
 * source is read as text and the decisions are asserted where they are
 * written (`test/document-mode.test.ts`, `test/notices.test.ts` are the
 * models).
 */

const ROOT = join(import.meta.dir, "..");
const UI_STATE = readFileSync(join(ROOT, "client", "state", "ui.ts"), "utf8");
const APP = readFileSync(join(ROOT, "client", "App.tsx"), "utf8");
const COMPOSER = readFileSync(join(ROOT, "client", "components", "Composer.tsx"), "utf8");
const CHAT_SCREEN = readFileSync(join(ROOT, "client", "screens", "ChatScreen.tsx"), "utf8");

describe("the store", () => {
  test("vanished is in memory only, like the rest of this store", () => {
    expect(UI_STATE).toContain("vanished: boolean;");
    expect(UI_STATE).toContain("vanished: false,");
    expect(UI_STATE).toContain("toggleVanished: () => set((state) => ({ vanished: !state.vanished }))");
    // The store's own doc comment says so outright — no browser storage
    // anywhere in this app, and this is not the one exception.
    expect(UI_STATE).toContain("In memory only");
  });
});

describe("the key", () => {
  test("z, unmodified, ignored while a field has focus", () => {
    expect(APP).toContain('event.key === "z"');
    expect(APP).toContain('event.metaKey || event.ctrlKey || event.altKey');
    expect(APP).toContain('"input, textarea, [contenteditable]"');
  });

  test("registered once at the Shell level, not inside the chat-only accelerator hook", () => {
    // useCommandKeys is chat-screen-scoped; the rails and header exist on
    // every screen, so the listener has to live above it.
    const commandKeys = readFileSync(
      join(ROOT, "client", "screens", "chat", "useCommandKeys.ts"),
      "utf8",
    );
    expect(commandKeys).not.toContain('"z"');
    expect(APP).toContain("addEventListener(\"keydown\", onKey)");
  });
});

describe("what disappears", () => {
  test("both rails and the header vanish on desktop", () => {
    expect(APP).toMatch(/\{vanished \? null : <LeftRail \/>\}/);
    expect(APP).toMatch(/\{vanished \? null : <Header \/>\}/);
    expect(APP).toMatch(/\{vanished \? null : <RightRail \/>\}/);
  });

  test("the phone's top bar vanishes too, even with no rail to lose", () => {
    expect(APP).toMatch(/\{vanished \? null : <TopBar \/>\}/);
  });

  test("nothing here gates the composer — vanish removes navigation chrome, not the ability to act", () => {
    expect(COMPOSER).not.toContain("vanished");
    expect(CHAT_SCREEN).not.toContain("vanished");
  });
});

describe("the way back in", () => {
  test("a restore handle is always present while vanished, on both layouts", () => {
    expect(APP.match(/<VanishHandle onRestore={toggleVanished} \/>/g)).toHaveLength(2);
  });

  test("it meets the touch floor and sits clear of where a notice can land", () => {
    // NoticeRegion's three positions are top-centre, top-right and bottom-
    // right; the handle is bottom-left, so the two can never overlap.
    expect(APP).toContain('bottom-[12px] left-[12px]');
    // An explicit size, not `.tap` — that class relaxes to nothing under a
    // fine pointer (`@media (pointer: fine)`), which is right for a row of
    // controls with a whole row to spend the saved space on and wrong for one
    // isolated floating button with nothing to spend it on. Measured in a
    // browser: `.tap` alone rendered this a 6px × 24px sliver.
    expect(APP).toMatch(/VanishHandle[\s\S]{0,600}h-\[44px\] w-\[44px\]/);
    expect(APP).not.toMatch(/VanishHandle[\s\S]{0,400}className="tap /);
  });

  test("it names what it does, for a screen reader and for the tooltip both", () => {
    expect(APP).toContain("aria-label={strings.common.showChrome}");
    expect(APP).toContain("title={strings.common.showChrome}");
  });
});
