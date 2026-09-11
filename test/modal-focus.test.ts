import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A modal keeps focus, and gives it back (§20, the accessibility pass).
 *
 * The app has two modals and both were open at the back. `Sheet` — the only
 * modal primitive, 56 usages across 32 files plus every `useConfirm()`
 * question — had no focus code at all, and a comment claiming it did: "the
 * sheet takes focus so a keyboard user is not left tabbing through the log
 * underneath" described an intention nothing implemented. `CommandPalette`
 * had the same holes plus two of its own: its Escape lived on the search
 * input, and that input was the app's only override of the global
 * `:focus-visible` ring, replaced with nothing.
 *
 * One fix for both, in `client/lib/modal.ts`, so no call site changed. This
 * pins the parts a reader would otherwise take on trust, since the project
 * runs no DOM tests: the behaviour itself is verified by driving a browser,
 * which is what found the bugs — including two that only appear in
 * development, and one that only appears when one sheet opens another.
 */

const HOOK = readFileSync(join(import.meta.dir, "..", "client", "lib", "modal.ts"), "utf8");
const SHEET = readFileSync(
  join(import.meta.dir, "..", "client", "components", "Sheet.tsx"),
  "utf8",
);
const PALETTE = readFileSync(
  join(import.meta.dir, "..", "client", "components", "CommandPalette.tsx"),
  "utf8",
);

describe("an open modal owns focus", () => {
  test("it takes focus when it opens", () => {
    expect(HOOK).toContain("node.focus()");
  });

  test("but never off a field that claimed it first", () => {
    // Several call sites `autoFocus` an input inside the modal — renaming a
    // scene, naming a checkpoint, the palette's own search box — and React
    // applies that during the commit, before effects run.
    expect(HOOK).toContain("!node.contains(document.activeElement)");
  });

  test("remembers what opened it and gives focus back", () => {
    expect(HOOK).toContain("trigger.current = document.activeElement");
    expect(HOOK).toContain("opener.focus()");
  });

  test("reads the trigger at render, not in an effect", () => {
    // React's development double-invoke runs effects twice, and the second
    // pass captured the modal's own dialog as its trigger — so the restore
    // aimed at a node that no longer existed. Only a browser could find that:
    // it misbehaves in development only.
    expect(HOOK).toContain("if (order.current === null) {");
    expect(HOOK).not.toContain("const trigger = document.activeElement");
  });

  test("unless the trigger went with the row the modal acted on", () => {
    // A `⋯` button on a row the sheet then deletes is gone by the time the
    // sheet closes; focusing it would focus nothing.
    expect(HOOK).toContain("opener.isConnected");
  });

  test("and not over a modal that opened as this one closed", () => {
    // Manage a roleplay → Rename swaps both sheets in one commit, and the
    // cleanup runs mid-commit, before the replacement exists. Restoring from
    // there took focus straight back off the rename field.
    expect(HOOK).toContain("requestAnimationFrame");
    expect(HOOK).toContain("active === document.body");
  });

  test("traps Tab and Shift+Tab inside the dialog", () => {
    expect(HOOK).toContain('event.key !== "Tab"');
    expect(HOOK).toContain("event.shiftKey");
    expect(HOOK).toContain("node.querySelectorAll<HTMLElement>(FOCUSABLE)");
  });

  test("and the trap does not include a backdrop", () => {
    // `Sheet`'s backdrop is a focusable `<button aria-label="Close">` that
    // precedes the dialog, so the stops are queried from the dialog rather
    // than the wrapper: the first Tab must not land on a control that looks
    // like nothing.
    expect(HOOK).not.toContain("document.querySelectorAll(FOCUSABLE)");
  });
});

describe("Escape closes one modal, not the stack", () => {
  test("modals know which of them is on top", () => {
    // `ConfirmSheet` documents opening a question from inside an open sheet,
    // and `Checkpoints` renders it inside the sheet it belongs to. With a bare
    // per-sheet window listener, one Escape closed both.
    expect(HOOK).toContain("OPEN_MODALS");
    expect(HOOK).toContain("function isTopmost");
    expect(HOOK).toContain("if (!isTopmost(order.current!)) return");
  });

  test("the order is taken at render, not on mount", () => {
    // React runs a child's effects before its parent's, so a modal nested
    // inside another in the same commit would register first and be taken for
    // the one underneath. Render order is parent first, which is how they
    // stack.
    expect(HOOK).toContain("order.current = ++opened;");
  });
});

describe("both modals use it", () => {
  for (const [name, source] of [
    ["Sheet", SHEET],
    ["CommandPalette", PALETTE],
  ] as const) {
    test(`${name} hands its dialog to the hook`, () => {
      expect(source).toContain("useModalFocus(dialog, onClose)");
      expect(source).toContain("ref={dialog}");
      // Needed so the dialog can hold focus itself, on open and when there is
      // nothing inside to Tab to.
      expect(source).toContain("tabIndex={-1}");
      expect(source).toContain('aria-modal="true"');
    });
  }

  test("neither keeps an Escape listener of its own", () => {
    expect(SHEET).not.toContain('event.key === "Escape"');
    expect(PALETTE).not.toContain('event.key === "Escape"');
  });
});

describe("the palette's own two", () => {
  test("the search box no longer cancels the app's focus ring", () => {
    // It was the only `outline-none` in the app, and it replaced the global
    // `:focus-visible` rule with nothing at all.
    expect(PALETTE).not.toContain("outline-none");
  });

  test("the arrows are on the dialog, not the search box", () => {
    // Every command row is a real button, so Tab moves focus off the input —
    // and the arrows have to keep working when it does.
    const dialogAt = PALETTE.indexOf('role="dialog"');
    const arrowAt = PALETTE.indexOf('event.key === "ArrowDown"');
    const inputAt = PALETTE.indexOf("<input");
    expect({ dialogAt: dialogAt > 0, arrowsBeforeInput: arrowAt > dialogAt && arrowAt < inputAt }).toMatchObject(
      { dialogAt: true, arrowsBeforeInput: true },
    );
  });
});
