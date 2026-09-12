import type { Database } from "bun:sqlite";
import { ulid } from "../../lib/ulid.ts";
import type { CharacterGroupDto } from "../../../shared/types.ts";

/**
 * Character groups (SPEC §9, §20 phase 158).
 *
 * A named roster of characters, plus optionally the lorebook their roleplays
 * open into. Two jobs: organise the library, and turn a recurring cast into a
 * scene in one request instead of a picker session.
 */

export interface CharacterGroupRow {
  id: number;
  ulid: string;
  name: string;
  lorebook_id: number | null;
  created_at: number;
  updated_at: number;
}

function groupMembers(db: Database, groupId: number) {
  return db
    .query(
      `SELECT c.ulid AS character_ulid, c.name, c.avatar_path
         FROM character_group_members m
         JOIN characters c ON c.id = m.character_id
        WHERE m.group_id = $groupId
        ORDER BY m.display_order, m.character_id`,
    )
    .all({ groupId }) as { character_ulid: string; name: string; avatar_path: string | null }[];
}

export function toGroupDto(db: Database, row: CharacterGroupRow): CharacterGroupDto {
  const book =
    row.lorebook_id === null
      ? null
      : (db
          .query("SELECT ulid, name FROM lorebooks WHERE id = $id")
          .get({ id: row.lorebook_id }) as { ulid: string; name: string } | null);
  return {
    id: row.ulid,
    name: row.name,
    lorebookId: book?.ulid ?? null,
    lorebookName: book?.name ?? null,
    members: groupMembers(db, row.id).map((m) => ({
      characterId: m.character_ulid,
      name: m.name,
      hasAvatar: m.avatar_path !== null,
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listCharacterGroups(db: Database): CharacterGroupDto[] {
  return (db.query("SELECT * FROM character_groups ORDER BY name").all() as CharacterGroupRow[]).map(
    (row) => toGroupDto(db, row),
  );
}

export function findCharacterGroup(db: Database, value: string): CharacterGroupRow | null {
  return (db
    .query("SELECT * FROM character_groups WHERE ulid = $ulid")
    .get({ ulid: value }) ?? null) as CharacterGroupRow | null;
}

export function insertCharacterGroup(
  db: Database,
  input: { name: string; lorebookId?: number | null },
): CharacterGroupRow {
  const now = Date.now();
  return db
    .query(
      `INSERT INTO character_groups (ulid, name, lorebook_id, created_at, updated_at)
       VALUES ($ulid, $name, $lorebook_id, $now, $now)
       RETURNING *`,
    )
    .get({ ulid: ulid(), name: input.name, lorebook_id: input.lorebookId ?? null, now }) as CharacterGroupRow;
}

export function updateCharacterGroup(
  db: Database,
  id: number,
  patch: { name?: string; lorebookId?: number | null },
): CharacterGroupRow {
  if (patch.name !== undefined) {
    db.query("UPDATE character_groups SET name = $name, updated_at = $now WHERE id = $id").run({
      name: patch.name,
      now: Date.now(),
      id,
    });
  }
  if (patch.lorebookId !== undefined) {
    db.query(
      "UPDATE character_groups SET lorebook_id = $lorebook_id, updated_at = $now WHERE id = $id",
    ).run({ lorebook_id: patch.lorebookId, now: Date.now(), id });
  }
  return db.query("SELECT * FROM character_groups WHERE id = $id").get({ id }) as CharacterGroupRow;
}

export function deleteCharacterGroup(db: Database, id: number): void {
  db.query("DELETE FROM character_groups WHERE id = $id").run({ id });
}

export function addGroupMember(db: Database, groupId: number, characterId: number): void {
  const next = (
    db
      .query(
        "SELECT coalesce(max(display_order), -1) + 1 AS next FROM character_group_members WHERE group_id = $groupId",
      )
      .get({ groupId }) as { next: number }
  ).next;
  db.query(
    `INSERT INTO character_group_members (group_id, character_id, display_order)
     VALUES ($groupId, $characterId, $next)
     ON CONFLICT (group_id, character_id) DO NOTHING`,
  ).run({ groupId, characterId, next });
  db.query("UPDATE character_groups SET updated_at = $now WHERE id = $id").run({
    now: Date.now(),
    id: groupId,
  });
}

export function removeGroupMember(db: Database, groupId: number, characterId: number): void {
  db.query(
    "DELETE FROM character_group_members WHERE group_id = $groupId AND character_id = $characterId",
  ).run({ groupId, characterId });
  db.query("UPDATE character_groups SET updated_at = $now WHERE id = $id").run({
    now: Date.now(),
    id: groupId,
  });
}
