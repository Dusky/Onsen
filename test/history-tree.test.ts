import { afterEach, describe, expect, test } from "bun:test";
import { openDatabase } from "../server/db/index.ts";
import { migrate } from "../server/db/migrate.ts";
import {
  activePath,
  appendMessage,
  deleteMessage,
  deleteScene,
  findMessageById,
  findSceneById,
  insertCheckpoint,
  insertScene,
  isSelfOrDescendant,
  latestLeaf,
  listCheckpoints,
  setActiveLeaf,
  siblingsOf,
  updateMessage,
  type MessageRow,
  type SceneRow,
} from "../server/db/queries/history.ts";

/**
 * The tree semantics, exercised directly against the module. These are the
 * operations SPEC §23 names as mandatory: branch, swipe, edit-in-place, rewind,
 * checkpoint restore.
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

function say(
  database: ReturnType<typeof openDatabase>,
  scene: SceneRow,
  content: string,
  parent: MessageRow | null | undefined = undefined,
): MessageRow {
  return appendMessage(database, {
    sceneId: scene.id,
    parentId: parent === undefined ? (findSceneById(database, scene.id)?.active_leaf_id ?? null) : (parent?.id ?? null),
    kind: "user",
    authorType: "user",
    content,
  });
}

function pathText(database: ReturnType<typeof openDatabase>, scene: SceneRow): string[] {
  return activePath(database, scene.id).map((row) => row.content);
}

describe("the tree", () => {
  test("an empty scene has no history and no leaf", () => {
    const { db: d, scene } = fresh();
    expect(activePath(d, scene.id)).toEqual([]);
    expect(findSceneById(d, scene.id)?.active_leaf_id).toBeNull();
    expect(latestLeaf(d, scene.id)).toBeNull();
  });

  test("appending walks root to leaf in reading order", () => {
    const { db: d, scene } = fresh();
    say(d, scene, "one");
    say(d, scene, "two");
    const third = say(d, scene, "three");

    expect(pathText(d, scene)).toEqual(["one", "two", "three"]);
    expect(findSceneById(d, scene.id)?.active_leaf_id).toBe(third.id);
  });

  test("survives a chain far deeper than a real conversation", () => {
    const { db: d, scene } = fresh();
    for (let i = 0; i < 2_000; i++) say(d, scene, `turn ${i}`);
    const path = activePath(d, scene.id);
    expect(path).toHaveLength(2_000);
    expect(path[0]?.content).toBe("turn 0");
    expect(path[1_999]?.content).toBe("turn 1999");
  });
});

describe("swipes", () => {
  test("siblings under one parent are the versions of a turn", () => {
    const { db: d, scene } = fresh();
    const root = say(d, scene, "the user speaks");
    const first = say(d, scene, "reply A", root);
    const second = say(d, scene, "reply B", root);
    const third = say(d, scene, "reply C", root);

    expect(siblingsOf(d, first).map((row) => row.content)).toEqual([
      "reply A",
      "reply B",
      "reply C",
    ]);
    // The newest sibling is the active one, because appending moved the leaf.
    expect(pathText(d, scene)).toEqual(["the user speaks", "reply C"]);

    const leaf = activePath(d, scene.id).at(-1);
    expect(leaf?.sibling_index).toBe(2);
    expect(leaf?.sibling_count).toBe(3);
    expect(third.id).toBe(leaf?.id ?? -1);
    expect(second.parent_id).toBe(root.id);
  });

  test("a message with no alternates reports a count of one, not an empty carousel", () => {
    const { db: d, scene } = fresh();
    say(d, scene, "alone");
    expect(activePath(d, scene.id)[0]?.sibling_count).toBe(1);
  });

  test("swiping restores that sibling's own continuation", () => {
    const { db: d, scene } = fresh();
    const root = say(d, scene, "prompt");
    const a = say(d, scene, "reply A", root);
    say(d, scene, "A continues", a);
    say(d, scene, "A continues further");

    const b = say(d, scene, "reply B", root);
    say(d, scene, "B continues", b);
    expect(pathText(d, scene)).toEqual(["prompt", "reply B", "B continues"]);

    // Swiping back to A must bring A's continuation with it, not truncate it.
    setActiveLeaf(d, scene.id, a.id);
    expect(pathText(d, scene)).toEqual(["prompt", "reply A", "A continues", "A continues further"]);

    // And forward again to B's.
    setActiveLeaf(d, scene.id, b.id);
    expect(pathText(d, scene)).toEqual(["prompt", "reply B", "B continues"]);
  });

  test("alternate greetings are siblings at the root", () => {
    const { db: d, scene } = fresh();
    const first = say(d, scene, "greeting one", null);
    const second = say(d, scene, "greeting two", null);

    expect(first.parent_id).toBeNull();
    expect(siblingsOf(d, second)).toHaveLength(2);
    expect(activePath(d, scene.id)[0]?.sibling_count).toBe(2);

    setActiveLeaf(d, scene.id, first.id);
    expect(pathText(d, scene)).toEqual(["greeting one"]);
  });
});

describe("rewind and branch", () => {
  test("rewinding stops exactly where asked rather than descending", () => {
    const { db: d, scene } = fresh();
    const first = say(d, scene, "one");
    say(d, scene, "two");
    say(d, scene, "three");

    setActiveLeaf(d, scene.id, first.id, false);
    expect(pathText(d, scene)).toEqual(["one"]);

    // Nothing was destroyed: descending returns the abandoned continuation.
    setActiveLeaf(d, scene.id, first.id, true);
    expect(pathText(d, scene)).toEqual(["one", "two", "three"]);
  });

  test("appending after a rewind forks rather than overwriting", () => {
    const { db: d, scene } = fresh();
    const first = say(d, scene, "one");
    say(d, scene, "two");
    say(d, scene, "three");

    setActiveLeaf(d, scene.id, first.id, false);
    say(d, scene, "two, differently");

    expect(pathText(d, scene)).toEqual(["one", "two, differently"]);
    // Six messages would mean something was copied; four means it forked.
    expect(
      d.query("SELECT count(*) AS n FROM messages WHERE scene_id = $s").get({ s: scene.id }),
    ).toEqual({ n: 4 });
  });

  test("attaching to a message mid-path branches there", () => {
    const { db: d, scene } = fresh();
    say(d, scene, "one");
    const second = say(d, scene, "two");
    say(d, scene, "three");

    say(d, scene, "an alternative to three", second);
    expect(pathText(d, scene)).toEqual(["one", "two", "an alternative to three"]);
    expect(activePath(d, scene.id).at(-1)?.sibling_count).toBe(2);
  });
});

describe("editing in place", () => {
  test("a content change invalidates the cached token count and stamps edited_at", () => {
    const { db: d, scene } = fresh();
    const row = say(d, scene, "original");
    d.query("UPDATE messages SET token_count = 42 WHERE id = $id").run({ id: row.id });

    const edited = updateMessage(d, row.id, { content: "revised" });
    expect(edited.content).toBe("revised");
    expect(edited.token_count).toBeNull();
    expect(edited.edited_at).not.toBeNull();
  });

  test("hiding a message leaves its content, token count and edit stamp alone", () => {
    const { db: d, scene } = fresh();
    const row = say(d, scene, "original");
    d.query("UPDATE messages SET token_count = 42 WHERE id = $id").run({ id: row.id });

    const hidden = updateMessage(d, row.id, { isHidden: true });
    expect(hidden.is_hidden).toBe(1);
    expect(hidden.token_count).toBe(42);
    expect(hidden.edited_at).toBeNull();
  });

  test("rewriting a message with identical text is not an edit", () => {
    const { db: d, scene } = fresh();
    const row = say(d, scene, "unchanged");
    d.query("UPDATE messages SET token_count = 7 WHERE id = $id").run({ id: row.id });

    const same = updateMessage(d, row.id, { content: "unchanged" });
    expect(same.token_count).toBe(7);
    expect(same.edited_at).toBeNull();
  });

  test("editing does not move the leaf or reshape the tree", () => {
    const { db: d, scene } = fresh();
    const first = say(d, scene, "one");
    const last = say(d, scene, "two");
    updateMessage(d, first.id, { content: "one, revised" });

    expect(findSceneById(d, scene.id)?.active_leaf_id).toBe(last.id);
    expect(pathText(d, scene)).toEqual(["one, revised", "two"]);
  });
});

describe("deleting", () => {
  test("takes the subtree with it and moves the leaf to the surviving parent", () => {
    const { db: d, scene } = fresh();
    say(d, scene, "one");
    const second = say(d, scene, "two");
    say(d, scene, "three");
    say(d, scene, "four");

    deleteMessage(d, second);
    expect(pathText(d, scene)).toEqual(["one"]);
    expect(
      d.query("SELECT count(*) AS n FROM messages WHERE scene_id = $s").get({ s: scene.id }),
    ).toEqual({ n: 1 });
  });

  test("deleting off the active path leaves the leaf where it was", () => {
    const { db: d, scene } = fresh();
    const root = say(d, scene, "prompt");
    const abandoned = say(d, scene, "reply A", root);
    const current = say(d, scene, "reply B", root);

    deleteMessage(d, abandoned);
    expect(findSceneById(d, scene.id)?.active_leaf_id).toBe(current.id);
    expect(pathText(d, scene)).toEqual(["prompt", "reply B"]);
  });

  test("deleting the active branch falls back to a surviving sibling branch", () => {
    const { db: d, scene } = fresh();
    const root = say(d, scene, "prompt");
    const a = say(d, scene, "reply A", root);
    say(d, scene, "A continues", a);
    const b = say(d, scene, "reply B", root);
    say(d, scene, "B continues", b);

    deleteMessage(d, b);
    // The pointer lands on the newest surviving branch below the parent.
    expect(pathText(d, scene)).toEqual(["prompt", "reply A", "A continues"]);
  });

  test("a presence anchor moves to the surviving parent rather than being nulled", () => {
    const { db: d, scene } = fresh();
    const one = say(d, scene, "one");
    const two = say(d, scene, "two");
    say(d, scene, "three");

    const character = d
      .query(
        `INSERT INTO characters (ulid, name, raw_card, raw_card_format, created_at, updated_at)
         VALUES ('c', 'Bell', '{}', 'json', 1, 1) RETURNING id`,
      )
      .get() as { id: number };
    // Bell joined after "two", so "one" and "two" are turns she did not witness.
    d.query(
      `INSERT INTO scene_members (scene_id, character_id, joined_after_message_id, created_at)
       VALUES ($scene, $character, $anchor, 1)`,
    ).run({ scene: scene.id, character: character.id, anchor: two.id });

    deleteMessage(d, two);

    // The column is declared ON DELETE SET NULL, and null is not neutral here:
    // it means "present from the start" (SPEC §2). Left to the cascade, Bell
    // would silently become someone who witnessed "one" — which is precisely
    // the turn that survives and that she was never there for.
    const anchor = d
      .query("SELECT joined_after_message_id AS j FROM scene_members WHERE scene_id = $s")
      .get({ s: scene.id }) as { j: number | null };
    expect(anchor.j).toBe(one.id);
  });

  test("a presence anchor on the root becomes null, which is then true", () => {
    const { db: d, scene } = fresh();
    const root = say(d, scene, "one");
    const character = d
      .query(
        `INSERT INTO characters (ulid, name, raw_card, raw_card_format, created_at, updated_at)
         VALUES ('c2', 'Aldan', '{}', 'json', 1, 1) RETURNING id`,
      )
      .get() as { id: number };
    d.query(
      `INSERT INTO scene_members (scene_id, character_id, joined_after_message_id, created_at)
       VALUES ($scene, $character, $anchor, 1)`,
    ).run({ scene: scene.id, character: character.id, anchor: root.id });

    deleteMessage(d, root);

    // Nothing came before the root, so there is no earlier turn to point at —
    // and with the scene empty, "present from the start" is no longer a lie.
    const anchor = d
      .query("SELECT joined_after_message_id AS j FROM scene_members WHERE scene_id = $s")
      .get({ s: scene.id }) as { j: number | null };
    expect(anchor.j).toBeNull();
  });

  test("deleting the last root empties the scene rather than dangling the pointer", () => {
    const { db: d, scene } = fresh();
    const root = say(d, scene, "only");
    say(d, scene, "and its child");

    deleteMessage(d, root);
    expect(activePath(d, scene.id)).toEqual([]);
    expect(findSceneById(d, scene.id)?.active_leaf_id).toBeNull();
  });

  test("deleting one root falls back to another", () => {
    const { db: d, scene } = fresh();
    const first = say(d, scene, "greeting one", null);
    const second = say(d, scene, "greeting two", null);

    deleteMessage(d, second);
    expect(findSceneById(d, scene.id)?.active_leaf_id).toBe(first.id);
  });

  test("deleting a scene takes its messages and checkpoints with it", () => {
    const { db: d, scene } = fresh();
    const row = say(d, scene, "one");
    insertCheckpoint(d, { sceneId: scene.id, messageId: row.id, name: "here" });

    deleteScene(d, scene.id);
    expect(d.query("SELECT count(*) AS n FROM messages").get()).toEqual({ n: 0 });
    expect(d.query("SELECT count(*) AS n FROM checkpoints").get()).toEqual({ n: 0 });
  });
});

describe("checkpoints", () => {
  test("restore lands on the bookmarked message so the next turn forks there", () => {
    const { db: d, scene } = fresh();
    say(d, scene, "one");
    const marked = say(d, scene, "two");
    say(d, scene, "three");
    say(d, scene, "four");

    const checkpoint = insertCheckpoint(d, {
      sceneId: scene.id,
      messageId: marked.id,
      name: "before it went wrong",
    });
    expect(listCheckpoints(d, scene.id)).toHaveLength(1);

    // Restoring must not descend: a checkpoint is a place to fork from.
    setActiveLeaf(d, scene.id, checkpoint.message_id, false);
    expect(pathText(d, scene)).toEqual(["one", "two"]);

    say(d, scene, "three, differently");
    expect(pathText(d, scene)).toEqual(["one", "two", "three, differently"]);
    // The original continuation is still in the tree.
    expect(
      d.query("SELECT count(*) AS n FROM messages WHERE scene_id = $s").get({ s: scene.id }),
    ).toEqual({ n: 5 });
  });

  test("a bookmark whose message is deleted goes with it", () => {
    const { db: d, scene } = fresh();
    const row = say(d, scene, "one");
    insertCheckpoint(d, { sceneId: scene.id, messageId: row.id, name: "here" });

    deleteMessage(d, row);
    expect(listCheckpoints(d, scene.id)).toEqual([]);
  });
});

describe("ancestry", () => {
  test("recognises a descendant, a self, and an unrelated branch", () => {
    const { db: d, scene } = fresh();
    const root = say(d, scene, "prompt");
    const a = say(d, scene, "reply A", root);
    const deep = say(d, scene, "A continues", a);
    const b = say(d, scene, "reply B", root);

    expect(isSelfOrDescendant(d, deep.id, root.id)).toBe(true);
    expect(isSelfOrDescendant(d, deep.id, a.id)).toBe(true);
    expect(isSelfOrDescendant(d, a.id, a.id)).toBe(true);
    expect(isSelfOrDescendant(d, deep.id, b.id)).toBe(false);
    expect(isSelfOrDescendant(d, root.id, deep.id)).toBe(false);
  });

  test("a message removed from under a walk does not hang it", () => {
    const { db: d, scene } = fresh();
    const row = say(d, scene, "gone");
    const id = row.id;
    d.query("DELETE FROM messages WHERE id = $id").run({ id });
    expect(findMessageById(d, id)).toBeNull();
    expect(isSelfOrDescendant(d, id, id + 1)).toBe(false);
  });
});
