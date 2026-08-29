import type { Database } from "bun:sqlite";
import { ulid } from "../../lib/ulid.ts";
import { createEstimatingTokenizer } from "../../prompt/index.ts";
import type { CharacterRow } from "./characters.ts";
import type {
  AuthorDto,
  AuthorTokenCosts,
  PersonaDto,
} from "../../../shared/types.ts";

/**
 * Authors and personas (SPEC §2).
 *
 * The author is the identity in the system prompt — the product's defining bet
 * (§0.2) — and the persona is who the user is. They are stored together because
 * they are two halves of one relationship: the user-lock is the rule that the
 * author never writes the persona, and it needs both names to be stated at all.
 */

export interface AuthorRow {
  id: number;
  ulid: string;
  name: string;
  avatar_path: string | null;
  personality: string | null;
  writing_style: string | null;
  directing_style: string | null;
  ooc_voice: string | null;
  boundaries: string | null;
  memory_enabled: number;
  is_default: number;
  created_at: number;
  updated_at: number;
}

export interface PersonaRow {
  id: number;
  ulid: string;
  name: string;
  avatar_path: string | null;
  description: string | null;
  is_default: number;
  created_at: number;
  updated_at: number;
}

function tokenCostsFor(row: AuthorRow): AuthorTokenCosts {
  const tokenizer = createEstimatingTokenizer();
  const count = (value: string | null) => (value === null ? 0 : tokenizer.count(value));
  const costs = {
    personality: count(row.personality),
    writingStyle: count(row.writing_style),
    directingStyle: count(row.directing_style),
    oocVoice: count(row.ooc_voice),
    boundaries: count(row.boundaries),
  };
  return {
    ...costs,
    total: Object.values(costs).reduce((sum, value) => sum + value, 0),
    estimated: tokenizer.isEstimate,
  };
}

export function toAuthorDto(row: AuthorRow): AuthorDto {
  return {
    id: row.ulid,
    name: row.name,
    hasAvatar: row.avatar_path !== null,
    personality: row.personality,
    writingStyle: row.writing_style,
    directingStyle: row.directing_style,
    oocVoice: row.ooc_voice,
    boundaries: row.boundaries,
    memoryEnabled: row.memory_enabled === 1,
    isDefault: row.is_default === 1,
    tokens: tokenCostsFor(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toPersonaDto(row: PersonaRow): PersonaDto {
  return {
    id: row.ulid,
    name: row.name,
    description: row.description,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ------------------------------------------------------------------ */
/* Authors                                                             */
/* ------------------------------------------------------------------ */

export function insertAuthor(db: Database, name: string): AuthorRow {
  const now = Date.now();
  // The first author becomes the default, so a fresh install has one without
  // the user having to make a second decision.
  const isFirst =
    (db.query("SELECT count(*) AS n FROM authors").get() as { n: number }).n === 0 ? 1 : 0;
  return db
    .query(
      `INSERT INTO authors (ulid, name, is_default, created_at, updated_at)
       VALUES ($ulid, $name, $is_default, $now, $now) RETURNING *`,
    )
    .get({ ulid: ulid(), name, is_default: isFirst, now }) as AuthorRow;
}

export function listAuthors(db: Database): AuthorRow[] {
  return db
    .query("SELECT * FROM authors ORDER BY is_default DESC, name COLLATE NOCASE")
    .all() as AuthorRow[];
}

export function findAuthor(db: Database, value: string): AuthorRow | null {
  return (db.query("SELECT * FROM authors WHERE ulid = $ulid").get({ ulid: value }) ??
    null) as AuthorRow | null;
}

export function findAuthorById(db: Database, id: number): AuthorRow | null {
  return (db.query("SELECT * FROM authors WHERE id = $id").get({ id }) ??
    null) as AuthorRow | null;
}

const AUTHOR_COLUMNS = {
  name: "name",
  personality: "personality",
  writingStyle: "writing_style",
  directingStyle: "directing_style",
  oocVoice: "ooc_voice",
  boundaries: "boundaries",
} as const;

export function updateAuthor(
  db: Database,
  id: number,
  patch: Record<string, unknown>,
): AuthorRow {
  const assignments: string[] = [];
  const params: Record<string, string | number | null> = { id, now: Date.now() };

  for (const [field, column] of Object.entries(AUTHOR_COLUMNS)) {
    if (!(field in patch)) continue;
    assignments.push(`${column} = $${column}`);
    const value = patch[field];
    params[column] = typeof value === "string" ? value : null;
  }
  if ("memoryEnabled" in patch) {
    assignments.push("memory_enabled = $memory_enabled");
    params["memory_enabled"] = patch["memoryEnabled"] === true ? 1 : 0;
  }

  // Only one author can be the default, so setting one clears the rest first.
  if (patch["isDefault"] === true) {
    db.query("UPDATE authors SET is_default = 0 WHERE is_default = 1").run();
    assignments.push("is_default = 1");
  }

  if (assignments.length === 0) return findAuthorById(db, id) as AuthorRow;

  return db
    .query(
      `UPDATE authors SET ${assignments.join(", ")}, updated_at = $now WHERE id = $id RETURNING *`,
    )
    .get(params) as AuthorRow;
}

export function deleteAuthor(db: Database, id: number): void {
  db.query("DELETE FROM authors WHERE id = $id").run({ id });
}

/* ------------------------------------------------------------------ */
/* Personas                                                            */
/* ------------------------------------------------------------------ */

export function insertPersona(db: Database, name: string): PersonaRow {
  const now = Date.now();
  const isFirst =
    (db.query("SELECT count(*) AS n FROM personas").get() as { n: number }).n === 0 ? 1 : 0;
  return db
    .query(
      `INSERT INTO personas (ulid, name, is_default, created_at, updated_at)
       VALUES ($ulid, $name, $is_default, $now, $now) RETURNING *`,
    )
    .get({ ulid: ulid(), name, is_default: isFirst, now }) as PersonaRow;
}

export function listPersonas(db: Database): PersonaRow[] {
  return db
    .query("SELECT * FROM personas ORDER BY is_default DESC, name COLLATE NOCASE")
    .all() as PersonaRow[];
}

export function findPersona(db: Database, value: string): PersonaRow | null {
  return (db.query("SELECT * FROM personas WHERE ulid = $ulid").get({ ulid: value }) ??
    null) as PersonaRow | null;
}

export function findPersonaById(db: Database, id: number): PersonaRow | null {
  return (db.query("SELECT * FROM personas WHERE id = $id").get({ id }) ??
    null) as PersonaRow | null;
}

export function findDefaultPersona(db: Database): PersonaRow | null {
  return (db.query("SELECT * FROM personas WHERE is_default = 1").get() ??
    null) as PersonaRow | null;
}

export function updatePersona(
  db: Database,
  id: number,
  patch: Record<string, unknown>,
): PersonaRow {
  const assignments: string[] = [];
  const params: Record<string, string | number | null> = { id, now: Date.now() };

  for (const [field, column] of [
    ["name", "name"],
    ["description", "description"],
  ] as const) {
    if (!(field in patch)) continue;
    assignments.push(`${column} = $${column}`);
    const value = patch[field];
    params[column] = typeof value === "string" ? value : null;
  }

  if (patch["isDefault"] === true) {
    db.query("UPDATE personas SET is_default = 0 WHERE is_default = 1").run();
    assignments.push("is_default = 1");
  }

  if (assignments.length === 0) return findPersonaById(db, id) as PersonaRow;

  return db
    .query(
      `UPDATE personas SET ${assignments.join(", ")}, updated_at = $now WHERE id = $id RETURNING *`,
    )
    .get(params) as PersonaRow;
}

export function deletePersona(db: Database, id: number): void {
  db.query("DELETE FROM personas WHERE id = $id").run({ id });
}

/* ------------------------------------------------------------------ */
/* Scene membership                                                    */
/* ------------------------------------------------------------------ */

export function addSceneMember(db: Database, sceneId: number, characterId: number): void {
  const next = (
    db
      .query(
        "SELECT coalesce(max(display_order), -1) + 1 AS next FROM scene_members WHERE scene_id = $scene_id",
      )
      .get({ scene_id: sceneId }) as { next: number }
  ).next;

  // Presence tracking (SPEC §6): a character added to a scene already in
  // progress did not witness what came before, and the leaf at the moment they
  // joined is what marks that. Joining an empty scene leaves it null, meaning
  // "present from the start".
  const leaf = (
    db.query("SELECT active_leaf_id FROM scenes WHERE id = $id").get({ id: sceneId }) as {
      active_leaf_id: number | null;
    }
  ).active_leaf_id;

  db.query(
    `INSERT INTO scene_members (scene_id, character_id, display_order, joined_after_message_id, created_at)
     VALUES ($scene_id, $character_id, $display_order, $joined_after, $now)
     ON CONFLICT (scene_id, character_id) DO NOTHING`,
  ).run({
    scene_id: sceneId,
    character_id: characterId,
    display_order: next,
    joined_after: leaf,
    now: Date.now(),
  });
}

export function removeSceneMember(db: Database, sceneId: number, characterId: number): void {
  db.query(
    "DELETE FROM scene_members WHERE scene_id = $scene_id AND character_id = $character_id",
  ).run({ scene_id: sceneId, character_id: characterId });
}

/** A cast member: the character, plus how they take part in this scene. */
export interface CastRow extends CharacterRow {
  is_active: number;
  display_order: number;
  /** The last message that had happened when this member joined (SPEC §6). */
  joined_after_message_id: number | null;
}

/** Full cast rows for a scene, in display order. */
export function castRowsOf(db: Database, sceneId: number): CastRow[] {
  return db
    .query(
      `SELECT c.*, m.is_active, m.display_order, m.joined_after_message_id
         FROM scene_members m JOIN characters c ON c.id = m.character_id
        WHERE m.scene_id = $scene_id ORDER BY m.display_order, m.id`,
    )
    .all({ scene_id: sceneId }) as CastRow[];
}

export function setMemberActive(
  db: Database,
  sceneId: number,
  characterId: number,
  isActive: boolean,
): void {
  db.query(
    `UPDATE scene_members SET is_active = $is_active
      WHERE scene_id = $scene_id AND character_id = $character_id`,
  ).run({ scene_id: sceneId, character_id: characterId, is_active: isActive ? 1 : 0 });
}

export function setTurnStrategy(db: Database, sceneId: number, strategy: string): void {
  db.query("UPDATE scenes SET turn_strategy = $strategy, updated_at = $now WHERE id = $id").run({
    id: sceneId,
    strategy,
    now: Date.now(),
  });
}

/** Where the classifier runs. Null falls back to the scene's own profile (§6). */
export function setDirectorProfile(db: Database, sceneId: number, profileId: number | null): void {
  db.query(
    "UPDATE scenes SET director_profile_id = $profile, updated_at = $now WHERE id = $id",
  ).run({ id: sceneId, profile: profileId, now: Date.now() });
}

/** Steer: a persistent director note on the scene, until cleared (SPEC §7). */
export function setDirectorNote(db: Database, sceneId: number, note: string | null): void {
  db.query("UPDATE scenes SET director_note = $note, updated_at = $now WHERE id = $id").run({
    id: sceneId,
    note,
    now: Date.now(),
  });
}

/** Whether this scene runs the post-generation passes unasked (SPEC §7.5). */
export function setAutoPasses(db: Database, sceneId: number, on: boolean): void {
  db.query("UPDATE scenes SET auto_passes = $on, updated_at = $now WHERE id = $id").run({
    id: sceneId,
    on: on ? 1 : 0,
    now: Date.now(),
  });
}
