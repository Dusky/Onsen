import { afterEach, describe, expect, test } from "bun:test";
import { openDatabase } from "../server/db/index.ts";
import { migrate } from "../server/db/migrate.ts";
import {
  activePath,
  appendMessage,
  insertScene,
  sceneDto,
  setActiveLeaf,
  type SceneRow,
} from "../server/db/queries/history.ts";

/**
 * The story stays reachable, and the count says what the log shows
 * (§20 phase 189).
 *
 * Both halves come from one reported scene: eleven messages stored, one turn on
 * screen, "11 turns" in the header above it. Neither half was a rendering bug —
 * the tree walk preferred the wrong branch, and the count measured the wrong
 * set. Executed against a real database rather than read as source, because
 * these are SQL orderings and a recursive count: the failure mode is a query
 * that is subtly wrong, which no amount of reading the call site catches.
 */

let db: ReturnType<typeof openDatabase> | null = null;

function fresh(): { db: ReturnType<typeof openDatabase>; scene: SceneRow } {
  db = openDatabase(":memory:");
  migrate(db);
  return { db, scene: insertScene(db, { title: "Test scene" }) };
}

afterEach(() => {
  db?.close();
  db = null;
});

/** A story turn. */
function turn(
  database: ReturnType<typeof openDatabase>,
  scene: SceneRow,
  parentId: number | null,
  content: string,
) {
  return appendMessage(database, {
    sceneId: scene.id,
    parentId,
    kind: "spotlight",
    authorType: "character",
    content,
  });
}

/** An off-script message — the reader's question or the author's aside. */
function aside(
  database: ReturnType<typeof openDatabase>,
  scene: SceneRow,
  parentId: number | null,
  content: string,
) {
  return appendMessage(database, {
    sceneId: scene.id,
    parentId,
    kind: "ooc",
    authorType: "ooc",
    content,
  });
}

/** What the log would actually render: the path, minus what it hides. */
function readable(database: ReturnType<typeof openDatabase>, scene: SceneRow): string[] {
  return activePath(database, scene.id)
    .filter((row) => row.kind !== "ooc" && row.is_hidden === 0)
    .map((row) => row.content);
}

describe("off-script cannot shadow the story", () => {
  test("rewinding to an ancestor returns to the story, not the aside branch", () => {
    const { db: database, scene } = fresh();
    // A story six turns long.
    let at: number | null = null;
    const ids: number[] = [];
    for (const line of ["one", "two", "three", "four", "five", "six"]) {
      at = turn(database, scene, at, line).id;
      ids.push(at);
    }
    // The reader rewinds to turn one and asks something off-script there. The
    // aside chain is newer than every story turn, which is the whole problem.
    aside(database, scene, ids[0]!, "who built this inn?");

    // Now they rewind to turn one again — to reread, or to branch.
    setActiveLeaf(database, scene.id, ids[0]!);

    // They land back in the story, not in the side conversation.
    expect(readable(database, scene)).toEqual(["one", "two", "three", "four", "five", "six"]);
  });

  test("a newer story sibling still wins, so swiping back is unaffected", () => {
    const { db: database, scene } = fresh();
    const root = turn(database, scene, null, "one");
    turn(database, scene, root.id, "two");
    const second = turn(database, scene, root.id, "two, differently");
    // Within the story, the most recent child is still the one restored — the
    // property that makes swiping away from a sibling and back again return to
    // that sibling's own continuation.
    turn(database, scene, second.id, "three, on the newer branch");
    setActiveLeaf(database, scene.id, root.id);
    expect(readable(database, scene)).toEqual([
      "one",
      "two, differently",
      "three, on the newer branch",
    ]);
  });

  test("an off-script branch is still reachable when it is the only child", () => {
    const { db: database, scene } = fresh();
    const root = turn(database, scene, null, "one");
    const asked = aside(database, scene, root.id, "who built this inn?");
    setActiveLeaf(database, scene.id, root.id);
    // Nothing else to descend into, so the conversation is not orphaned either.
    expect(activePath(database, scene.id).map((row) => row.id)).toEqual([root.id, asked.id]);
  });
});

describe("the count is what the reader can read", () => {
  const shapes: [string, (d: ReturnType<typeof openDatabase>, s: SceneRow) => void, number][] = [
    ["an empty scene", () => {}, 0],
    [
      "a plain three-turn story",
      (d, s) => {
        let at: number | null = null;
        for (const line of ["one", "two", "three"]) at = turn(d, s, at, line).id;
      },
      3,
    ],
    [
      "a swiped turn, whose alternate is stored but not read",
      (d, s) => {
        const root = turn(d, s, null, "one");
        turn(d, s, root.id, "two");
        turn(d, s, root.id, "two, differently");
      },
      2,
    ],
    [
      "an off-script exchange at the tip",
      (d, s) => {
        const root = turn(d, s, null, "one");
        const next = turn(d, s, root.id, "two");
        aside(d, s, next.id, "who built this inn?");
      },
      2,
    ],
    [
      "a hidden note",
      (d, s) => {
        const root = turn(d, s, null, "one");
        appendMessage(d, {
          sceneId: s.id,
          parentId: root.id,
          kind: "system",
          authorType: "system",
          content: "a note nobody reads",
          isHidden: true,
        });
      },
      1,
    ],
  ];

  for (const [name, build, expected] of shapes) {
    test(`${name} counts ${expected}`, () => {
      const { db: database, scene } = fresh();
      build(database, scene);
      // Read the row back so the leaf is whatever the writes left it at.
      const row = database
        .query("SELECT * FROM scenes WHERE id = $id")
        .get({ id: scene.id }) as SceneRow;
      const counted = sceneDto(database, row).turnCount;
      expect(counted).toBe(expected);
      // The count and the log agree — the property the header was breaking.
      expect(counted).toBe(readable(database, row).length);
    });
  }
});

describe("the roleplay list previews the story", () => {
  test("an off-script leaf does not become the scene's last line", () => {
    const { db: database, scene } = fresh();
    const root = turn(database, scene, null, "Elira sets a clay cup down.");
    aside(database, scene, root.id, "ooc: who built this inn?");
    const row = database.query("SELECT * FROM scenes WHERE id = $id").get({ id: scene.id }) as SceneRow;
    expect(sceneDto(database, row).lastLine).toBe("Elira sets a clay cup down.");
  });

  test("a hidden note does not either", () => {
    const { db: database, scene } = fresh();
    const root = turn(database, scene, null, "Elira sets a clay cup down.");
    appendMessage(database, {
      sceneId: scene.id,
      parentId: root.id,
      kind: "system",
      authorType: "system",
      content: "a note nobody reads",
      isHidden: true,
    });
    const row = database.query("SELECT * FROM scenes WHERE id = $id").get({ id: scene.id }) as SceneRow;
    expect(sceneDto(database, row).lastLine).toBe("Elira sets a clay cup down.");
  });
});

describe("a scene already stranded says so", () => {
  test("parked on an off-script row, it names the turns further on", () => {
    const { db: database, scene } = fresh();
    const root = turn(database, scene, null, "one");
    const two = turn(database, scene, root.id, "two");
    turn(database, scene, two.id, "three");
    // The reader rewound to turn one and asked something; the chain became the
    // stored leaf. Phase 189 stops this happening, but not to data that has it.
    const asked = aside(database, scene, root.id, "who built this inn?");
    database
      .query("UPDATE scenes SET active_leaf_id = $leaf WHERE id = $id")
      .run({ leaf: asked.id, id: scene.id });

    const row = database.query("SELECT * FROM scenes WHERE id = $id").get({ id: scene.id }) as SceneRow;
    const dto = sceneDto(database, row);
    // One readable turn on this path, three on the story branch.
    expect(dto.turnCount).toBe(1);
    expect(dto.strandedStory).not.toBeNull();
    expect(dto.strandedStory!.turns).toBe(2);
  });

  test("an ordinary scene says nothing", () => {
    const { db: database, scene } = fresh();
    let at: number | null = null;
    for (const line of ["one", "two"]) at = turn(database, scene, at, line).id;
    const row = database.query("SELECT * FROM scenes WHERE id = $id").get({ id: scene.id }) as SceneRow;
    expect(sceneDto(database, row).strandedStory).toBeNull();
  });

  test("an off-script exchange at the tip is not stranded — there is nothing past it", () => {
    const { db: database, scene } = fresh();
    const root = turn(database, scene, null, "one");
    const next = turn(database, scene, root.id, "two");
    aside(database, scene, next.id, "what did she mean?");
    const row = database.query("SELECT * FROM scenes WHERE id = $id").get({ id: scene.id }) as SceneRow;
    // Asking a question from where you are reading is normal, not a fault.
    expect(sceneDto(database, row).strandedStory).toBeNull();
  });

  test("swiping to a shorter story branch is a choice, not a fault", () => {
    const { db: database, scene } = fresh();
    const root = turn(database, scene, null, "one");
    const long = turn(database, scene, root.id, "two");
    turn(database, scene, long.id, "three");
    const short = turn(database, scene, root.id, "two, differently");
    database
      .query("UPDATE scenes SET active_leaf_id = $leaf WHERE id = $id")
      .run({ leaf: short.id, id: scene.id });
    const row = database.query("SELECT * FROM scenes WHERE id = $id").get({ id: scene.id }) as SceneRow;
    expect(sceneDto(database, row).strandedStory).toBeNull();
  });
});
