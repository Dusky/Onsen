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

const PRESET = readFileSync(
  join(import.meta.dir, "..", "client", "components", "PresetEditor.tsx"),
  "utf8",
);

const CONNECTIONS = readFileSync(
  join(import.meta.dir, "..", "client", "components", "ConnectionFields.tsx"),
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

describe("providers and profiles follow the same pattern", () => {
  /*
   * The forms moved to `ConnectionFields.tsx` in phase 179, which gave them a
   * third host: the settings screen's inline expansion, its phone sheet, and
   * the rail panel's rows. The assertions moved with them rather than
   * weakening — what they pin is that there is one editor, and a third host is
   * a stronger reason for that, not a weaker one.
   */
  test("ProviderFields is shared by every host", () => {
    expect(CONNECTIONS).toContain("export function ProviderFields");
    // The phone's sheet, and the desktop's inline expansion.
    expect(CONNECTIONS).toContain("<ProviderFields provider={provider} onClose={onClose} />");
    expect(SETTINGS).toContain("onClose={() => setEditingProviderId(undefined)}");
  });

  test("ProfileFields is shared by every host", () => {
    expect(CONNECTIONS).toContain("export function ProfileFields");
    expect(CONNECTIONS).toContain(
      "<ProfileFields profile={profile} providers={providers} onClose={onClose} />",
    );
    expect(SETTINGS).toContain("onClose={() => setEditingProfile(undefined)}");
  });

  test("PresetFields is shared by the pane and the sheet", () => {
    expect(PRESET).toContain("function PresetFields");
    // The phone's sheet, in PresetEditor.
    expect(PRESET).toContain("<PresetFields preset={preset} onClose={onClose} />");
    // The desktop's pane, in SettingsScreen.
    expect(SETTINGS).toContain("<PresetFields");
    expect(SETTINGS).toContain("onClose={() => setEditingPreset(null)}");
  });
});
