import type { Database } from "bun:sqlite";
import { ulid } from "../../lib/ulid.ts";
import type { EntityKind, Extraction } from "../../memory/extract.ts";

/**
 * Storage for §11's narrative memory.
 *
 * One rule governs every write here: **a reader's edit is never overwritten by
 * extraction.** §11 states it as a property of the entity, and it is what makes
 * the feature safe to leave running — an extractor that could quietly replace
 * something the reader corrected would make every correction provisional.
 */

export interface MemoryEntityRow {
  id: number;
  ulid: string;
  scene_id: number;
  kind: EntityKind;
  name: string;
  content: string;
  salience: number;
  last_seen_message_id: number | null;
  user_edited: number;
  vector: string | null;
  created_at: number;
  updated_at: number;
}

export interface MemoryRelationRow {
  id: number;
  ulid: string;
  from_entity_id: number;
  to_entity_id: number;
  kind: string;
  content: string;
  salience: number;
  user_edited: number;
  created_at: number;
  updated_at: number;
}

export function listEntities(db: Database, sceneId: number): MemoryEntityRow[] {
  return db
    .query("SELECT * FROM memory_entities WHERE scene_id = $scene ORDER BY salience DESC, name")
    .all({ scene: sceneId }) as MemoryEntityRow[];
}

export function findEntity(db: Database, entityUlid: string): MemoryEntityRow | null {
  return db.query("SELECT * FROM memory_entities WHERE ulid = $ulid").get({ ulid: entityUlid }) as
    | MemoryEntityRow
    | null;
}

export function findEntityByName(
  db: Database,
  sceneId: number,
  name: string,
): MemoryEntityRow | null {
  return db
    .query(
      "SELECT * FROM memory_entities WHERE scene_id = $scene AND name = $name COLLATE NOCASE",
    )
    .get({ scene: sceneId, name }) as MemoryEntityRow | null;
}

export function listRelations(db: Database, sceneId: number): MemoryRelationRow[] {
  return db
    .query(
      `SELECT r.* FROM memory_relations r
         JOIN memory_entities e ON e.id = r.from_entity_id
        WHERE e.scene_id = $scene
        ORDER BY r.salience DESC`,
    )
    .all({ scene: sceneId }) as MemoryRelationRow[];
}

export interface MergeReport {
  added: number;
  updated: number;
  /** Entities an extraction touched that the reader had edited. */
  protected: number;
  problems: string[];
}

/**
 * Fold an extraction into what is already stored.
 *
 * Merge rather than replace, because an extraction reads the last few turns and
 * the memory is the whole story: a replace would lose everything the window no
 * longer covers, which is the one thing this feature exists to keep.
 */
export function mergeExtraction(
  db: Database,
  sceneId: number,
  extraction: Extraction,
  leafMessageId: number | null,
): MergeReport {
  const report: MergeReport = {
    added: 0,
    updated: 0,
    protected: 0,
    problems: [...extraction.problems],
  };
  const now = Date.now();

  for (const entity of extraction.entities) {
    const existing = findEntityByName(db, sceneId, entity.name);

    if (existing === null) {
      db.query(
        `INSERT INTO memory_entities
           (ulid, scene_id, kind, name, content, salience, last_seen_message_id, created_at, updated_at)
         VALUES ($ulid, $scene, $kind, $name, $content, $salience, $seen, $now, $now)`,
      ).run({
        ulid: ulid(),
        scene: sceneId,
        kind: entity.kind,
        name: entity.name,
        content: entity.content,
        salience: entity.salience,
        seen: leafMessageId,
        now,
      });
      report.added += 1;
      continue;
    }

    if (existing.user_edited === 1) {
      // §11: never overwritten. The mention still counts — being talked about
      // is not the same as being redescribed, and refusing to record that it
      // came up would make a corrected entity decay as though it had not.
      db.query(
        "UPDATE memory_entities SET last_seen_message_id = $seen, updated_at = $now WHERE id = $id",
      ).run({ id: existing.id, seen: leafMessageId, now });
      report.protected += 1;
      continue;
    }

    db.query(
      `UPDATE memory_entities
          SET kind = $kind, content = $content, salience = $salience,
              last_seen_message_id = $seen, updated_at = $now
        WHERE id = $id`,
    ).run({
      id: existing.id,
      kind: entity.kind,
      content: entity.content === "" ? existing.content : entity.content,
      // The higher of the two: an entity that mattered once does not stop
      // having mattered because a later extraction happened to mention it in
      // passing. Decay is what lowers a score, not a quiet turn.
      salience: Math.max(existing.salience, entity.salience),
      seen: leafMessageId,
      now,
    });
    report.updated += 1;
  }

  for (const relation of extraction.relations) {
    const from = findEntityByName(db, sceneId, relation.from);
    const to = findEntityByName(db, sceneId, relation.to);
    // A relation between things this scene does not know about is not a
    // relation; the extractor named something it did not also extract.
    if (from === null || to === null) {
      report.problems.push(`${relation.from} → ${relation.to}: one of them is not in memory.`);
      continue;
    }

    const existing = db
      .query(
        `SELECT * FROM memory_relations
          WHERE from_entity_id = $from AND to_entity_id = $to AND kind = $kind COLLATE NOCASE`,
      )
      .get({ from: from.id, to: to.id, kind: relation.kind }) as MemoryRelationRow | null;

    if (existing === null) {
      db.query(
        `INSERT INTO memory_relations
           (ulid, from_entity_id, to_entity_id, kind, content, salience, created_at, updated_at)
         VALUES ($ulid, $from, $to, $kind, $content, $salience, $now, $now)`,
      ).run({
        ulid: ulid(),
        from: from.id,
        to: to.id,
        kind: relation.kind,
        content: relation.content,
        salience: relation.salience,
        now,
      });
      report.added += 1;
      continue;
    }
    if (existing.user_edited === 1) {
      report.protected += 1;
      continue;
    }
    db.query(
      "UPDATE memory_relations SET content = $content, salience = $salience, updated_at = $now WHERE id = $id",
    ).run({
      id: existing.id,
      content: relation.content === "" ? existing.content : relation.content,
      salience: Math.max(existing.salience, relation.salience),
      now,
    });
    report.updated += 1;
  }

  return report;
}

export interface EntityPatch {
  kind?: EntityKind;
  name?: string;
  content?: string;
  salience?: number;
}

/**
 * A reader's edit, which sets `user_edited` as a side effect.
 *
 * Deliberately not a separate flag the caller can forget: editing something
 * *is* the act that protects it, and a route that had to remember to set the
 * flag would eventually not.
 */
export function editEntity(db: Database, id: number, patch: EntityPatch): void {
  const sets: string[] = ["user_edited = 1"];
  const values: Record<string, string | number> = { id, now: Date.now() };
  if (patch.kind !== undefined) {
    sets.push("kind = $kind");
    values["kind"] = patch.kind;
  }
  if (patch.name !== undefined) {
    sets.push("name = $name");
    values["name"] = patch.name;
  }
  if (patch.content !== undefined) {
    sets.push("content = $content");
    values["content"] = patch.content;
  }
  if (patch.salience !== undefined) {
    sets.push("salience = $salience");
    values["salience"] = Math.min(1, Math.max(0, patch.salience));
  }
  // The vector describes text that has just changed, so it is cleared rather
  // than left to describe something that is no longer there.
  sets.push("vector = NULL");
  db.query(`UPDATE memory_entities SET ${sets.join(", ")}, updated_at = $now WHERE id = $id`).run(
    values,
  );
}

export function deleteEntity(db: Database, id: number): void {
  db.query("DELETE FROM memory_entities WHERE id = $id").run({ id });
}

export function setEntityVector(db: Database, id: number, vector: number[] | null): void {
  db.query("UPDATE memory_entities SET vector = $vector WHERE id = $id").run({
    id,
    vector: vector === null ? null : JSON.stringify(vector),
  });
}

/** How many turns ago a message was, along the path this scene is on. */
export function turnsSince(db: Database, sceneId: number, messageId: number | null): number {
  if (messageId === null) return Number.MAX_SAFE_INTEGER;
  const row = db
    .query(
      `SELECT count(*) AS n FROM messages
        WHERE scene_id = $scene AND id > $id`,
    )
    .get({ scene: sceneId, id: messageId }) as { n: number };
  return row.n;
}
