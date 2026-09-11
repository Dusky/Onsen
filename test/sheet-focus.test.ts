import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The sheet keeps focus, and gives it back (§20, the accessibility pass).
 *
 * `Sheet` is the app's only modal primitive — 56 usages across 32 files, plus
 * every `useConfirm()` question — and it had no focus code at all. Its own
 * comment said otherwise: "the sheet takes focus so a keyboard user is not
 * left tabbing through the log underneath" described an intention nothing
 * implemented. A keyboard user could Tab out of an open sheet into the log
 * behind it, invisibly, and was left on `<body>` when it closed.
 *
 * Fixed once in `Sheet.tsx`, so no call site changed. This pins the parts a
 * reader would otherwise have to take on trust, since the project runs no DOM
 * tests: the behaviour itself is verified by driving a browser, which is what
 * found the bug.
 */

const SOURCE = readFileSync(
  join(import.meta.dir, "..", "client", "components", "Sheet.tsx"),
  "utf8",
);

describe("an open sheet owns focus", () => {
  test("the dialog can hold it", () => {
    expect(SOURCE).toContain("tabIndex={-1}");
    expect(SOURCE).toContain("ref={dialog}");
  });

  test("but never takes it off a field that claimed it first", () => {
    // Several call sites `autoFocus` an input inside the sheet — renaming a
    // scene, naming a checkpoint — and React applies that during the commit,
    // before effects run.
    expect(SOURCE).toContain("!node.contains(document.activeElement)");
  });

  test("remembers what opened it and gives focus back", () => {
    expect(SOURCE).toContain("trigger.current = document.activeElement");
    expect(SOURCE).toContain("opener.focus()");
  });

  test("reads the trigger at render, not in an effect", () => {
    // React's development double-invoke runs effects twice, and the second
    // pass would capture the sheet's own dialog as its own trigger — so the
    // restore aimed at a node that no longer existed. Only the browser drive
    // could find that: it misbehaves in development only.
    expect(SOURCE).not.toContain("const trigger = document.activeElement");
  });

  test("unless the trigger went with the row the sheet acted on", () => {
    // A `⋯` button on a row the sheet then deletes is gone by the time the
    // sheet closes; focusing it would focus nothing.
    expect(SOURCE).toContain("opener.isConnected");
  });

  test("and not over a sheet that opened as this one closed", () => {
    // Manage a roleplay → Rename swaps both sheets in one commit, and this
    // cleanup runs mid-commit, before the replacement exists. Restoring from
    // there took focus straight back off the rename field.
    expect(SOURCE).toContain("requestAnimationFrame");
    expect(SOURCE).toContain("active === document.body");
  });

  test("traps Tab and Shift+Tab inside the dialog", () => {
    expect(SOURCE).toContain('event.key !== "Tab"');
    expect(SOURCE).toContain("event.shiftKey");
    expect(SOURCE).toContain("querySelectorAll<HTMLElement>(FOCUSABLE)");
  });

  test("and the trap does not include the backdrop", () => {
    // The backdrop is a focusable `<button aria-label="Close">` that precedes
    // the dialog, so the stops are queried from the dialog rather than the
    // wrapper — the first Tab must not land on a control that looks like
    // nothing.
    expect(SOURCE).toContain("node.querySelectorAll");
    expect(SOURCE).not.toContain("document.querySelectorAll(FOCUSABLE)");
  });

  test("the comment no longer claims what the code does not do", () => {
    expect(SOURCE).not.toContain("the sheet takes focus so a keyboard user is not left");
  });
});

describe("Escape closes one sheet, not the stack", () => {
  test("sheets know which of them is on top", () => {
    // `ConfirmSheet` documents opening a question from inside an open sheet,
    // and `Checkpoints` renders it inside the sheet it belongs to. With a bare
    // per-sheet window listener, one Escape closed both.
    expect(SOURCE).toContain("OPEN_SHEETS");
    expect(SOURCE).toContain("function isTopmost");
    expect(SOURCE).toContain("if (!isTopmost(order.current!)) return");
  });

  test("the order is taken at render, not on mount", () => {
    // React runs a child's effects before its parent's, so a sheet nested
    // inside another in the same commit would register first and be taken for
    // the one underneath. Render order is parent first, which is how they
    // stack.
    expect(SOURCE).toContain("if (order.current === null) {");
    expect(SOURCE).toContain("order.current = ++opened;");
  });
});
