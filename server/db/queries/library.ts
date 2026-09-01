import type { Database } from "bun:sqlite";
import { ulid } from "../../lib/ulid.ts";
import type {
  CharacterFilterQuery,
  CharacterSnapshotDto,
  CharacterVersionDto,
  SavedFilterDto,
} from "../../../shared/types.ts";
import { updateCharacter, snapshotCharacter, type CharacterRow } from "./characters.ts";

/**
 * The character library at scale (SPEC §9, §20 phase 26): search, tags,
 * folders, saved filters, bulk edits and version history.
 *
 * Kept apart from `characters.ts` — which owns import, export and the single
 * card — because everything here operates on the library as a collection. The
 * version snapshots do hook into `insertCharacter` and `updateCharacter`, but
 * the hook itself is two lines each and this module holds the rest.
 */

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

/**
 * Sanitise a user query for FTS5. The query syntax (`"`, `*`, `AND`, `NEAR`)
 * is powerful and hostile to a search box: a stray quote turns a search into a
 * syntax error. Each word is kept, syntax is stripped, and the words are
 * ANDed — which is what a library search means.
 */
function ftsQuery(raw: string): string {
  const words = raw
    .replace(/["*()^:]/g, " ")
    .split(/\s+/)
    .filter((word) => word !== "");
  return words.map((word) => `"${word}"`).join(" ");
}

export function listCharactersFiltered(
  db: Database,
  filter: CharacterFilterQuery,
): CharacterRow[] {
  const conditions: string[] = [];
  const params: Record<string, string> = {};

  const q = filter.q?.trim() ?? "";
  if (q !== "") {
    conditions.push(`characters.id IN (SELECT rowid FROM characters_fts WHERE characters_fts MATCH $q)`);
    params.q = ftsQuery(q);
  }
  if (filter.tag !== undefined && filter.tag !== "") {
    conditions.push(`EXISTS (SELECT 1 FROM json_each(characters.tags) WHERE json_each.value = $tag)`);
    params.tag = filter.tag;
  }
  if (filter.folder !== undefined && filter.folder !== "") {
    conditions.push("characters.folder = $folder");
    params.folder = filter.folder;
  }

  const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
  return db
    .query(`SELECT characters.* FROM characters ${where} ORDER BY characters.name COLLATE NOCASE`)
    .all(params) as CharacterRow[];
}

/** Every distinct tag in the library, for autocomplete (SPEC §9). */
export function characterTags(db: Database): string[] {
  const rows = db.query("SELECT tags FROM characters").all() as { tags: string }[];
  const seen = new Set<string>();
  for (const row of rows) {
    try {
      const parsed: unknown = JSON.parse(row.tags);
      if (Array.isArray(parsed)) {
        for (const tag of parsed) if (typeof tag === "string" && tag !== "") seen.add(tag);
      }
    } catch {
      /* A row with malformed tags is skipped, not fatal. */
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/** Every folder in the library, for the folder filter (SPEC §9). */
export function characterFolders(db: Database): string[] {
  const rows = db
    .query("SELECT DISTINCT folder FROM characters WHERE folder IS NOT NULL AND folder != '' ORDER BY folder COLLATE NOCASE")
    .all() as { folder: string }[];
  return rows.map((row) => row.folder);
}

/* ------------------------------------------------------------------ */
/* Version history                                                     */
/* ------------------------------------------------------------------ */

export function characterVersions(db: Database, characterId: number): CharacterVersionDto[] {
  const rows = db
    .query(
      `SELECT ulid, snapshot, created_at FROM character_versions
        WHERE character_id = $character ORDER BY id DESC`,
    )
    .all({ character: characterId }) as { ulid: string; snapshot: string; created_at: number }[];

  return rows.map((row) => {
    let name = "";
    try {
      name = String((JSON.parse(row.snapshot) as { name?: unknown }).name ?? "");
    } catch {
      /* Fall through with an empty name. */
    }
    return { id: row.ulid, name, createdAt: row.created_at };
  });
}

export function findVersion(
  db: Database,
  characterId: number,
  versionUlid: string,
): CharacterSnapshotDto | null {
  const row = db
    .query(
      `SELECT ulid, snapshot, created_at FROM character_versions
        WHERE character_id = $character AND ulid = $ulid`,
    )
    .get({ character: characterId, ulid: versionUlid }) as
    | { ulid: string; snapshot: string; created_at: number }
    | null;
  if (row === null) return null;
  let character: Record<string, unknown>;
  try {
    character = JSON.parse(row.snapshot) as Record<string, unknown>;
  } catch {
    return null;
  }
  return {
    id: row.ulid,
    createdAt: row.created_at,
    character: character as unknown as CharacterSnapshotDto["character"],
  };
}

/** Restore a snapshot, writing the state before it as a new snapshot first. */
export function restoreVersion(
  db: Database,
  characterId: number,
  versionUlid: string,
): CharacterRow | null {
  const version = findVersion(db, characterId, versionUlid);
  if (version === null) return null;
  return updateCharacter(db, characterId, { ...version.character });
}

/* ------------------------------------------------------------------ */
/* Bulk edits                                                          */
/* ------------------------------------------------------------------ */

function ulidToId(db: Database, ulid: string): number | null {
  const row = db.query("SELECT id FROM characters WHERE ulid = $ulid").get({ ulid }) as
    | { id: number }
    | null;
  return row?.id ?? null;
}

export function bulkApply(
  db: Database,
  ids: string[],
  op: "tag" | "untag" | "move" | "delete",
  tag: string | null,
  folder: string | null,
): { characters: CharacterRow[]; deleted: number } {
  const rows = ids
    .map((id) => ulidToId(db, id))
    .filter((id): id is number => id !== null);

  let deleted = 0;
  for (const id of rows) {
    switch (op) {
      case "tag": {
        if (tag === null) break;
        const row = db.query("SELECT tags FROM characters WHERE id = $id").get({ id }) as {
          tags: string;
        };
        let current: string[] = [];
        try {
          const parsed: unknown = JSON.parse(row.tags);
          if (Array.isArray(parsed)) current = parsed.filter((v): v is string => typeof v === "string");
        } catch {
          /* Start fresh. */
        }
        if (!current.includes(tag)) {
          db.query("UPDATE characters SET tags = $tags, updated_at = $now WHERE id = $id").run({
            id,
            tags: JSON.stringify([...current, tag]),
            now: Date.now(),
          });
        }
        break;
      }
      case "untag": {
        if (tag === null) break;
        const row = db.query("SELECT tags FROM characters WHERE id = $id").get({ id }) as {
          tags: string;
        };
        let current: string[] = [];
        try {
          const parsed: unknown = JSON.parse(row.tags);
          if (Array.isArray(parsed)) current = parsed.filter((v): v is string => typeof v === "string");
        } catch {
          /* Nothing to remove. */
        }
        db.query("UPDATE characters SET tags = $tags, updated_at = $now WHERE id = $id").run({
          id,
          tags: JSON.stringify(current.filter((existing) => existing !== tag)),
          now: Date.now(),
        });
        break;
      }
      case "move": {
        db.query("UPDATE characters SET folder = $folder, updated_at = $now WHERE id = $id").run({
          id,
          folder: folder === null || folder === "" ? null : folder,
          now: Date.now(),
        });
        break;
      }
      case "delete": {
        db.query("DELETE FROM characters WHERE id = $id").run({ id });
        deleted += 1;
        break;
      }
    }
  }

  const survivors = db
    .query("SELECT * FROM characters WHERE id IN (SELECT value FROM json_each($ids))")
    .all({ ids: JSON.stringify(rows) }) as CharacterRow[];
  return { characters: survivors, deleted };
}

/* ------------------------------------------------------------------ */
/* Saved filters                                                       */
/* ------------------------------------------------------------------ */

export function listSavedFilters(db: Database): SavedFilterDto[] {
  const rows = db.query("SELECT * FROM saved_filters ORDER BY id DESC").all() as {
    ulid: string;
    name: string;
    query: string;
  }[];
  return rows.map((row) => {
    let query: CharacterFilterQuery = {};
    try {
      query = JSON.parse(row.query) as CharacterFilterQuery;
    } catch {
      /* Empty. */
    }
    return { id: row.ulid, name: row.name, query };
  });
}

export function insertSavedFilter(
  db: Database,
  name: string,
  query: CharacterFilterQuery,
): SavedFilterDto {
  const row = db
    .query(
      `INSERT INTO saved_filters (ulid, name, query, created_at)
       VALUES ($ulid, $name, $query, $now) RETURNING ulid, name, query`,
    )
    .get({ ulid: ulid(), name, query: JSON.stringify(query), now: Date.now() }) as {
    ulid: string;
    name: string;
    query: string;
  };
  return { id: row.ulid, name: row.name, query: JSON.parse(row.query) as CharacterFilterQuery };
}

export function deleteSavedFilter(db: Database, ulid: string): boolean {
  const result = db.query("DELETE FROM saved_filters WHERE ulid = $ulid").run({ ulid });
  return result.changes > 0;
}
