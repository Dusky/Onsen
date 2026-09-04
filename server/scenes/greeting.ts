/**
 * A scene's opening message (SPEC §2, §9, §20 phase 43).
 *
 * Until now nothing but the demo seed ever turned a card's `first_message` into
 * a message: `POST /scenes` inserted a row and returned, so every scene opened
 * on an empty room and `group_greetings` — parsed, stored, editable, exported —
 * was read by nothing.
 *
 * The greeting arrives when the scene gets its first cast member rather than
 * when the scene is created, because until somebody is cast there is nobody to
 * say it.
 */
import type { Database } from "bun:sqlite";
import { appendMessage, setActiveLeaf } from "../db/queries/history.ts";
import type { CharacterRow } from "../db/queries/characters.ts";

function parseArray(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Which openings this character has, for a scene of this size.
 *
 * SPEC §2 lists `group_greetings` as "openings used only in group scenes", and
 * the editor's own hint says "used only when this character opens a scene with
 * others" — so a solo scene never reaches for them, and a group scene prefers
 * them but still falls back rather than opening on nothing.
 */
export function greetingsFor(character: CharacterRow, castSize: number): string[] {
  const group = parseArray(character.group_greetings);
  const solo = [character.first_message ?? "", ...parseArray(character.alternate_greetings)];
  const pool = castSize > 1 && group.length > 0 ? group : solo;
  return pool.map((text) => text.trim()).filter((text) => text !== "");
}

/**
 * Open a scene on `opener`'s greeting, if it has not opened already.
 *
 * Every alternate lands too, as a root sibling — SPEC §2: "alternate greetings
 * are root siblings, `parent_id IS NULL`", which is why `siblingsOf` treats a
 * null parent as a group rather than as "no siblings". So the reader gets the
 * greeting *and* the alternates on the swipe control they already know, and
 * this needs no UI of its own.
 *
 * Returns the number of openings written, which is 0 whenever the scene already
 * has any message: adding a second character mid-scene must not inject one.
 */
export function seedGreeting(db: Database, sceneId: number, opener: CharacterRow): number {
  const existing = (
    db.query("SELECT count(*) AS n FROM messages WHERE scene_id = $scene").get({
      scene: sceneId,
    }) as { n: number }
  ).n;
  if (existing > 0) return 0;

  // The scene opens on whoever was cast first, and only on them. Letting the
  // second character open it when the first has no greeting would make "who
  // opens" depend on which cards happen to carry one, which is not something a
  // reader could predict from the cast list they are looking at.
  const firstMember = db
    .query(
      `SELECT character_id FROM scene_members WHERE scene_id = $scene
        ORDER BY display_order, id LIMIT 1`,
    )
    .get({ scene: sceneId }) as { character_id: number } | null;
  if (firstMember === null || firstMember.character_id !== opener.id) return 0;

  const castSize = (
    db.query("SELECT count(*) AS n FROM scene_members WHERE scene_id = $scene").get({
      scene: sceneId,
    }) as { n: number }
  ).n;

  const greetings = greetingsFor(opener, castSize);
  if (greetings.length === 0) return 0;

  const first = appendMessage(db, {
    sceneId,
    parentId: null,
    kind: "spotlight",
    authorType: "character",
    content: greetings[0]!,
    characterId: opener.id,
  });
  for (const text of greetings.slice(1)) {
    appendMessage(db, {
      sceneId,
      parentId: null,
      kind: "spotlight",
      authorType: "character",
      content: text,
      characterId: opener.id,
    });
  }

  // Each append moves the leaf to what it just wrote, so after the alternates
  // the scene would open on the last one. The card's own first message is the
  // one it opens on; the rest are a swipe away.
  if (greetings.length > 1) setActiveLeaf(db, sceneId, first.id);
  return greetings.length;
}
