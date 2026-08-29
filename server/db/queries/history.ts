import type { Database } from "bun:sqlite";
import { ulid } from "../../lib/ulid.ts";
import type {
  CheckpointDto,
  MessageAuthorType,
  MessageDto,
  MessageKind,
  MessageSegmentDto,
  SceneDto,
  SceneMemberDto,
} from "../../../shared/types.ts";
import { parseBeat, spliceSegment, type ParsedSegment } from "../../generation/segments.ts";

/**
 * The history tree (SPEC §0.3, §2).
 *
 * History is a tree, never an array. Siblings under one parent are swipes;
 * `scenes.active_leaf_id` names the current leaf, and walking parents from it to
 * a root yields the active history. Every operation here preserves what it moves
 * away from: swiping, rewinding, and branching only move the leaf pointer, and
 * nothing but an explicit delete removes a node.
 */

/* ------------------------------------------------------------------ */
/* Row shapes                                                          */
/* ------------------------------------------------------------------ */

export interface SceneRow {
  id: number;
  ulid: string;
  title: string;
  preset_id: number | null;
  connection_profile_id: number | null;
  /** Null selects single-character mode (SPEC §3). */
  author_id: number | null;
  persona_id: number | null;
  /** Who speaks next, when the user has not said (SPEC §6). */
  turn_strategy: "manual" | "round_robin" | "mention" | "classifier";
  active_leaf_id: number | null;
  created_at: number;
  updated_at: number;
}

export interface MessageRow {
  id: number;
  ulid: string;
  scene_id: number;
  parent_id: number | null;
  kind: MessageKind;
  author_type: MessageAuthorType;
  content: string;
  /** Which cast member voiced this turn. Null for user and system turns. */
  character_id: number | null;
  is_hidden: number;
  token_count: number | null;
  /** A beat whose speaker labels could not be read (SPEC §3.5). */
  parse_degraded: number;
  created_at: number;
  edited_at: number | null;
}

/** A message row plus its position among its siblings — the swipe counter. */
export interface MessageRowWithSiblings extends MessageRow {
  sibling_index: number;
  sibling_count: number;
}

export interface CheckpointRow {
  id: number;
  ulid: string;
  scene_id: number;
  message_id: number;
  name: string;
  created_at: number;
}

/** Depth cap on tree walks: a guard against a cycle, not an expected limit. */
const MAX_DEPTH = 100_000;

/* ------------------------------------------------------------------ */
/* Mappers                                                             */
/* ------------------------------------------------------------------ */

/** Character identifiers and names, for resolving who spoke. */
export interface SpeakerLookup {
  ulidById: Map<number, string>;
  nameById: Map<number, string>;
}

export function speakerLookup(db: Database): SpeakerLookup {
  const rows = db.query("SELECT id, ulid, name FROM characters").all() as {
    id: number;
    ulid: string;
    name: string;
  }[];
  return {
    ulidById: new Map(rows.map((row) => [row.id, row.ulid])),
    nameById: new Map(rows.map((row) => [row.id, row.name])),
  };
}

export function toMessageDto(
  row: MessageRowWithSiblings,
  sceneUlid: string,
  parentUlid: string | null,
  speakers?: SpeakerLookup,
  /**
   * A beat's parsed view. Passed in rather than looked up so the mapper stays a
   * pure function of its row, and so a caller that does not need segments — a
   * swipe carousel showing three-line excerpts — does not pay for them.
   */
  segments: MessageSegmentDto[] | null = null,
): MessageDto {
  return {
    id: row.ulid,
    sceneId: sceneUlid,
    parentId: parentUlid,
    kind: row.kind,
    authorType: row.author_type,
    characterId:
      row.character_id === null ? null : (speakers?.ulidById.get(row.character_id) ?? null),
    // Resolved here so the log does not need the character list to render.
    speakerName:
      row.character_id === null ? null : (speakers?.nameById.get(row.character_id) ?? null),
    content: row.content,
    isHidden: row.is_hidden === 1,
    tokenCount: row.token_count,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    siblingIndex: row.sibling_index,
    siblingCount: row.sibling_count,
    segments,
    parseDegraded: row.parse_degraded === 1,
  };
}

export function toSceneDto(
  row: SceneRow,
  extras: {
    presetUlid: string | null;
    profileUlid: string | null;
    turnStrategy: SceneDto["turnStrategy"];
    authorUlid: string | null;
    authorName: string | null;
    personaUlid: string | null;
    personaName: string | null;
    cast: SceneMemberDto[];
    activeLeafUlid: string | null;
    messageCount: number;
  },
): SceneDto {
  return {
    id: row.ulid,
    title: row.title,
    presetId: extras.presetUlid,
    connectionProfileId: extras.profileUlid,
    turnStrategy: extras.turnStrategy,
    authorId: extras.authorUlid,
    authorName: extras.authorName,
    personaId: extras.personaUlid,
    personaName: extras.personaName,
    cast: extras.cast,
    activeLeafId: extras.activeLeafUlid,
    messageCount: extras.messageCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toCheckpointDto(
  row: CheckpointRow,
  sceneUlid: string,
  messageUlid: string,
): CheckpointDto {
  return {
    id: row.ulid,
    sceneId: sceneUlid,
    messageId: messageUlid,
    name: row.name,
    createdAt: row.created_at,
  };
}

/* ------------------------------------------------------------------ */
/* Scenes                                                              */
/* ------------------------------------------------------------------ */

export interface NewScene {
  title: string;
  presetId?: number | null;
  connectionProfileId?: number | null;
}

export function insertScene(db: Database, input: NewScene): SceneRow {
  const now = Date.now();
  return db
    .query(
      `INSERT INTO scenes (ulid, title, preset_id, connection_profile_id, created_at, updated_at)
       VALUES ($ulid, $title, $preset_id, $connection_profile_id, $now, $now)
       RETURNING *`,
    )
    .get({
      ulid: ulid(),
      title: input.title,
      preset_id: input.presetId ?? null,
      connection_profile_id: input.connectionProfileId ?? null,
      now,
    }) as SceneRow;
}

export function findScene(db: Database, sceneUlid: string): SceneRow | null {
  return (db.query("SELECT * FROM scenes WHERE ulid = $ulid").get({ ulid: sceneUlid }) ??
    null) as SceneRow | null;
}

export function findSceneById(db: Database, id: number): SceneRow | null {
  return (db.query("SELECT * FROM scenes WHERE id = $id").get({ id }) ?? null) as SceneRow | null;
}

/** Most recently touched first — the scenes list is recent-first (SPEC §16). */
export function listScenes(db: Database): SceneRow[] {
  return db.query("SELECT * FROM scenes ORDER BY updated_at DESC, id DESC").all() as SceneRow[];
}

export function updateScene(
  db: Database,
  id: number,
  patch: {
    title?: string;
    presetId?: number | null;
    connectionProfileId?: number | null;
    authorId?: number | null;
    personaId?: number | null;
  },
): SceneRow {
  const current = findSceneById(db, id);
  if (current === null) throw new Error(`no such scene: ${id}`);
  // Absent means "leave alone" and null means "clear" — the distinction
  // matters, because a null author is a real choice (single-character mode).
  const keep = <T>(value: T | undefined, fallback: T): T =>
    value === undefined ? fallback : value;

  return db
    .query(
      `UPDATE scenes
          SET title = $title,
              preset_id = $preset_id,
              connection_profile_id = $connection_profile_id,
              author_id = $author_id,
              persona_id = $persona_id,
              updated_at = $now
        WHERE id = $id
        RETURNING *`,
    )
    .get({
      id,
      title: patch.title ?? current.title,
      preset_id: keep(patch.presetId, current.preset_id),
      connection_profile_id: keep(patch.connectionProfileId, current.connection_profile_id),
      author_id: keep(patch.authorId, current.author_id),
      persona_id: keep(patch.personaId, current.persona_id),
      now: Date.now(),
    }) as SceneRow;
}

export function deleteScene(db: Database, id: number): void {
  db.query("DELETE FROM scenes WHERE id = $id").run({ id });
}

export function countMessages(db: Database, sceneId: number): number {
  return (
    db.query("SELECT count(*) AS n FROM messages WHERE scene_id = $scene_id").get({
      scene_id: sceneId,
    }) as { n: number }
  ).n;
}

function touchScene(db: Database, sceneId: number): void {
  db.query("UPDATE scenes SET updated_at = $now WHERE id = $id").run({
    id: sceneId,
    now: Date.now(),
  });
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

export function findMessage(db: Database, messageUlid: string): MessageRow | null {
  return (db.query("SELECT * FROM messages WHERE ulid = $ulid").get({ ulid: messageUlid }) ??
    null) as MessageRow | null;
}

export function findMessageById(db: Database, id: number): MessageRow | null {
  return (db.query("SELECT * FROM messages WHERE id = $id").get({ id }) ??
    null) as MessageRow | null;
}

export interface NewMessage {
  sceneId: number;
  parentId: number | null;
  kind: MessageKind;
  authorType: MessageAuthorType;
  content: string;
  /** The cast member this turn was voiced as, where there is one. */
  characterId?: number | null;
  isHidden?: boolean;
}

/**
 * Add a node and make it the active leaf. Attaching to something other than the
 * current leaf is not an error — it forks the timeline there, which is exactly
 * what branching is.
 */
export function appendMessage(db: Database, input: NewMessage): MessageRow {
  const now = Date.now();
  const row = db
    .query(
      `INSERT INTO messages (ulid, scene_id, parent_id, kind, author_type, content, character_id, is_hidden, created_at)
       VALUES ($ulid, $scene_id, $parent_id, $kind, $author_type, $content, $character_id, $is_hidden, $now)
       RETURNING *`,
    )
    .get({
      ulid: ulid(),
      scene_id: input.sceneId,
      parent_id: input.parentId,
      kind: input.kind,
      author_type: input.authorType,
      content: input.content,
      character_id: input.characterId ?? null,
      is_hidden: input.isHidden ? 1 : 0,
      now,
    }) as MessageRow;

  db.query("UPDATE scenes SET active_leaf_id = $leaf, updated_at = $now WHERE id = $id").run({
    id: input.sceneId,
    leaf: row.id,
    now,
  });

  return row;
}

/**
 * Edit in place. A content change invalidates the cached token count — the
 * whole point of caching it on the row is that it must never go stale
 * (SPEC §2, §3).
 */
export function updateMessage(
  db: Database,
  id: number,
  patch: { content?: string; isHidden?: boolean },
): MessageRow {
  const current = findMessageById(db, id);
  if (current === null) throw new Error(`no such message: ${id}`);

  const contentChanged = patch.content !== undefined && patch.content !== current.content;
  const row = db
    .query(
      `UPDATE messages
          SET content = $content,
              is_hidden = $is_hidden,
              token_count = $token_count,
              edited_at = $edited_at
        WHERE id = $id
        RETURNING *`,
    )
    .get({
      id,
      content: patch.content ?? current.content,
      is_hidden: patch.isHidden === undefined ? current.is_hidden : patch.isHidden ? 1 : 0,
      token_count: contentChanged ? null : current.token_count,
      edited_at: contentChanged ? Date.now() : current.edited_at,
    }) as MessageRow;

  // A beat's segments are a view of its content, so editing the content
  // rebuilds them here rather than leaving that to every caller (SPEC §3.5).
  if (contentChanged && row.kind === "beat") reparseSegments(db, row);

  touchScene(db, current.scene_id);
  return row;
}

/**
 * Siblings under one parent, in creation order — the swipe carousel. Handles a
 * null parent, because a scene's alternate greetings are root siblings.
 */
export function siblingsOf(db: Database, row: MessageRow): MessageRow[] {
  return db
    .query(
      `SELECT * FROM messages
        WHERE scene_id = $scene_id AND parent_id IS $parent_id
        ORDER BY id`,
    )
    .all({ scene_id: row.scene_id, parent_id: row.parent_id }) as MessageRow[];
}

/** Follow the most recent child down to a leaf. */
export function descendToLeaf(db: Database, messageId: number): number {
  const query = db.query(
    "SELECT id FROM messages WHERE parent_id = $parent_id ORDER BY id DESC LIMIT 1",
  );
  let current = messageId;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const child = query.get({ parent_id: current }) as { id: number } | null;
    if (child === null) return current;
    current = child.id;
  }
  throw new Error(`message tree walk exceeded ${MAX_DEPTH} levels — cycle?`);
}

/** The leaf of the newest root branch, or null in an empty scene. */
export function latestLeaf(db: Database, sceneId: number): number | null {
  const root = db
    .query(
      "SELECT id FROM messages WHERE scene_id = $scene_id AND parent_id IS NULL ORDER BY id DESC LIMIT 1",
    )
    .get({ scene_id: sceneId }) as { id: number } | null;
  return root === null ? null : descendToLeaf(db, root.id);
}

/**
 * The active history: every message from a root down to the leaf, in reading
 * order, each carrying its swipe position.
 */
export function activePath(db: Database, sceneId: number): MessageRowWithSiblings[] {
  const scene = findSceneById(db, sceneId);
  if (scene === null || scene.active_leaf_id === null) return [];

  return db
    .query(
      `WITH RECURSIVE ancestry(id, depth) AS (
           SELECT id, 0 FROM messages WHERE id = $leaf
           UNION ALL
           SELECT m.parent_id, ancestry.depth + 1
             FROM messages m JOIN ancestry ON m.id = ancestry.id
            WHERE m.parent_id IS NOT NULL
         )
         SELECT m.*,
                (SELECT count(*) FROM messages s
                  WHERE s.scene_id = m.scene_id AND s.parent_id IS m.parent_id) AS sibling_count,
                (SELECT count(*) FROM messages s
                  WHERE s.scene_id = m.scene_id AND s.parent_id IS m.parent_id
                    AND s.id < m.id) AS sibling_index
           FROM ancestry JOIN messages m ON m.id = ancestry.id
          ORDER BY ancestry.depth DESC`,
    )
    .all({ leaf: scene.active_leaf_id }) as MessageRowWithSiblings[];
}

/** Attach sibling position to a single row, for responses about one message. */
export function withSiblings(db: Database, row: MessageRow): MessageRowWithSiblings {
  const siblings = siblingsOf(db, row);
  return {
    ...row,
    sibling_index: siblings.findIndex((sibling) => sibling.id === row.id),
    sibling_count: siblings.length,
  };
}

/** True when `candidate` is `ancestor`, or lies below it. */
export function isSelfOrDescendant(db: Database, candidate: number, ancestor: number): boolean {
  const query = db.query("SELECT parent_id FROM messages WHERE id = $id");
  let current: number | null = candidate;
  for (let depth = 0; depth < MAX_DEPTH && current !== null; depth++) {
    if (current === ancestor) return true;
    const row = query.get({ id: current }) as { parent_id: number | null } | null;
    if (row === null) return false;
    current = row.parent_id;
  }
  return false;
}

/**
 * Move the leaf pointer. This one operation is swipe, rewind, branch, and
 * checkpoint restore: none of them create or destroy anything, they choose
 * which path through the tree is current.
 *
 * `descend` follows the most recent child down to a leaf, which is what makes
 * swiping away from a sibling and back again restore that sibling's own
 * continuation instead of truncating it. Rewinding and restoring a checkpoint
 * pass false, so the next message forks at exactly the chosen point.
 */
export function setActiveLeaf(
  db: Database,
  sceneId: number,
  messageId: number,
  descend = true,
): number {
  const leaf = descend ? descendToLeaf(db, messageId) : messageId;
  db.query("UPDATE scenes SET active_leaf_id = $leaf, updated_at = $now WHERE id = $id").run({
    id: sceneId,
    leaf,
    now: Date.now(),
  });
  return leaf;
}

/**
 * Delete a message and everything below it — the subtree goes with it, by
 * cascade. If the active leaf was inside the deleted subtree the pointer moves
 * to the surviving parent branch rather than being left dangling.
 */
export function deleteMessage(db: Database, row: MessageRow): void {
  const scene = findSceneById(db, row.scene_id);
  const leafWasInside =
    scene?.active_leaf_id != null && isSelfOrDescendant(db, scene.active_leaf_id, row.id);
  const parentId = row.parent_id;

  db.query("DELETE FROM messages WHERE id = $id").run({ id: row.id });

  if (leafWasInside) {
    const replacement = parentId === null ? latestLeaf(db, row.scene_id) : descendToLeaf(db, parentId);
    db.query("UPDATE scenes SET active_leaf_id = $leaf, updated_at = $now WHERE id = $id").run({
      id: row.scene_id,
      leaf: replacement,
      now: Date.now(),
    });
  } else {
    touchScene(db, row.scene_id);
  }
}

/* ------------------------------------------------------------------ */
/* Checkpoints                                                         */
/* ------------------------------------------------------------------ */

export function insertCheckpoint(
  db: Database,
  input: { sceneId: number; messageId: number; name: string },
): CheckpointRow {
  return db
    .query(
      `INSERT INTO checkpoints (ulid, scene_id, message_id, name, created_at)
       VALUES ($ulid, $scene_id, $message_id, $name, $now)
       RETURNING *`,
    )
    .get({
      ulid: ulid(),
      scene_id: input.sceneId,
      message_id: input.messageId,
      name: input.name,
      now: Date.now(),
    }) as CheckpointRow;
}

export function listCheckpoints(db: Database, sceneId: number): CheckpointRow[] {
  return db
    .query("SELECT * FROM checkpoints WHERE scene_id = $scene_id ORDER BY id")
    .all({ scene_id: sceneId }) as CheckpointRow[];
}

export function findCheckpoint(db: Database, checkpointUlid: string): CheckpointRow | null {
  return (db.query("SELECT * FROM checkpoints WHERE ulid = $ulid").get({ ulid: checkpointUlid }) ??
    null) as CheckpointRow | null;
}

export function deleteCheckpoint(db: Database, id: number): void {
  db.query("DELETE FROM checkpoints WHERE id = $id").run({ id });
}

/* ------------------------------------------------------------------ */
/* Composition into DTOs                                               */
/* ------------------------------------------------------------------ */

function ulidOf(db: Database, table: "presets" | "connection_profiles" | "messages", id: number | null): string | null {
  if (id === null) return null;
  const row = db.query(`SELECT ulid FROM ${table} WHERE id = $id`).get({ id }) as
    | { ulid: string }
    | null;
  return row?.ulid ?? null;
}

/** The cast, in display order (SPEC §2 SceneMember). */
export function castOf(db: Database, sceneId: number): SceneMemberDto[] {
  const rows = db
    .query(
      `SELECT c.ulid, c.name, c.avatar_path, m.display_order, m.is_active
         FROM scene_members m JOIN characters c ON c.id = m.character_id
        WHERE m.scene_id = $scene_id
        ORDER BY m.display_order, m.id`,
    )
    .all({ scene_id: sceneId }) as {
    ulid: string;
    name: string;
    avatar_path: string | null;
    display_order: number;
    is_active: number;
  }[];
  return rows.map((row) => ({
    characterId: row.ulid,
    name: row.name,
    hasAvatar: row.avatar_path !== null,
    displayOrder: row.display_order,
    isActive: row.is_active === 1,
  }));
}

function named(
  db: Database,
  table: "authors" | "personas",
  id: number | null,
): { ulid: string | null; name: string | null } {
  if (id === null) return { ulid: null, name: null };
  const row = db.query(`SELECT ulid, name FROM ${table} WHERE id = $id`).get({ id }) as
    | { ulid: string; name: string }
    | null;
  return { ulid: row?.ulid ?? null, name: row?.name ?? null };
}

export function sceneDto(db: Database, row: SceneRow): SceneDto {
  const author = named(db, "authors", row.author_id);
  const persona = named(db, "personas", row.persona_id);
  return toSceneDto(row, {
    presetUlid: ulidOf(db, "presets", row.preset_id),
    profileUlid: ulidOf(db, "connection_profiles", row.connection_profile_id),
    turnStrategy: row.turn_strategy,
    authorUlid: author.ulid,
    authorName: author.name,
    personaUlid: persona.ulid,
    personaName: persona.name,
    cast: castOf(db, row.id),
    activeLeafUlid: ulidOf(db, "messages", row.active_leaf_id),
    messageCount: countMessages(db, row.id),
  });
}

/**
 * The active path as DTOs. Each message's parent is its predecessor on the
 * path, so no extra lookups are needed to resolve parent identifiers.
 */
export function activePathDtos(db: Database, scene: SceneRow): MessageDto[] {
  const rows = activePath(db, scene.id);
  const speakers = speakerLookup(db);
  return rows.map((row, index) =>
    toMessageDto(
      row,
      scene.ulid,
      index === 0 ? null : (rows[index - 1]?.ulid ?? null),
      speakers,
      // Only a beat carries a parsed view; every other kind of message is its
      // own single segment and does not need it sent twice.
      row.kind === "beat" ? segmentDtosOf(db, row, speakers) : null,
    ),
  );
}

export function messageDto(db: Database, row: MessageRow, sceneUlid: string): MessageDto {
  const speakers = speakerLookup(db);
  return toMessageDto(
    withSiblings(db, row),
    sceneUlid,
    ulidOf(db, "messages", row.parent_id),
    speakers,
    row.kind === "beat" ? segmentDtosOf(db, row, speakers) : null,
  );
}

/* ------------------------------------------------------------------ */
/* Segments — the parsed view of a beat (SPEC §2, §3.5)                */
/* ------------------------------------------------------------------ */

export interface SegmentRow {
  id: number;
  message_id: number;
  ordinal: number;
  speaker_type: "character" | "narration";
  character_id: number | null;
  speaker_label: string | null;
  content: string;
  expression: string | null;
  char_start: number;
  char_end: number;
}

/**
 * Segments live here, with the tree, because that is what they are: the
 * canonical content on the message is the truth, and these rows are a derived
 * view rebuilt whenever it changes. Nothing below ever writes prose the message
 * does not already contain.
 */

/** The scene's cast, indexed by lowercased name, for resolving speaker labels. */
function castByName(db: Database, sceneId: number): Map<string, number> {
  const rows = db
    .query(
      `SELECT c.id AS id, c.name AS name
         FROM scene_members m JOIN characters c ON c.id = m.character_id
        WHERE m.scene_id = $scene_id`,
    )
    .all({ scene_id: sceneId }) as { id: number; name: string }[];
  return new Map(rows.map((row) => [row.name.trim().toLowerCase(), row.id]));
}

export function segmentRowsOf(db: Database, messageId: number): SegmentRow[] {
  return db
    .query("SELECT * FROM message_segments WHERE message_id = $id ORDER BY ordinal")
    .all({ id: messageId }) as SegmentRow[];
}

/**
 * Parse a beat's content and replace its stored segments.
 *
 * Called after a beat is generated and after any edit to one, so the parsed
 * view can never drift from the text it describes.
 */
export function reparseSegments(db: Database, message: MessageRow): SegmentRow[] {
  const cast = castByName(db, message.scene_id);
  const { segments, degraded } = parseBeat(message.content, [...cast.keys()]);

  db.query("DELETE FROM message_segments WHERE message_id = $id").run({ id: message.id });
  const insert = db.query(
    `INSERT INTO message_segments
       (message_id, ordinal, speaker_type, character_id, speaker_label, content, char_start, char_end)
     VALUES ($message_id, $ordinal, $speaker_type, $character_id, $speaker_label, $content,
             $char_start, $char_end)`,
  );
  for (const segment of segments) {
    insert.run({
      message_id: message.id,
      ordinal: segment.ordinal,
      speaker_type: segment.speakerType,
      character_id:
        segment.speakerLabel === null
          ? null
          : (cast.get(segment.speakerLabel.trim().toLowerCase()) ?? null),
      speaker_label: segment.speakerLabel,
      content: segment.content,
      char_start: segment.charStart,
      char_end: segment.charEnd,
    });
  }

  db.query("UPDATE messages SET parse_degraded = $flag WHERE id = $id").run({
    id: message.id,
    flag: degraded ? 1 : 0,
  });

  return segmentRowsOf(db, message.id);
}

/**
 * A message's segments as the client reads them.
 *
 * A message that is not a beat has exactly one segment (SPEC §2), derived here
 * rather than stored: a stored copy of the message's own content would be one
 * more thing to keep in step, for no reader.
 */
export function segmentDtosOf(
  db: Database,
  message: MessageRow,
  speakers: SpeakerLookup = speakerLookup(db),
): MessageSegmentDto[] {
  const rows = message.kind === "beat" ? segmentRowsOf(db, message.id) : [];

  if (rows.length === 0) {
    return [
      {
        ordinal: 0,
        speakerType: message.character_id === null ? "narration" : "character",
        characterId:
          message.character_id === null
            ? null
            : (speakers.ulidById.get(message.character_id) ?? null),
        speakerName:
          message.character_id === null
            ? null
            : (speakers.nameById.get(message.character_id) ?? null),
        content: message.content,
        charStart: 0,
        charEnd: message.content.length,
      },
    ];
  }

  return rows.map((row) => ({
    ordinal: row.ordinal,
    speakerType: row.speaker_type,
    characterId:
      row.character_id === null ? null : (speakers.ulidById.get(row.character_id) ?? null),
    // The written label wins over the resolved name: it is what the author
    // actually said, and it is the only name a speaker outside the cast has.
    speakerName:
      row.speaker_label ??
      (row.character_id === null ? null : (speakers.nameById.get(row.character_id) ?? null)),
    content: row.content,
    charStart: row.char_start,
    charEnd: row.char_end,
  }));
}

/**
 * Who spoke last in a message.
 *
 * For a beat this is the last character segment, not the member the beat is
 * filed under: after a beat that ends on Mira, the turn director's "never twice
 * consecutively" rule is about Mira (SPEC §6).
 */
export function lastSpeakerOf(db: Database, message: MessageRow): number | null {
  if (message.kind !== "beat") return message.character_id;
  const rows = segmentRowsOf(db, message.id);
  for (let index = rows.length - 1; index >= 0; index--) {
    const characterId = rows[index]!.character_id;
    if (characterId !== null) return characterId;
  }
  return message.character_id;
}

function toParsedSegment(row: SegmentRow): ParsedSegment {
  return {
    ordinal: row.ordinal,
    speakerType: row.speaker_type,
    speakerLabel: row.speaker_label,
    content: row.content,
    charStart: row.char_start,
    charEnd: row.char_end,
  };
}

/**
 * Replace one segment's prose in place and rebuild the parsed view — what
 * recast lands (SPEC §7).
 *
 * The message is edited rather than forked: a recast corrects this beat, it is
 * not a different version of it. Swiping the whole beat is what makes a sibling.
 */
export function replaceSegment(
  db: Database,
  message: MessageRow,
  ordinal: number,
  replacement: string,
): MessageRow | null {
  const row = segmentRowsOf(db, message.id).find((segment) => segment.ordinal === ordinal);
  if (row === undefined) return null;

  updateMessage(db, message.id, {
    content: spliceSegment(message.content, toParsedSegment(row), replacement),
  });
  return findMessageById(db, message.id);
}

/**
 * Split a beat into one message per segment (SPEC §7).
 *
 * The new messages are a chain under the beat's own parent, which makes them a
 * sibling branch of it: the beat survives untouched, exactly as every other
 * tree operation preserves what it moves away from. Returns the chain, whose
 * last node is the new leaf.
 */
export function splitBeat(db: Database, message: MessageRow): MessageRow[] {
  const rows = segmentRowsOf(db, message.id);
  // Nothing to split: one segment would just be the same message again.
  if (rows.length < 2) return [];

  const created: MessageRow[] = [];
  let parentId = message.parent_id;
  for (const row of rows) {
    const node = appendMessage(db, {
      sceneId: message.scene_id,
      parentId,
      kind: row.speaker_type === "character" ? "spotlight" : "narrator",
      authorType: row.speaker_type === "character" ? "character" : "narrator",
      content: row.content,
      characterId: row.character_id,
    });
    created.push(node);
    parentId = node.id;
  }
  return created;
}
