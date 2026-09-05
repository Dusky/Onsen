import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../server/db/index.ts";
import { migrate } from "../server/db/migrate.ts";
import { resolvePreset } from "../server/generation/context.ts";
import { buildPrompt } from "../server/prompt/index.ts";
import { customBlockId } from "../shared/types.ts";
import { context } from "./prompt-fixtures.ts";
import { ulid } from "../server/lib/ulid.ts";

/**
 * A preset's assembly order has to reach the prompt (SPEC §3, §20 phase 56).
 *
 * This is the test whose absence let a capability sit dead for fifty-five
 * phases. `presets.prompt_order` was created in migration 0001. The pure
 * builder has honoured `ctx.preset.blockOrder` since phase 3. Between them,
 * `resolvePreset` returned the literal `null`, and nothing anywhere asserted
 * that what a preset stores is what the prompt does — so both ends looked
 * correct in isolation and the middle was never checked.
 *
 * Every test here therefore runs the *whole* path: a row in a real database,
 * through `resolvePreset`, into `buildPrompt`, and asserts on the assembled
 * output. A unit test of either end alone would have passed throughout.
 */

/**
 * A real database, opened the way the app opens one.
 *
 * `openDatabase` sets bun:sqlite's `strict` mode, which is what makes
 * `$name` parameters bind by name; a bare `new Database()` accepts the same
 * calls and silently binds nothing. Worth the extra import — the whole point
 * of this file is to exercise the real path.
 */
function db(): Database {
  const database = openDatabase(":memory:");
  migrate(database);
  return database;
}

/** A preset row, with whatever order and blocks the test needs. */
function preset(
  database: Database,
  options: { order?: { id: string; enabled: boolean }[]; blocks?: { id: string; label: string; content: string; enabled?: boolean }[] } = {},
): number {
  const now = Date.now();
  const row = database
    .query(
      `INSERT INTO presets (ulid, name, sampler_settings, prompt_order, system_prompt, created_at, updated_at)
       VALUES ($ulid, 'Test', '{}', $order, 'SYSTEM PROMPT MARKER', $now, $now) RETURNING id`,
    )
    .get({
      ulid: ulid(),
      order: options.order === undefined ? null : JSON.stringify(options.order),
      now,
    }) as { id: number };
  for (const [index, block] of (options.blocks ?? []).entries()) {
    database
      .query(
        `INSERT INTO preset_blocks (ulid, preset_id, label, role, content, enabled, sort_order, created_at, updated_at)
         VALUES ($ulid, $preset, $label, 'system', $content, $enabled, $sort, $now, $now)`,
      )
      .run({
        ulid: block.id,
        preset: row.id,
        label: block.label,
        content: block.content,
        enabled: block.enabled === false ? 0 : 1,
        sort: index,
        now,
      });
  }
  return row.id;
}

/** The assembled prompt as one string, which is what actually reaches a model. */
function assembled(database: Database, presetId: number): string {
  const resolved = resolvePreset(database, presetId);
  const built = buildPrompt(context({ preset: resolved.preset }));
  return built.debug.blocks.map((block) => block.content).join("\n");
}

describe("a preset's order reaches the prompt", () => {
  test("a saved order round-trips from the database into the built prompt", () => {
    const database = db();
    const id = preset(database, {
      order: [
        { id: "history", enabled: true },
        { id: "system_prompt", enabled: true },
      ],
    });
    const resolved = resolvePreset(database, id);
    // The literal null is the defect this whole file exists for.
    expect(resolved.preset.blockOrder).toEqual(["history", "system_prompt"]);

    const ids = buildPrompt(context({ preset: resolved.preset })).debug.blocks.map((b) => b.id);
    expect(ids.indexOf("history")).toBeLessThan(ids.indexOf("system_prompt"));
  });

  test("no saved order is the default order, not an empty one", () => {
    const database = db();
    const resolved = resolvePreset(database, preset(database));
    expect(resolved.preset.blockOrder).toBeNull();
    expect(assembled(database, preset(database))).toContain("SYSTEM PROMPT MARKER");
  });

  test("history and the user lock survive an order that omits them", () => {
    const database = db();
    const id = preset(database, { order: [{ id: "system_prompt", enabled: true }] });
    const ids = new Set(
      buildPrompt(context({ preset: resolvePreset(database, id).preset })).debug.blocks.map((b) => b.id),
    );
    expect(ids.has("history")).toBe(true);
    expect(ids.has("spotlight_instruction")).toBe(true);
  });
});

describe("a preset's own blocks", () => {
  const BLOCK = ulid();

  test("a custom block reaches the prompt, in the position it was given", () => {
    const database = db();
    const id = preset(database, {
      blocks: [{ id: BLOCK, label: "House rules", content: "HOUSE RULES MARKER" }],
      order: [
        { id: customBlockId(BLOCK), enabled: true },
        { id: "system_prompt", enabled: true },
      ],
    });
    const ids = buildPrompt(context({ preset: resolvePreset(database, id).preset })).debug.blocks.map(
      (b) => b.id,
    );
    expect(assembled(database, id)).toContain("HOUSE RULES MARKER");
    expect(ids.indexOf(customBlockId(BLOCK))).toBeLessThan(ids.indexOf("system_prompt"));
  });

  test("macros resolve in a custom block, as in any other", () => {
    const database = db();
    const id = preset(database, {
      blocks: [{ id: BLOCK, label: "Greeting", content: "Write for {{char}}." }],
    });
    const text = assembled(database, id);
    expect(text).toContain("Write for ");
    expect(text).not.toContain("{{char}}");
  });

  test("a disabled block is absent from the prompt entirely", () => {
    const database = db();
    const id = preset(database, {
      blocks: [{ id: BLOCK, label: "Off", content: "DISABLED MARKER", enabled: false }],
      order: [{ id: customBlockId(BLOCK), enabled: true }],
    });
    expect(assembled(database, id)).not.toContain("DISABLED MARKER");
  });

  test("a block disabled in the order is absent too", () => {
    const database = db();
    const id = preset(database, {
      blocks: [{ id: BLOCK, label: "Off", content: "ORDER DISABLED MARKER" }],
      order: [{ id: customBlockId(BLOCK), enabled: false }],
    });
    expect(assembled(database, id)).not.toContain("ORDER DISABLED MARKER");
  });

  test("an order naming a block that no longer exists still builds", () => {
    const database = db();
    const id = preset(database, {
      order: [
        { id: customBlockId("01GONEGONEGONEGONEGONEGONE"), enabled: true },
        { id: "system_prompt", enabled: true },
      ],
    });
    expect(assembled(database, id)).toContain("SYSTEM PROMPT MARKER");
  });

  test("with no saved order, a custom block still lands ahead of the history", () => {
    const database = db();
    const id = preset(database, {
      blocks: [{ id: BLOCK, label: "House rules", content: "HOUSE RULES MARKER" }],
    });
    const ids = buildPrompt(context({ preset: resolvePreset(database, id).preset })).debug.blocks.map(
      (b) => b.id,
    );
    expect(ids).toContain(customBlockId(BLOCK));
    expect(ids.indexOf(customBlockId(BLOCK))).toBeLessThan(ids.indexOf("history"));
  });
});
