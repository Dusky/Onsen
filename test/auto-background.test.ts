import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Automatic background generation (AutoBackground, ported — §20 phase 103).
 *
 * After each AI reply, when enabled, a detection call decides whether the scene
 * moved and draws a background. This pins the schema and the settings surface;
 * the detection runner itself is the next slice.
 */

const MIGRATION = readFileSync(
  join(import.meta.dir, "..", "server", "db", "migrations", "0052_auto_background.sql"),
  "utf8",
);
const SCREEN = readFileSync(
  join(import.meta.dir, "..", "client", "screens", "SceneSetupScreen.tsx"),
  "utf8",
);

describe("auto background", () => {
  test("the scene carries the four knobs", () => {
    expect(MIGRATION).toContain("auto_background_enabled");
    expect(MIGRATION).toContain("auto_background_cooldown");
    expect(MIGRATION).toContain("auto_background_min_messages");
    expect(MIGRATION).toContain("auto_background_prompt");
  });

  test("the setup screen exposes them", () => {
    expect(SCREEN).toContain("autoBackgroundEnabled");
    expect(SCREEN).toContain("autoBackgroundCooldown");
    expect(SCREEN).toContain("autoBackgroundMinMessages");
    expect(SCREEN).toContain("autoBackgroundPrompt");
  });
});
