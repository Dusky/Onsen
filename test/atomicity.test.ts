import { afterEach, describe, expect, test } from "bun:test";
import { completeSetup, createHarness, type TestHarness } from "./helpers.ts";
import { pngCard } from "./card-fixtures.ts";
import { setDefaultBackground, insertBackground } from "../server/db/queries/backgrounds.ts";
import { insertAuthor, insertPersona, updateAuthor, updatePersona } from "../server/db/queries/authors.ts";

/**
 * Writes that must land whole or not at all (the server-hardening pass).
 *
 * Four places did "clear the old, set the new" or "insert a thing and then the
 * things that belong to it" as separate unguarded statements. None of them is
 * rare: they are picking a default background, a default author, a default
 * persona, and importing a card — which is also the SillyTavern migration's
 * only path in, so it happens two hundred times in a row or not at all.
 *
 * The failures are quiet, which is why they lasted. A throw between the clear
 * and the set leaves **zero** rows holding a `is_default` flag that a partial
 * unique index says at most one row may hold: no error, no default, and no
 * screen that can show the state. A throw partway through a card import leaves
 * a committed character with half a lorebook bound to it, and the same file
 * imported again makes a second character rather than repairing the first.
 *
 * Proving the second needs a failure that is certain rather than plausible, so
 * these reach past the parser and make the *database* refuse the write. That
 * is the boundary under test — not any particular malformed card, which is a
 * question for the import tests next door.
 */

let harness: TestHarness | null = null;

async function signedIn(): Promise<TestHarness> {
  if (harness === null) {
    harness = createHarness();
    await completeSetup(harness);
  }
  return harness;
}

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

function count(t: TestHarness, table: string): number {
  return (t.ctx.db.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
}

/** How many rows hold the flag the partial unique index allows one of. */
function defaults(t: TestHarness, table: string): number {
  return (
    t.ctx.db.query(`SELECT count(*) AS n FROM ${table} WHERE is_default = 1`).get() as { n: number }
  ).n;
}

describe("exactly one row is the default", () => {
  test("moving the default background never leaves none", async () => {
    const t = await signedIn();
    const first = insertBackground(t.ctx.db, { path: "a.png", prompt: "a" });
    const second = insertBackground(t.ctx.db, { path: "b.png", prompt: "b" });

    // The first one made is the default, which is what `insertBackground` does.
    expect(defaults(t, "backgrounds")).toBe(1);
    const moved = setDefaultBackground(t.ctx.db, second.id);

    expect(moved.id).toBe(second.id);
    expect(moved.is_default).toBe(1);
    expect(defaults(t, "backgrounds")).toBe(1);
    expect(
      (t.ctx.db.query("SELECT is_default FROM backgrounds WHERE id = $id").get({ id: first.id }) as {
        is_default: number;
      }).is_default,
    ).toBe(0);
  });

  test("the same row twice is still one default, not zero", async () => {
    // The `CASE` form has to set as well as clear. A "clear everything, then
    // set" pair that short-circuits when the row is already default would pass
    // the test above and fail this one.
    const t = await signedIn();
    const only = insertBackground(t.ctx.db, { path: "a.png", prompt: "a" });
    setDefaultBackground(t.ctx.db, only.id);
    setDefaultBackground(t.ctx.db, only.id);
    expect(defaults(t, "backgrounds")).toBe(1);
  });

  for (const subject of ["author", "persona"] as const) {
    test(`a failed ${subject} patch does not clear the old default`, async () => {
      const t = await signedIn();
      const table = subject === "author" ? "authors" : "personas";
      const insert = subject === "author" ? insertAuthor : insertPersona;
      const update = subject === "author" ? updateAuthor : updatePersona;

      const first = insert(t.ctx.db, "First");
      const second = insert(t.ctx.db, "Second");
      update(t.ctx.db, first.id, { isDefault: true });
      expect(defaults(t, table)).toBe(1);

      // Make the set half fail after the clear half has run. Before the fix
      // the two were separate statements and this left no default at all.
      t.ctx.db
        .query(
          `CREATE TRIGGER refuse_${table} BEFORE UPDATE OF name ON ${table}
           BEGIN SELECT RAISE(ABORT, 'refused'); END`,
        )
        .run();
      expect(() => update(t.ctx.db, second.id, { isDefault: true, name: "Second again" })).toThrow();
      t.ctx.db.query(`DROP TRIGGER refuse_${table}`).run();

      expect(defaults(t, table)).toBe(1);
      expect(
        (
          t.ctx.db.query(`SELECT is_default FROM ${table} WHERE id = $id`).get({ id: first.id }) as {
            is_default: number;
          }
        ).is_default,
      ).toBe(1);
    });
  }
});

describe("a card import lands whole or not at all", () => {
  const CARD_WITH_BOOK = {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: "Ridge Warden",
      description: "Keeps the pass.",
      character_book: {
        name: "Ridge lore",
        entries: [
          { keys: ["ridge"], content: "The road closed in the spring." },
          { keys: ["pass"], content: "The pass is watched." },
        ],
      },
    },
  };

  test("a lorebook the database refuses takes the character with it", async () => {
    const t = await signedIn();
    expect(count(t, "characters")).toBe(0);

    // Past the parser, which coerces every field a card can carry and so
    // cannot be made to throw from card data alone. This refuses the write
    // itself, which is the boundary the transaction draws.
    t.ctx.db
      .query(
        `CREATE TRIGGER refuse_entries BEFORE INSERT ON lore_entries
         BEGIN SELECT RAISE(ABORT, 'refused'); END`,
      )
      .run();

    const form = new FormData();
    form.append(
      "file",
      new File([pngCard({ chara: CARD_WITH_BOOK }) as unknown as BlobPart], "warden.png"),
    );
    const response = await t.fetch("/api/characters/import", { method: "POST", body: form });
    t.ctx.db.query("DROP TRIGGER refuse_entries").run();

    expect(response.ok).toBe(false);
    // The character is the one that used to survive: it was inserted first,
    // and nothing rolled it back when the lorebook beside it failed.
    expect(count(t, "characters")).toBe(0);
    expect(count(t, "lorebooks")).toBe(0);
    expect(count(t, "lore_entries")).toBe(0);
  });

  test("and lands everything when nothing refuses it", async () => {
    // The other half of the guard: a transaction that rolled back always would
    // pass the test above.
    const t = await signedIn();
    const form = new FormData();
    form.append(
      "file",
      new File([pngCard({ chara: CARD_WITH_BOOK }) as unknown as BlobPart], "warden.png"),
    );
    const response = await t.fetch("/api/characters/import", { method: "POST", body: form });

    expect(response.status).toBe(201);
    expect(count(t, "characters")).toBe(1);
    expect(count(t, "lorebooks")).toBe(1);
    expect(count(t, "lore_entries")).toBe(2);
  });
});
