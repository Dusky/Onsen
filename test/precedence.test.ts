import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../server/db/index.ts";
import { migrate } from "../server/db/migrate.ts";
import { resolvePreset } from "../server/generation/context.ts";
import { buildPrompt } from "../server/prompt/index.ts";
import { ulid } from "../server/lib/ulid.ts";
import { context, singleCharacterContext } from "./prompt-fixtures.ts";
import type { PromptCharacter } from "../server/prompt/types.ts";

/**
 * The card against the preset (§2, §20 phase 169).
 *
 * Two decisions the builder made for the reader with no way past them: whose
 * system prompt frames the turn, and whether a card's post-history
 * instructions reach the model at all.
 *
 * Run through the whole path for the reason `prompt-blocks.test.ts` states —
 * a row in a real database, through `resolvePreset`, into `buildPrompt`, and
 * asserted on the assembled blocks. That file exists because a capability sat
 * dead for fifty-five phases with both ends correct in isolation, and a
 * preference like this is the same shape of bug waiting to happen.
 */

function db(): Database {
  const database = openDatabase(":memory:");
  migrate(database);
  return database;
}

/** A preset row with a marked system prompt, and the two flags as asked for. */
function preset(
  database: Database,
  flags: { preferCharacterPrompt?: boolean; preferCharacterInstructions?: boolean } = {},
): number {
  const now = Date.now();
  const row = database
    .query(
      `INSERT INTO presets
         (ulid, name, sampler_settings, system_prompt, jailbreak,
          prefer_character_prompt, prefer_character_instructions, created_at, updated_at)
       VALUES ($ulid, 'Test', '{}', 'PRESET FRAMING', 'PRESET FINAL', $prompt, $instructions, $now, $now)
       RETURNING id`,
    )
    .get({
      ulid: ulid(),
      prompt: flags.preferCharacterPrompt === true ? 1 : 0,
      instructions: flags.preferCharacterInstructions === false ? 0 : 1,
      now,
    }) as { id: number };
  return row.id;
}

/** A character carrying both of the fields under test. */
const CARD: PromptCharacter = {
  id: "c1",
  name: "Bell",
  description: "A signalwoman.",
  personality: null,
  scenario: null,
  exampleDialogue: null,
  voiceNotes: null,
  depthPrompt: null,
  depthPromptDepth: 0,
  depthPromptRole: "system",
  systemPrompt: "CARD FRAMING",
  postHistoryInstructions: "CARD FINAL",
  colour: null,
};

/** The blocks the prompt assembled, by id, with their content and source. */
function blocks(database: Database, id: number, single = false) {
  const resolved = resolvePreset(database, id);
  const built = buildPrompt(
    single
      ? singleCharacterContext({ preset: resolved.preset, cast: [CARD], spotlight: CARD })
      : context({ preset: resolved.preset, cast: [CARD], spotlight: CARD }),
  );
  return new Map(built.debug.blocks.map((block) => [block.id, block]));
}

describe("the defaults are what the builder already did", () => {
  test("a fresh row reads as preset framing, card instructions", () => {
    const database = db();
    const resolved = resolvePreset(database, preset(database));
    expect(resolved.preset.preferCharacterPrompt).toBe(false);
    expect(resolved.preset.preferCharacterInstructions).toBe(true);
  });

  test("an install with no preset row at all reads the same way", () => {
    // `resolvePreset` takes a null row — a scene with no preset. Defaults have
    // to hold there too, or the one install with nothing configured behaves
    // differently from every other.
    const database = db();
    const resolved = resolvePreset(database, null);
    expect(resolved.preset.preferCharacterPrompt).toBe(false);
    expect(resolved.preset.preferCharacterInstructions).toBe(true);
  });

  test("by default the system prompt is the preset's", () => {
    const database = db();
    const found = blocks(database, preset(database));
    expect(found.get("system_prompt")?.content).toBe("PRESET FRAMING");
    expect(found.get("system_prompt")?.source).toBe("preset");
  });

  test("by default a card's framing still reaches a single-character scene", () => {
    // Its original home: folded into `spotlight_character` when there is no
    // author. Turning nothing on must not take that away.
    const database = db();
    const found = blocks(database, preset(database), true);
    expect(found.get("spotlight_character")?.content).toContain("CARD FRAMING");
  });
});

describe("a card's system prompt replacing the preset's", () => {
  test("it becomes the system prompt block, and says whose it is", () => {
    // The Inspector reads `source`, so a reader can see which framing is in
    // force rather than inferring it from the text.
    const database = db();
    const found = blocks(database, preset(database, { preferCharacterPrompt: true }));
    expect(found.get("system_prompt")?.content).toBe("CARD FRAMING");
    expect(found.get("system_prompt")?.source).toBe("Bell");
  });

  test("replaces rather than appends — the preset's framing is gone", () => {
    // Two framings in one block are two framings arguing, which is the thing
    // §3.5 is written against.
    const database = db();
    const found = blocks(database, preset(database, { preferCharacterPrompt: true }));
    expect(found.get("system_prompt")?.content).not.toContain("PRESET FRAMING");
  });

  test("and is not also billed inside the spotlight block", () => {
    // The gap this closes in the other direction: its original home fires on
    // `author === null`, so in a single-character scene with the flag on the
    // card's framing would have arrived twice and been counted twice.
    const database = db();
    const found = blocks(database, preset(database, { preferCharacterPrompt: true }), true);
    expect(found.get("system_prompt")?.content).toBe("CARD FRAMING");
    expect(found.get("spotlight_character")?.content).not.toContain("CARD FRAMING");
  });

  test("it works with an author set, which is the gap it exists for", () => {
    /*
     * Before this, a character's system prompt went nowhere whenever an author
     * was configured: the `system_prompt` block was the preset's and the
     * spotlight block's fold was gated on `author === null`. Silently — the
     * card had a field, the reader filled it in, and nothing said it was
     * being dropped.
     */
    const database = db();
    const off = blocks(database, preset(database));
    expect(off.get("system_prompt")?.content).toBe("PRESET FRAMING");
    expect(off.get("spotlight_character")?.content ?? "").not.toContain("CARD FRAMING");

    const on = blocks(database, preset(database, { preferCharacterPrompt: true }));
    expect(on.get("system_prompt")?.content).toBe("CARD FRAMING");
  });

  test("a card with no system prompt falls back rather than emptying the block", () => {
    // Otherwise turning the flag on with a card that has no framing would
    // remove the preset's and leave the turn with none at all.
    const database = db();
    const resolved = resolvePreset(database, preset(database, { preferCharacterPrompt: true }));
    const bare = { ...CARD, systemPrompt: null };
    const built = buildPrompt(context({ preset: resolved.preset, cast: [bare], spotlight: bare }));
    const found = new Map(built.debug.blocks.map((block) => [block.id, block]));
    expect(found.get("system_prompt")?.content).toBe("PRESET FRAMING");
    expect(found.get("system_prompt")?.source).toBe("preset");
  });

  test("whitespace is not a system prompt", () => {
    const database = db();
    const resolved = resolvePreset(database, preset(database, { preferCharacterPrompt: true }));
    const blank = { ...CARD, systemPrompt: "   \n  " };
    const built = buildPrompt(context({ preset: resolved.preset, cast: [blank], spotlight: blank }));
    const found = new Map(built.debug.blocks.map((block) => [block.id, block]));
    expect(found.get("system_prompt")?.content).toBe("PRESET FRAMING");
  });
});

describe("a card's post-history instructions", () => {
  test("are used by default, which is what the builder always did", () => {
    const database = db();
    const found = blocks(database, preset(database));
    expect(found.get("post_history")?.content).toBe("CARD FINAL");
    expect(found.get("post_history")?.source).toBe("Bell");
  });

  test("can be refused, and the preset's own final instruction is untouched", () => {
    /*
     * There was never anything on the preset side to prefer this over: the
     * `?? ctx.preset.postHistoryInstructions` fallback this replaced could
     * never fire, because that field was hardcoded null at both of its call
     * sites. The preset's final instruction is the separate `jailbreak` block,
     * and turning the card's off must not disturb it.
     */
    const database = db();
    const found = blocks(database, preset(database, { preferCharacterInstructions: false }));
    expect(found.has("post_history")).toBe(false);
    expect(found.get("jailbreak")?.content).toBe("PRESET FINAL");
  });

  test("the dead field is gone rather than left asserting an unreachable fallback", () => {
    const text = readFileSync(
      join(import.meta.dir, "..", "server", "prompt", "types.ts"),
      "utf8",
    );
    const preset = text.slice(text.indexOf("export interface PromptPreset"));
    // Comments stripped, for the reason phase 57 recorded: the doc comment
    // *explaining* why the field went is not the field coming back.
    const body = preset
      .slice(0, preset.indexOf("\n}"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    expect(body).not.toContain("postHistoryInstructions");
    expect(body).toContain("preferCharacterInstructions");
  });
});

describe("the two flags are independent", () => {
  test("both on, and each block takes its own side", () => {
    const database = db();
    const found = blocks(
      database,
      preset(database, { preferCharacterPrompt: true, preferCharacterInstructions: true }),
    );
    expect(found.get("system_prompt")?.content).toBe("CARD FRAMING");
    expect(found.get("post_history")?.content).toBe("CARD FINAL");
  });

  test("both off, and the preset has the prompt to itself", () => {
    const database = db();
    const found = blocks(
      database,
      preset(database, { preferCharacterPrompt: false, preferCharacterInstructions: false }),
    );
    expect(found.get("system_prompt")?.content).toBe("PRESET FRAMING");
    expect(found.has("post_history")).toBe(false);
    expect(found.get("jailbreak")?.content).toBe("PRESET FINAL");
  });
});
