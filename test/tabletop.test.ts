import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { BUILTINS, loadBuiltin, rollSeed } from "../server/extensions/builtins.ts";
import { rollDice, createRng } from "../server/prompt/random.ts";

/**
 * Tabletop, the first slice (SPEC §20 phase 40, built in phase 233).
 *
 * §40 wrote its own scope and this phase followed it: **rolls and checks as
 * recorded events first, stats only if the checks get used.** So there is
 * nothing here about stats, inventory or schemas — the tests are about the one
 * rule the module exists to keep, which is §22's:
 *
 * > **Don't roll dice in the model.** Randomness is settled server-side and
 * > reaches the model as fact it narrates.
 *
 * Two halves follow from that and both are pinned below: the number is decided
 * by `rollDice` off an injectable RNG, and what reaches the prompt says the
 * roll *already happened*.
 */

const ROOT = join(import.meta.dir, "..");

/** The extension, registered through the same API installed code gets. */
async function tabletop(settings: Record<string, unknown> = {}) {
  const builtin = BUILTINS.find((entry) => entry.name === "Tabletop");
  expect(builtin).toBeDefined();
  const merged: Record<string, unknown> = {};
  for (const field of builtin!.settings) merged[field.key] = field.default;
  return loadBuiltin(builtin!, { ...merged, ...settings });
}

/**
 * A database with just the table the extension's state lives in.
 *
 * `strict: true` because the app opens its own that way (`server/db/index.ts`)
 * and `writeExtensionState` binds bare parameter names, which bun:sqlite only
 * accepts under that flag. Without it every write here fails on a NOT NULL
 * that has nothing to do with the data.
 */
function stateDb(): Database {
  const db = new Database(":memory:", { strict: true });
  db.run(`CREATE TABLE extension_state (
    extension_name TEXT NOT NULL, scene_id INTEGER NOT NULL,
    key TEXT NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY (extension_name, scene_id, key)) STRICT`);
  return db;
}

function log(db: Database, sceneId = 1): Record<string, unknown>[] {
  const row = db
    .query("SELECT value FROM extension_state WHERE extension_name = $n AND scene_id = $s AND key = 'rolls'")
    // Bare names, not `$n` — that is what `strict: true` asks for.
    .get({ n: "Tabletop", s: sceneId }) as { value: string } | null;
  return row === null ? [] : (JSON.parse(row.value) as Record<string, unknown>[]);
}

describe("one roller, not two", () => {
  /**
   * `rollDice` lived in `macros.ts` and was module-private. The extension
   * needs the same function, and a second implementation of one die is the
   * shape this branch has now recorded six times — two things answering the
   * same question, drifting apart a phase at a time.
   */
  test("rollDice is defined once, in random.ts", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.ts$/.test(entry)) continue;
        const code = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
        if (/function rollDice\b/.test(code)) offenders.push(path.slice(ROOT.length + 1));
      }
    };
    walk(join(ROOT, "server"));
    walk(join(ROOT, "client"));
    expect(offenders).toEqual(["server/prompt/random.ts"]);
  });

  test("the macro engine imports it rather than owning it", () => {
    const macros = readFileSync(join(ROOT, "server", "prompt", "macros.ts"), "utf8");
    expect(macros).toMatch(/import \{[^}]*rollDice[^}]*\} from "\.\/random\.ts"/);
  });

  test("the roll is a function of its seed, so a scripted one is reproducible", () => {
    const once = rollDice("2d6", createRng(12345));
    const again = rollDice("2d6", createRng(12345));
    expect(once).toBe(again!);
    expect(Number(once)).toBeGreaterThanOrEqual(2);
    expect(Number(once)).toBeLessThanOrEqual(12);
  });

  test("a spec that is not a roll yields nothing rather than a number", () => {
    // The caller leaves the text alone; it never renders a number nobody meant.
    for (const spec of ["", "d", "twenty", "1000d6", "d0"]) {
      expect({ spec, rolled: rollDice(spec, createRng(1)) }).toMatchObject({ rolled: null });
    }
  });
});

describe("a roll is recorded, then narrated once", () => {
  test("pressing Roll records what it rolled", async () => {
    const reg = await tabletop();
    const action = reg.actions.find((entry) => entry.key === "roll");
    expect(action).toBeDefined();
    // No prompt: the host runs the code and never calls a model.
    expect(action!.prompt).toBeUndefined();
    expect(action!.run).toBeDefined();

    const db = stateDb();
    await action!.run!({ db, sceneId: 1 });
    const rolls = log(db);
    expect(rolls.length).toBe(1);
    expect(rolls[0]).toMatchObject({ dice: "d20", difficulty: 11, narrated: false });
    expect(Number(rolls[0]!["total"])).toBeGreaterThanOrEqual(1);
    expect(Number(rolls[0]!["total"])).toBeLessThanOrEqual(20);
    expect(["success", "failure"]).toContain(rolls[0]!["outcome"] as string);
  });

  /**
   * A button that works in silence is a button nobody trusts.
   *
   * The host hardcoded an empty result for code actions, so pressing *Roll*
   * would have recorded the roll and shown the reader nothing until the next
   * turn arrived — the same silent no-op §20 phases 224, 227 and 228 each
   * fixed one of. `run` may return what it did, and the composer's sheet
   * already renders it.
   */
  test("pressing Roll says what it rolled", async () => {
    const reg = await tabletop();
    const db = stateDb();
    const said = await reg.actions.find((entry) => entry.key === "roll")!.run!({ db, sceneId: 1 });
    expect(typeof said).toBe("string");
    expect(said as string).toMatch(/^d20: \d+ against 11 — (success|failure)\.$/);
    // And it is the number that was recorded, not a second roll.
    expect(said as string).toContain(String(log(db)[0]!["total"]));
  });

  test("a dice setting that is not a roll says so rather than failing quietly", async () => {
    const reg = await tabletop({ dice: "twenty" });
    const said = await reg.actions.find((entry) => entry.key === "roll")!.run!({
      db: stateDb(),
      sceneId: 1,
    });
    expect(said as string).toContain("not a roll");
  });

  test("a roll with no scene does nothing", async () => {
    // The global path passes `sceneId: null`; there is nowhere to record it.
    const reg = await tabletop();
    const db = stateDb();
    await reg.actions.find((entry) => entry.key === "roll")!.run!({ db, sceneId: null });
    expect(log(db)).toEqual([]);
  });

  test("what reaches the prompt is a settled fact, not an instruction to roll", async () => {
    const reg = await tabletop();
    const db = stateDb();
    await reg.actions.find((entry) => entry.key === "roll")!.run!({ db, sceneId: 1 });

    const injection = reg.injections.find((entry) => entry.key === "roll");
    expect(injection).toBeDefined();
    const text = injection!.render({ db, sceneId: 1 });
    expect(text).not.toBeNull();
    // §22's rule, read back off the text the model will actually see.
    expect(text!).toContain("already happened");
    expect(text!).toMatch(/do not roll again/i);
    expect(text!).toMatch(/Rolled d20: \d+ against 11/);
  });

  test("a roll reaches the model once, not on every build", async () => {
    const reg = await tabletop();
    const db = stateDb();
    await reg.actions.find((entry) => entry.key === "roll")!.run!({ db, sceneId: 1 });
    const injection = reg.injections.find((entry) => entry.key === "roll")!;
    expect(injection.render({ db, sceneId: 1 })).not.toBeNull();
    // A roll that kept reappearing would have the story tell it twice.
    expect(injection.render({ db, sceneId: 1 })).toBeNull();
  });

  test("nothing rolled means nothing injected", async () => {
    const reg = await tabletop();
    expect(reg.injections.find((entry) => entry.key === "roll")!.render({ db: stateDb(), sceneId: 1 })).toBeNull();
  });

  test("a malformed log loses the history, never the turn", async () => {
    const reg = await tabletop();
    const db = stateDb();
    db.run(
      "INSERT INTO extension_state (extension_name, scene_id, key, value, updated_at) VALUES ('Tabletop', 1, 'rolls', 'not json', 0)",
    );
    // An extension that threw here would fail a generation.
    expect(() => reg.injections.find((entry) => entry.key === "roll")!.render({ db, sceneId: 1 })).not.toThrow();
    await reg.actions.find((entry) => entry.key === "roll")!.run!({ db, sceneId: 1 });
    expect(log(db).length).toBe(1);
  });

  test("the log is bounded, so a long scene does not carry a thousand rolls", async () => {
    const reg = await tabletop();
    const db = stateDb();
    const roll = reg.actions.find((entry) => entry.key === "roll")!.run!;
    for (let i = 0; i < 55; i++) await roll({ db, sceneId: 1 });
    expect(log(db).length).toBe(50);
  });

  /**
   * Two rolls in the same millisecond are two rolls.
   *
   * The first version seeded on `Date.now()` alone, so a burst of rolls came
   * back identical — a loaded die, and the kind a reader notices long before
   * a test does. The first *guard* for it was statistical (roll forty, expect
   * more than one value) and it passed against the defect, because the clock
   * does tick between most rolls. So this tests the derivation instead, which
   * is deterministic and is the thing that was actually wrong.
   */
  test("two rolls in one millisecond are seeded differently", () => {
    expect(rollSeed(1, 0, 1_000)).not.toBe(rollSeed(1, 1, 1_000));
  });

  test("the same roll in two scenes is seeded differently", () => {
    expect(rollSeed(1, 0, 1_000)).not.toBe(rollSeed(2, 0, 1_000));
  });

  test("a dice setting that is not a roll rolls nothing", async () => {
    const reg = await tabletop({ dice: "twenty" });
    const db = stateDb();
    await reg.actions.find((entry) => entry.key === "roll")!.run!({ db, sceneId: 1 });
    expect(log(db)).toEqual([]);
  });
});

describe("what this slice is not", () => {
  /**
   * §40's own words: the user-defined schemas are "a product in its own right".
   * This pins the split so a later phase adds stats deliberately rather than
   * by drift.
   */
  test("no stats, no inventory, no schema language", () => {
    const source = readFileSync(join(ROOT, "server", "extensions", "builtins.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    for (const word of ["inventory", "statSchema", "schemaLanguage"]) {
      expect({ word, present: source.includes(word) }).toMatchObject({ present: false });
    }
  });

  test("it is a built-in, which is seeded disabled", () => {
    // §21 lists a code-executing runtime as a non-goal and a built-in needs
    // none. Seeded disabled: an extension that changes every prompt must be
    // something the operator chose.
    const install = readFileSync(join(ROOT, "server", "extensions", "install.ts"), "utf8");
    expect(install).toContain("seeded disabled so it never surprises");
    expect(BUILTINS.some((entry) => entry.name === "Tabletop")).toBe(true);
  });
});
