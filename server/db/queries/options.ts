import type { Database } from "bun:sqlite";
import { ulid } from "../../lib/ulid.ts";
import { createEstimatingTokenizer } from "../../prompt/index.ts";
import type { BanPhraseDto, OptionDto, OptionGroupDto } from "../../../shared/types.ts";
import { BUILTIN_BANS, BUILTIN_GROUPS } from "../../options/builtin.ts";

/**
 * Prompt option groups and the ban list (SPEC §13.5, §13.6).
 *
 * The cardinality is the reason this is a table rather than a longer system
 * prompt. `one_of` is enforced on write: selecting an option clears the others
 * in its group, so a scene cannot ask for first person and third person at
 * once. A wall of toggles cannot promise that, and the suites that use one
 * spend a great deal of prompt text asking the model to sort it out.
 */

export interface OptionGroupRow {
  id: number;
  ulid: string;
  key: string;
  name: string;
  description: string;
  cardinality: "one_of" | "any_of";
  sort_order: number;
  is_builtin: number;
  created_at: number;
  updated_at: number;
}

export interface OptionRow {
  id: number;
  ulid: string;
  group_id: number;
  key: string;
  name: string;
  fragment: string;
  position: "prefix" | "depth" | "outlet";
  depth: number;
  outlet_name: string | null;
  role: "system" | "user" | "assistant";
  sort_order: number;
  is_builtin: number;
  created_at: number;
  updated_at: number;
}

export interface BanPhraseRow {
  id: number;
  ulid: string;
  scene_id: number | null;
  phrase: string;
  origin: "builtin" | "user" | "proposed";
  hits: number;
  enabled: number;
  created_at: number;
  updated_at: number;
}

/* ------------------------------------------------------------------ */
/* Seeding                                                             */
/* ------------------------------------------------------------------ */

/**
 * Put the shipped groups and bans in place, once.
 *
 * Idempotent by key rather than by "have we run": a built-in whose words
 * improve should reach an existing install, and a group somebody has renamed or
 * an option they have rewritten should not be reverted. So a missing row is
 * inserted and a present one is left exactly as it is.
 */
export function seedBuiltins(db: Database): void {
  const now = Date.now();

  for (const [groupOrder, group] of BUILTIN_GROUPS.entries()) {
    // bun:sqlite returns null for a miss, not undefined — the rest of this
    // codebase normalises with `?? null` for exactly that reason.
    let row = (db.query("SELECT * FROM option_groups WHERE key = $key").get({ key: group.key }) ??
      null) as OptionGroupRow | null;
    if (row === null) {
      row = db
        .query(
          `INSERT INTO option_groups
             (ulid, key, name, description, cardinality, sort_order, is_builtin, created_at, updated_at)
           VALUES ($ulid, $key, $name, $description, $cardinality, $sort, 1, $now, $now)
           RETURNING *`,
        )
        .get({
          ulid: ulid(),
          key: group.key,
          name: group.name,
          description: group.description,
          cardinality: group.cardinality,
          sort: groupOrder,
          now,
        }) as OptionGroupRow;
    }

    for (const [optionOrder, option] of group.options.entries()) {
      const existing =
        db.query("SELECT id FROM options WHERE group_id = $group AND key = $key").get({
          group: row.id,
          key: option.key,
        }) ?? null;
      if (existing !== null) continue;
      db.query(
        `INSERT INTO options
           (ulid, group_id, key, name, fragment, position, depth, role, sort_order,
            is_builtin, created_at, updated_at)
         VALUES ($ulid, $group, $key, $name, $fragment, 'depth', 0, 'system', $sort, 1, $now, $now)`,
      ).run({
        ulid: ulid(),
        group: row.id,
        key: option.key,
        name: option.name,
        fragment: option.fragment,
        sort: optionOrder,
        now,
      });
    }
  }

  // The starter ban list is global — §13.6 wants per-scene and global lists,
  // and a phrase every model reaches for is not a property of one story.
  const seeded = (db
    .query("SELECT COUNT(*) AS n FROM ban_phrases WHERE origin = 'builtin'")
    .get() ?? null) as { n: number } | null;
  if ((seeded?.n ?? 0) === 0) {
    for (const phrase of BUILTIN_BANS) {
      db.query(
        `INSERT INTO ban_phrases (ulid, scene_id, phrase, origin, created_at, updated_at)
         VALUES ($ulid, NULL, $phrase, 'builtin', $now, $now)`,
      ).run({ ulid: ulid(), phrase, now });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

export function listGroups(db: Database): OptionGroupRow[] {
  return db
    .query("SELECT * FROM option_groups ORDER BY sort_order, id")
    .all() as OptionGroupRow[];
}

export function listOptions(db: Database, groupId: number): OptionRow[] {
  return db
    .query("SELECT * FROM options WHERE group_id = $group ORDER BY sort_order, id")
    .all({ group: groupId }) as OptionRow[];
}

export function findOptionByUlid(db: Database, value: string): OptionRow | null {
  return (db.query("SELECT * FROM options WHERE ulid = $ulid").get({ ulid: value }) ??
    null) as OptionRow | null;
}

/**
 * The options a scene has switched on.
 *
 * A scene that has never been configured gets the shipped defaults rather than
 * nothing: §22 is explicit that a preset arriving entirely switched off is an
 * anti-pattern, and "the first run looks broken" is exactly what happens when
 * every group is empty.
 */
export function selectedOptions(db: Database, sceneId: number): OptionRow[] {
  const chosen = db
    .query(
      `SELECT o.* FROM options o
         JOIN scene_options so ON so.option_id = o.id
        WHERE so.scene_id = $scene
        ORDER BY o.group_id, o.sort_order`,
    )
    .all({ scene: sceneId }) as OptionRow[];
  if (chosen.length > 0) return chosen;
  return defaultOptions(db);
}

/** Whether this scene has ever chosen for itself, as opposed to inheriting. */
export function sceneHasChosen(db: Database, sceneId: number): boolean {
  const row = db
    .query("SELECT COUNT(*) AS n FROM scene_options WHERE scene_id = $scene")
    .get({ scene: sceneId }) as { n: number } | null;
  return (row?.n ?? 0) > 0;
}

/** The shipped configuration, which is what an unconfigured scene runs on. */
export function defaultOptions(db: Database): OptionRow[] {
  const wanted = new Set<string>();
  for (const group of BUILTIN_GROUPS) {
    for (const option of group.options) {
      if (option.isDefault === true) wanted.add(`${group.key}:${option.key}`);
    }
  }
  return listGroups(db)
    .flatMap((group) =>
      listOptions(db, group.id).filter((option) => wanted.has(`${group.key}:${option.key}`)),
    );
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Turn one option on or off for a scene, honouring its group's cardinality.
 *
 * The first write on a scene materialises the defaults, because until then the
 * scene is *inheriting* them rather than holding them — and switching one thing
 * off has to mean "this, and keep the rest", not "this alone".
 */
export function setSceneOption(
  db: Database,
  sceneId: number,
  option: OptionRow,
  on: boolean,
): void {
  if (!sceneHasChosen(db, sceneId)) {
    const insert = db.query(
      "INSERT OR IGNORE INTO scene_options (scene_id, option_id) VALUES ($scene, $option)",
    );
    for (const row of defaultOptions(db)) insert.run({ scene: sceneId, option: row.id });
  }

  const group = db
    .query("SELECT * FROM option_groups WHERE id = $id")
    .get({ id: option.group_id }) as OptionGroupRow;

  if (on) {
    // `one_of` is enforced here rather than trusted: a scene must not be able
    // to ask for two points of view at once.
    if (group.cardinality === "one_of") {
      db.query(
        `DELETE FROM scene_options
          WHERE scene_id = $scene
            AND option_id IN (SELECT id FROM options WHERE group_id = $group)`,
      ).run({ scene: sceneId, group: group.id });
    }
    db.query(
      "INSERT OR IGNORE INTO scene_options (scene_id, option_id) VALUES ($scene, $option)",
    ).run({ scene: sceneId, option: option.id });
    return;
  }

  db.query(
    "DELETE FROM scene_options WHERE scene_id = $scene AND option_id = $option",
  ).run({ scene: sceneId, option: option.id });
}

/** Put a scene back on the shipped configuration. */
export function resetSceneOptions(db: Database, sceneId: number): void {
  db.query("DELETE FROM scene_options WHERE scene_id = $scene").run({ scene: sceneId });
}

/* ------------------------------------------------------------------ */
/* The ban list (SPEC §13.6)                                           */
/* ------------------------------------------------------------------ */

/**
 * The phrases in force for a scene: the global list plus its own.
 *
 * Proposals are excluded. §13.6 makes auto-analysis a background task, and a
 * task that silently started banning phrases would be editing somebody's prose
 * on its own authority — a proposal is a suggestion until a person accepts it.
 */
export function activeBans(db: Database, sceneId: number | null): BanPhraseRow[] {
  return db
    .query(
      `SELECT * FROM ban_phrases
        WHERE enabled = 1 AND origin <> 'proposed'
          AND (scene_id IS NULL ${sceneId === null ? "" : "OR scene_id = $scene"})
        ORDER BY scene_id IS NULL DESC, id`,
    )
    .all(sceneId === null ? {} : { scene: sceneId }) as BanPhraseRow[];
}

/** Everything on a scene's lists, proposals included, for the editor. */
export function listBans(db: Database, sceneId: number | null): BanPhraseRow[] {
  return db
    .query(
      `SELECT * FROM ban_phrases
        WHERE scene_id IS NULL ${sceneId === null ? "" : "OR scene_id = $scene"}
        ORDER BY scene_id IS NULL DESC, origin, id`,
    )
    .all(sceneId === null ? {} : { scene: sceneId }) as BanPhraseRow[];
}

export function findBan(db: Database, value: string): BanPhraseRow | null {
  return (db.query("SELECT * FROM ban_phrases WHERE ulid = $ulid").get({ ulid: value }) ??
    null) as BanPhraseRow | null;
}

export interface NewBan {
  sceneId: number | null;
  phrase: string;
  origin?: "user" | "proposed";
  hits?: number;
}

/**
 * Add a phrase, or bump the one that is already there.
 *
 * The analyser proposes the same phrase every time it runs until somebody deals
 * with it, and a list that grew a duplicate on each run would be unusable
 * within a week. A repeat proposal raises the count instead, which is the
 * number §13.6 wants anyway: recurrence is the evidence.
 */
export function addBan(db: Database, input: NewBan): BanPhraseRow {
  const phrase = input.phrase.trim();
  const now = Date.now();
  const existing = (db
    .query(
      `SELECT * FROM ban_phrases
        WHERE phrase = $phrase COLLATE NOCASE
          AND scene_id IS ${input.sceneId === null ? "NULL" : "$scene"}`,
    )
    .get(input.sceneId === null ? { phrase } : { phrase, scene: input.sceneId }) ?? null) as
    | BanPhraseRow
    | null;

  if (existing !== null) {
    return db
      .query(
        `UPDATE ban_phrases
            SET hits = hits + $hits, updated_at = $now
          WHERE id = $id
         RETURNING *`,
      )
      .get({ id: existing.id, hits: input.hits ?? 0, now }) as BanPhraseRow;
  }

  return db
    .query(
      `INSERT INTO ban_phrases (ulid, scene_id, phrase, origin, hits, created_at, updated_at)
       VALUES ($ulid, $scene, $phrase, $origin, $hits, $now, $now)
       RETURNING *`,
    )
    .get({
      ulid: ulid(),
      scene: input.sceneId,
      phrase,
      origin: input.origin ?? "user",
      hits: input.hits ?? 0,
      now,
    }) as BanPhraseRow;
}

/** Accept a proposal, which is what turns it into an enforced ban. */
export function acceptBan(db: Database, id: number): BanPhraseRow {
  return db
    .query(
      `UPDATE ban_phrases SET origin = 'user', enabled = 1, updated_at = $now
        WHERE id = $id RETURNING *`,
    )
    .get({ id, now: Date.now() }) as BanPhraseRow;
}

export function setBanEnabled(db: Database, id: number, enabled: boolean): BanPhraseRow {
  return db
    .query(
      `UPDATE ban_phrases SET enabled = $enabled, updated_at = $now
        WHERE id = $id RETURNING *`,
    )
    .get({ id, enabled: enabled ? 1 : 0, now: Date.now() }) as BanPhraseRow;
}

export function deleteBan(db: Database, id: number): void {
  db.query("DELETE FROM ban_phrases WHERE id = $id").run({ id });
}

/* ------------------------------------------------------------------ */
/* Mappers                                                             */
/* ------------------------------------------------------------------ */

export function toOptionDto(row: OptionRow, selected: boolean): OptionDto {
  const tokenizer = createEstimatingTokenizer();
  return {
    id: row.ulid,
    key: row.key,
    name: row.name,
    fragment: row.fragment,
    // §13.5: every option is visible as a labelled block with a token cost,
    // which is the whole argument for this over a wall of toggles.
    tokenCount: tokenizer.count(row.fragment),
    selected,
    isBuiltin: row.is_builtin === 1,
  };
}

export function toGroupDto(
  row: OptionGroupRow,
  options: OptionRow[],
  selected: Set<number>,
): OptionGroupDto {
  return {
    id: row.ulid,
    key: row.key,
    name: row.name,
    description: row.description,
    cardinality: row.cardinality,
    options: options.map((option) => toOptionDto(option, selected.has(option.id))),
  };
}

export function toBanDto(row: BanPhraseRow): BanPhraseDto {
  return {
    id: row.ulid,
    phrase: row.phrase,
    origin: row.origin,
    hits: row.hits,
    enabled: row.enabled === 1,
    isGlobal: row.scene_id === null,
  };
}
