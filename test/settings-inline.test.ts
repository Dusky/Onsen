import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Settings editing expands in place on a desktop (SPEC §16 §Density rule 3,
 * §20 phase 71).
 *
 * The design's rule is "controls live in the row; a sheet is for a form". The
 * op ("background task") rows are the clearest case: with width, clicking one
 * expands its controls into the row rather than opening a bottom sheet, which
 * on a desktop is a phone shape. The one thing that keeps the two from
 * drifting into different editors is a single `OpFields` component used by
 * both the inline expansion and the phone's sheet. This pins that.
 */

const SETTINGS = readFileSync(
  join(import.meta.dir, "..", "client", "screens", "SettingsScreen.tsx"),
  "utf8",
);

describe("op controls are one component", () => {
  test("OpFields is shared by the sheet and the inline row", () => {
    expect(SETTINGS).toContain("function OpFields");
    // The phone's sheet.
    expect(SETTINGS).toContain("<OpFields task={task} profiles={profiles} />");
    // The desktop's inline expansion.
    expect(SETTINGS).toContain("<OpFields task={task} profiles={profileList} />");
  });

  test("the row expands on desktop and opens the sheet on a phone", () => {
    expect(SETTINGS).toContain("isDesktop ? setOpenOp(");
    expect(SETTINGS).toContain("setEditingOp(task)");
  });
});
