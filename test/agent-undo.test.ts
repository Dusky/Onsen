import { afterEach, describe, expect, test } from "bun:test";
import { completeSetup, createHarness, type TestHarness } from "./helpers.ts";
import { V2_CARD, pngCard } from "./card-fixtures.ts";
import { TOOLS } from "../server/agent/tools.ts";
import { snapshots } from "../server/agent/snapshot.ts";
import { UNDO_KINDS, type UndoKind } from "../shared/types.ts";
import { strings } from "../client/strings.ts";
import { restoreSnapshot } from "../server/agent/restore.ts";
import { insertScene, findScene } from "../server/db/queries/history.ts";
import { insertLorebook, insertEntry, findEntry } from "../server/db/queries/lore.ts";
import { insertPersona, findAuthor, insertAuthor, listAuthors } from "../server/db/queries/authors.ts";
import { insertTheme, activeTheme, findTheme } from "../server/db/queries/themes.ts";
import { insertCharacterGroup } from "../server/db/queries/groups.ts";
import { findCharacter } from "../server/db/queries/characters.ts";
import type { CharacterDto } from "../shared/types.ts";

/**
 * Nothing the assistant does to the library is unrecoverable (§20 phase 219).
 *
 * The assistant's own screen says "every change it makes is listed under Undo",
 * and for a long time that was two changes out of nineteen: `snapshotBefore`
 * was called by `delete_character` and `update_theme`, and the restore half
 * knew those same two kinds. An overwritten author, an emptied lorebook, a
 * recast scene — all gone with nothing kept.
 *
 * So this guard does not read the source and it does not name the tools that
 * are supposed to snapshot. It **runs every tool in the registry against a real
 * database** and asks the only question worth asking: did this change a row,
 * and if it did, is there something to go back to? A write added later without
 * a snapshot fails here without anybody remembering to extend a list, which is
 * the difference between this and `test/next-turn-cue.test.ts`'s string match.
 *
 * `total_changes()` is the detector. SQLite counts every row inserted, updated
 * or deleted on the connection, so "this tool wrote" needs no declaration.
 */

let harness: TestHarness | null = null;

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

/**
 * Tools that change the library and record nothing, each with the reason.
 *
 * Empty, and meant to stay that way — it exists so that a tool which genuinely
 * cannot be undone has somewhere to say so out loud rather than failing the
 * suite silently or being quietly skipped. An entry here is a promise the
 * assistant's blurb has to stop making.
 */
const NO_UNDO: Record<string, string> = {};

interface Fixture {
  character: CharacterDto;
  sceneId: string;
  lorebookId: string;
  entryId: string;
  personaId: string;
  authorId: string;
  themeId: string;
  groupId: string;
  otherCharacterId: string;
}

async function seeded(): Promise<{ t: TestHarness; fixture: Fixture }> {
  const t = createHarness({});
  harness = t;
  await completeSetup(t);

  const form = new FormData();
  form.append("file", new File([pngCard({ chara: V2_CARD }) as unknown as BlobPart], "bell.png"));
  const imported = (await (
    await t.fetch("/api/characters/import", { method: "POST", body: form })
  ).json()) as { character: CharacterDto };

  const scene = insertScene(t.ctx.db, { title: "A scene to change" });
  const book = insertLorebook(t.ctx.db, { name: "A book", rawImport: null });
  const entry = insertEntry(t.ctx.db, book.id, "Something the author is told.");
  const persona = insertPersona(t.ctx.db, "Someone");
  const theme = insertTheme(t.ctx.db, { name: "A theme", base: "dark", tokens: {} });
  const group = insertCharacterGroup(t.ctx.db, { name: "A group" });
  const author =
    listAuthors(t.ctx.db)[0] ?? insertAuthor(t.ctx.db, "Mara");

  return {
    t,
    fixture: {
      character: imported.character,
      otherCharacterId: imported.character.id,
      sceneId: scene.ulid,
      lorebookId: book.ulid,
      entryId: entry.ulid,
      personaId: persona.ulid,
      authorId: author.ulid,
      themeId: theme.ulid,
      groupId: group.ulid,
    },
  };
}

/**
 * Arguments good enough for each tool to do its job — a list per tool, because
 * `upsert_persona` is two tools in one name and both halves need reaching.
 *
 * A tool missing from here is called with none, which is right for the reads
 * that take no parameters. A *write* missing from here would run, throw on its
 * required argument, change nothing and pass — so the coverage test below
 * requires every tool whose schema has required fields to be listed.
 */
function argsFor(f: Fixture): Record<string, Record<string, unknown>[]> {
  const calls: Record<string, Record<string, unknown> | Record<string, unknown>[]> = {
    get_character: { id: f.character.id },
    search_characters: { query: "bell" },
    update_character: { id: f.character.id, description: "Rewritten by the assistant." },
    delete_character: { id: f.character.id },
    read_scene: { id: f.sceneId },
    create_scene: { title: "Made by the assistant" },
    update_scene: {
      id: f.sceneId,
      title: "Renamed by the assistant",
      scenarioOverride: "A different framing.",
      turnStrategy: "round_robin",
    },
    add_note_to_scene: { id: f.sceneId, text: "A note." },
    read_lorebook: { id: f.lorebookId },
    create_lorebook: { name: "Made by the assistant" },
    add_lore_entry: { lorebookId: f.lorebookId, content: "A new fact.", keys: ["inn"] },
    upsert_persona: [
      { name: "Made by the assistant" },
      { id: f.personaId, name: "Renamed", description: "Changed." },
    ],
    create_theme: { name: "Made by the assistant", base: "dark", tokens: { "color-bg": "#101010" } },
    set_theme: { id: f.themeId },
    update_theme: { id: f.themeId, tokens: { "color-bg": "#202020" } },
    get_author: { id: f.authorId },
    update_author: { id: f.authorId, personality: "Rewritten." },
    add_to_cast: { sceneId: f.sceneId, characterId: f.character.id },
    remove_from_cast: { sceneId: f.sceneId, characterId: f.character.id },
    update_lore_entry: { id: f.entryId, title: "Retitled", content: "Rewritten." },
    delete_lore_entry: { id: f.entryId },
    create_group: { name: "Made by the assistant" },
    add_to_group: { groupId: f.groupId, characterId: f.character.id },
    remove_from_group: { groupId: f.groupId, characterId: f.character.id },
  };
  return Object.fromEntries(
    Object.entries(calls).map(([name, value]) => [name, Array.isArray(value) ? value : [value]]),
  );
}

/**
 * Tools run last in the sweep, because they remove something the others need.
 *
 * Deleting the fixture character before `add_to_cast` reaches it would leave
 * four tools refusing on a missing subject and the sweep reporting a pass over
 * work it never did — which is the failure mode this whole file exists to
 * catch, so it must not be the shape of the file itself.
 */
const DESTRUCTIVE_LAST = ["delete_character"];

function sweepOrder(): [string, (typeof TOOLS)[string]][] {
  const entries = Object.entries(TOOLS);
  return [
    ...entries.filter(([name]) => !DESTRUCTIVE_LAST.includes(name)),
    ...entries.filter(([name]) => DESTRUCTIVE_LAST.includes(name)),
  ];
}

const changes = (t: TestHarness): number =>
  (t.ctx.db.query("SELECT total_changes() AS n").get() as { n: number }).n;

describe("every change the assistant makes is recoverable", () => {
  test("a tool that writes a row leaves a snapshot behind", async () => {
    const { t, fixture } = await seeded();
    const args = argsFor(fixture);
    const wrote: string[] = [];
    const unrecorded: string[] = [];

    for (const [name, tool] of sweepOrder()) {
      // Each tool is measured on a library in whatever state the one before it
      // left — which is the honest sequence, since that is how the agent calls
      // them. `add_to_cast` runs before `remove_from_cast` for that reason.
      for (const call of args[name] ?? [{}]) {
        const before = changes(t);
        const kept = snapshots(t.ctx).length;
        try {
          tool.run(t.ctx, call);
        } catch {
          // A tool that refused wrote nothing, which the counters below
          // confirm rather than assume.
        }
        if (changes(t) === before) continue;
        if (!wrote.includes(name)) wrote.push(name);
        if (snapshots(t.ctx).length === kept && NO_UNDO[name] === undefined) {
          unrecorded.push(name);
        }
      }
    }

    // The list is in the failure message on purpose: a name here is a tool that
    // changed the library with nothing to go back to.
    expect(unrecorded).toEqual([]);
    // And the sweep has to have actually swept. Nineteen tools write; if this
    // number falls, the fixtures stopped reaching them and the test above is
    // passing on tools it never ran.
    expect(wrote.length).toBeGreaterThanOrEqual(19);
  });

  test("a tool that only reads changes nothing at all", async () => {
    const { t, fixture } = await seeded();
    const args = argsFor(fixture);
    const reads = [
      "list_characters",
      "search_characters",
      "get_character",
      "list_scenes",
      "read_scene",
      "list_lorebooks",
      "read_lorebook",
      "list_personas",
      "list_themes",
      "list_authors",
      "get_author",
      "list_groups",
      "list_documents",
    ];
    for (const name of reads) {
      const before = changes(t);
      for (const call of args[name] ?? [{}]) TOOLS[name]!.run(t.ctx, call);
      expect({ name, wrote: changes(t) - before }).toEqual({ name, wrote: 0 });
    }
  });

  test("every write tool with required arguments is exercised above", async () => {
    // The coverage hole this closes: a write whose required argument is missing
    // throws before it writes, so the sweep would pass having tested nothing.
    const { fixture } = await seeded();
    const args = argsFor(fixture);
    const missing = Object.entries(TOOLS)
      .filter(([name, tool]) => {
        const required = tool.spec.parameters["required"];
        return Array.isArray(required) && required.length > 0 && args[name] === undefined;
      })
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });
});

describe("and the restore half knows every kind", () => {
  test("each kind the tools record is one restoreSnapshot handles", async () => {
    const { t, fixture } = await seeded();
    const args = argsFor(fixture);
    const seen = new Set<UndoKind>();

    for (const [name, tool] of sweepOrder()) {
      for (const call of args[name] ?? [{}]) {
        try {
          tool.run(t.ctx, call);
        } catch {
          /* as above */
        }
      }
    }
    for (const snapshot of snapshots(t.ctx)) seen.add(snapshot.kind);

    // Every kind in the union is reachable by running the tools, so the list
    // has no dead entries and `restoreSnapshot`'s exhaustive switch is not
    // carrying branches nothing can produce.
    const unreachable = UNDO_KINDS.filter((kind) => !seen.has(kind));
    expect(unreachable).toEqual([]);

    // And every recorded snapshot walks back without throwing. The switch is
    // exhaustive at compile time; this is the runtime half.
    for (const snapshot of snapshots(t.ctx)) {
      expect(() => restoreSnapshot(t.ctx, snapshot)).not.toThrow();
    }
  });

  test("an overwritten author comes back", async () => {
    const { t, fixture } = await seeded();
    const before = findAuthor(t.ctx.db, fixture.authorId)!.personality;
    TOOLS["update_author"]!.run(t.ctx, {
      id: fixture.authorId,
      personality: "Someone else entirely.",
    });
    expect(findAuthor(t.ctx.db, fixture.authorId)!.personality).toBe("Someone else entirely.");

    restoreSnapshot(t.ctx, snapshots(t.ctx)[0]!);
    expect(findAuthor(t.ctx.db, fixture.authorId)!.personality).toBe(before);
  });

  test("a deleted lore entry comes back into its book", async () => {
    const { t, fixture } = await seeded();
    TOOLS["update_lore_entry"]!.run(t.ctx, { id: fixture.entryId, title: "The inn's keeper" });
    TOOLS["delete_lore_entry"]!.run(t.ctx, { id: fixture.entryId });
    expect(findEntry(t.ctx.db, fixture.entryId)).toBeNull();

    const restored = restoreSnapshot(t.ctx, snapshots(t.ctx)[0]!) as { id?: string };
    // A new row, so a new id — which the note says, because anything that
    // referred to the old entry does not follow it back.
    const back = findEntry(t.ctx.db, restored.id!);
    expect(back).not.toBeNull();
    expect(back!.title).toBe("The inn's keeper");
    expect(back!.content).toBe("Something the author is told.");
  });

  test("a scene the assistant made is deleted again, cast and all", async () => {
    const { t, fixture } = await seeded();
    TOOLS["create_scene"]!.run(t.ctx, {
      title: "Made by the assistant",
      characterIds: [fixture.character.id],
    });
    const snapshot = snapshots(t.ctx)[0]!;
    expect(findScene(t.ctx.db, snapshot.subjectId)).not.toBeNull();

    restoreSnapshot(t.ctx, snapshot);
    expect(findScene(t.ctx.db, snapshot.subjectId)).toBeNull();
    // The character it was cast with is library state, not scene state, and
    // stays exactly where it was.
    expect(findCharacter(t.ctx.db, fixture.character.id)).not.toBeNull();
  });

  test("a recast scene goes back to the cast it had", async () => {
    const { t, fixture } = await seeded();
    const scene = findScene(t.ctx.db, fixture.sceneId)!;
    TOOLS["add_to_cast"]!.run(t.ctx, {
      sceneId: fixture.sceneId,
      characterId: fixture.character.id,
    });
    const members = () =>
      (
        t.ctx.db
          .query("SELECT COUNT(*) AS n FROM scene_members WHERE scene_id = $id")
          .get({ id: scene.id }) as { n: number }
      ).n;
    expect(members()).toBe(1);

    restoreSnapshot(t.ctx, snapshots(t.ctx)[0]!);
    expect(members()).toBe(0);
  });

  test("the theme that was active is made active again", async () => {
    const { t, fixture } = await seeded();
    const was = activeTheme(t.ctx.db)!.ulid;
    TOOLS["set_theme"]!.run(t.ctx, { id: fixture.themeId });
    expect(activeTheme(t.ctx.db)!.ulid).toBe(fixture.themeId);

    restoreSnapshot(t.ctx, snapshots(t.ctx)[0]!);
    expect(activeTheme(t.ctx.db)!.ulid).toBe(was);
  });

  test("a theme the assistant made is not deleted while the app is wearing it", async () => {
    const { t } = await seeded();
    TOOLS["create_theme"]!.run(t.ctx, {
      name: "Made by the assistant",
      base: "dark",
      tokens: { "color-bg": "#101010" },
    });
    const created = snapshots(t.ctx)[0]!;
    TOOLS["set_theme"]!.run(t.ctx, { id: created.subjectId });

    const note = restoreSnapshot(t.ctx, created) as { note?: string };
    expect(note.note).toContain("in use");
    expect(findTheme(t.ctx.db, created.subjectId)).not.toBeNull();
  });
});

describe("update_scene writes the fields it advertises", () => {
  test("the scenario and the turn strategy land, not just the title", async () => {
    // All three were described to the model; two of them were spread into a
    // patch type that has no such keys, so they were reported as changed and
    // dropped (§20 phase 219).
    const { t, fixture } = await seeded();
    TOOLS["update_scene"]!.run(t.ctx, {
      id: fixture.sceneId,
      title: "Renamed",
      scenarioOverride: "A very specific framing.",
      turnStrategy: "round_robin",
    });
    const row = findScene(t.ctx.db, fixture.sceneId)!;
    expect(row.title).toBe("Renamed");
    expect(row.scenario_override).toBe("A very specific framing.");
    expect(row.turn_strategy).toBe("round_robin");
  });

  test("a strategy the schema does not offer is refused, not written", async () => {
    const { t, fixture } = await seeded();
    expect(() =>
      TOOLS["update_scene"]!.run(t.ctx, { id: fixture.sceneId, turnStrategy: "whoever" }),
    ).toThrow(/turnStrategy/);
    expect(findScene(t.ctx.db, fixture.sceneId)!.turn_strategy).toBe("manual");
  });

  test("and undoing it puts all three back", async () => {
    const { t, fixture } = await seeded();
    TOOLS["update_scene"]!.run(t.ctx, {
      id: fixture.sceneId,
      title: "Renamed",
      scenarioOverride: "A very specific framing.",
      turnStrategy: "classifier",
    });
    restoreSnapshot(t.ctx, snapshots(t.ctx)[0]!);
    const row = findScene(t.ctx.db, fixture.sceneId)!;
    expect(row.title).toBe("A scene to change");
    expect(row.scenario_override).toBeNull();
    expect(row.turn_strategy).toBe("manual");
  });
});

describe("and the reader is told in words what it was", () => {
  test("every kind has words; none of them reaches the screen raw", () => {
    /*
     * The list rendered the server's `kind` until §20 phase 219 — fine while
     * there were two of them, a raw storage key on screen the moment there
     * were nineteen. This is the same guard shape as phase 190's
     * `blockNames`: a map typed against the union, swept for completeness
     * rather than spot-checked.
     */
    const words = strings.assistant.undoKinds as Record<string, string>;
    const missing = UNDO_KINDS.filter((kind) => (words[kind] ?? "").trim() === "");
    expect(missing).toEqual([]);

    for (const kind of UNDO_KINDS) {
      const rendered = strings.assistant.undoEntry(kind, "Elira Voss");
      // Neither the kind nor the underscore-and-dot shape of it survives.
      expect(rendered).not.toContain(kind);
      expect(rendered).not.toMatch(/_|\w\.\w/);
      expect(rendered).toContain("Elira Voss");
    }
  });

  test("a kind this build does not know still reads as the thing's name", () => {
    // A newer server against an older page: the words are unknown, the name is
    // not, and the name is what a reader needs to recognise what Restore takes
    // back.
    expect(strings.assistant.undoEntry("something.new" as UndoKind, "The Last Inn")).toBe(
      "The Last Inn",
    );
  });
});
