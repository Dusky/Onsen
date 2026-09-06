import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The desktop sidebar (SPEC §16, §20 phase 67).
 *
 * The sidebar's whole justification is that scene-switching should be free on a
 * desktop, and its recent rows were once a bare title plus "N replies" — a list
 * that did not earn the 232px it was given. A row that is only a title says
 * nothing about which roleplay is which, and the design's own scenes list has
 * the answer already. This pins the row's substance: the newest line of prose
 * and the cast, a live writing indicator, and the density-correct `.row`.
 */

const SIDEBAR = readFileSync(
  join(import.meta.dir, "..", "client", "components", "Sidebar.tsx"),
  "utf8",
);

describe("the sidebar's recent rows are real rows", () => {
  test("the excerpt and the cast are rendered, not just a title", () => {
    expect(SIDEBAR).toContain("scene.lastLine");
    expect(SIDEBAR).toContain("scene.cast");
    expect(SIDEBAR).toContain("castInitials");
  });

  test("the generating scene is marked, not silent", () => {
    expect(SIDEBAR).toContain("useGeneration");
    expect(SIDEBAR).toContain("writingSceneId");
  });

  test("the rows go through .row, so the pointer density rule reaches them", () => {
    expect(SIDEBAR).toMatch(/className="row /);
  });
});
