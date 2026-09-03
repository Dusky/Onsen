import type { Database } from "bun:sqlite";
import { join } from "node:path";
import { ulid } from "../lib/ulid.ts";
import { importCard, hashOf } from "../cards/index.ts";
import { CardError } from "../cards/card.ts";
import { insertCharacter } from "../db/queries/characters.ts";
import { insertLorebook, insertEntry, updateEntry } from "../db/queries/lore.ts";
import { insertAuthor, updateAuthor } from "../db/queries/authors.ts";
import { insertPreset } from "../db/queries/connections.ts";
import { insertScript } from "../db/queries/scripts.ts";
import { insertTrigger } from "../db/queries/triggers.ts";
import { addBan, listBans } from "../db/queries/options.ts";
import { PackError, satisfiesHost, type PackKind, type PackManifest } from "./manifest.ts";
import type { PackContents, PackDocument } from "./archive.ts";

/**
 * Installing a pack (SPEC §15 tier 2).
 *
 * Three properties the spec asks for, and each one shapes the code:
 *
 * - **Nothing executes.** Every document below is read as data and written
 *   through the same insert helpers the routes use. There is no path here that
 *   evaluates anything a pack supplied.
 * - **Previewable.** `planInstall` reads the archive and the database and
 *   writes nothing, so the answer it gives is the answer the install will act
 *   on rather than a guess about it.
 * - **Transactional, and reversible.** Every row is written inside one
 *   `bun:sqlite` transaction and recorded in `pack_rows` as it goes, so a
 *   failure anywhere takes the whole install with it and an uninstall later
 *   removes exactly what was added.
 *
 * A collision is skipped rather than overwritten. §15 asks the preview to show
 * "what will be added or overwritten", but overwriting and exact uninstall are
 * in tension: a row the pack replaced cannot be put back by a table that only
 * records what it owns. Exactness is the property the spec's own test list asks
 * for, so a name already in use is reported and left alone. Updating a pack is
 * uninstall then install, which is what the ownership record is for.
 */

export type PlanAction = "add" | "skip";

export interface PlanItem {
  kind: PackKind;
  name: string;
  action: PlanAction;
  /** Why it was skipped, or what it brings. One line, for the preview. */
  detail: string;
}

export interface PackPlan {
  manifest: PackManifest;
  /** Set when the pack cannot be installed at all. Null when it can. */
  problem: string | null;
  items: PlanItem[];
  /** Assets the pack carries that no document claimed. */
  strayAssets: number;
}

/** A row this install created, addressed the way `pack_rows` addresses it. */
interface Owned {
  table: string;
  id: number;
  label: string;
}

/** A file to write once the transaction has committed. */
interface PendingFile {
  path: string;
  data: Uint8Array;
}

interface Writer {
  own(table: string, id: number, label: string): void;
  file(path: string, data: Uint8Array): void;
}

function text(source: Record<string, unknown>, key: string, max = 8_000): string {
  const value = source[key];
  return typeof value === "string" ? value.slice(0, max) : "";
}

function whole(source: Record<string, unknown>, key: string, fallback: number): number {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function flag(source: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = source[key];
  return typeof value === "boolean" ? value : fallback;
}

/**
 * One installable thing, resolved once.
 *
 * Plan and install walk the same list. They used not to: the planner read the
 * archive's JSON documents and the installer re-derived cards from the asset
 * tree, which meant a card arriving as a PNG was checked for collisions by its
 * *filename* — so a pack carrying `Hollis.png` would install a second Hollis
 * beside the one already in the library.
 */
interface Candidate {
  kind: PackKind;
  name: string;
  /** A JSON document, for every kind but a card that travelled as a file. */
  document: PackDocument | null;
  /** A card as bytes: a PNG or a CharX under `characters/`. */
  card: { path: string; bytes: Uint8Array } | null;
  /** Why this one cannot be installed. Reported rather than thrown. */
  error: string | null;
}

function candidatesOf(contents: PackContents): Candidate[] {
  const found: Candidate[] = [];

  for (const [kind, documents] of Object.entries(contents.documents) as [
    PackKind,
    PackDocument[],
  ][]) {
    for (const document of documents) {
      found.push({
        kind,
        name: documentName(document, kind),
        document,
        card: null,
        error: null,
      });
    }
  }

  // A card that travelled as a file is read here rather than at install time,
  // so its real name is known to the preview and a malformed one is named
  // before anything is written.
  for (const [path, bytes] of contents.assets) {
    if (!path.startsWith("characters/")) continue;
    const fallback = path.split("/").at(-1) ?? path;
    try {
      const imported = importCard(bytes, fallback);
      found.push({
        kind: "characters",
        name: imported.card.name || fallback,
        document: null,
        card: { path, bytes },
        error: null,
      });
    } catch (caught) {
      found.push({
        kind: "characters",
        name: fallback,
        document: null,
        card: { path, bytes },
        error: caught instanceof CardError ? caught.message : "That card could not be read.",
      });
    }
  }

  return found;
}

/** The name a document goes by, for collisions and for the preview. */
function documentName(document: PackDocument, kind: PackKind): string {
  const value = document.value;
  if (kind === "characters") {
    const data = (value["data"] ?? value) as Record<string, unknown>;
    return text(data, "name", 120).trim() || document.path;
  }
  return text(value, "name", 120).trim() || document.path;
}

/** Whether something of this kind already goes by this name. */
function taken(db: Database, kind: PackKind, name: string): boolean {
  const tables: Partial<Record<PackKind, string>> = {
    characters: "characters",
    lorebooks: "lorebooks",
    presets: "presets",
    authors: "authors",
    regex: "regex_scripts",
    triggers: "event_triggers",
  };
  const table = tables[kind];
  if (table === undefined) return false;
  const row = db
    .query(`SELECT 1 AS hit FROM ${table} WHERE name = $name COLLATE NOCASE LIMIT 1`)
    .get({ name }) as { hit: number } | null;
  return row !== null;
}

function planFrom(db: Database, contents: PackContents, found: Candidate[]): PackPlan {
  const compatibility = satisfiesHost(contents.manifest.hostApiRange);
  const already = db
    .query("SELECT 1 AS hit FROM packs WHERE name = $name COLLATE NOCASE AND version = $version")
    .get({ name: contents.manifest.name, version: contents.manifest.version }) as
    | { hit: number }
    | null;

  const items: PlanItem[] = found.map((candidate) => {
    if (candidate.error !== null) {
      return {
        kind: candidate.kind,
        name: candidate.name,
        action: "skip" as const,
        detail: candidate.error,
      };
    }
    // A ban list is a set of phrases and an option group takes a fresh key, so
    // neither can collide by name.
    const collides =
      candidate.kind !== "banlists" &&
      candidate.kind !== "options" &&
      taken(db, candidate.kind, candidate.name);
    return {
      kind: candidate.kind,
      name: candidate.name,
      action: collides ? ("skip" as const) : ("add" as const),
      detail: collides
        ? "Already here under that name."
        : candidate.document === null
          ? "A card."
          : describe(candidate.kind, candidate.document),
    };
  });

  const strays = [...contents.assets.keys()].filter(
    (path) => !path.startsWith("assets/") && !path.startsWith("characters/"),
  ).length;

  return {
    manifest: contents.manifest,
    problem:
      compatibility ??
      (already !== null
        ? `${contents.manifest.name} ${contents.manifest.version} is already installed.`
        : null),
    items,
    strayAssets: strays,
  };
}

export function planInstall(db: Database, contents: PackContents): PackPlan {
  return planFrom(db, contents, candidatesOf(contents));
}

function describe(kind: PackKind, document: PackDocument): string {
  switch (kind) {
    case "lorebooks": {
      const entries = document.value["entries"];
      const count = Array.isArray(entries) ? entries.length : 0;
      return `${count} ${count === 1 ? "entry" : "entries"}.`;
    }
    case "banlists": {
      const phrases = document.value["phrases"];
      const count = Array.isArray(phrases) ? phrases.length : 0;
      return `${count} ${count === 1 ? "phrase" : "phrases"}.`;
    }
    case "options": {
      const options = document.value["options"];
      const count = Array.isArray(options) ? options.length : 0;
      return `${count} ${count === 1 ? "option" : "options"}.`;
    }
    default:
      return "";
  }
}

export interface InstallResult {
  packId: string;
  manifest: PackManifest;
  added: number;
  skipped: number;
  items: PlanItem[];
  /** Anything that could not be read, named rather than swallowed (§18). */
  warnings: string[];
}

export interface InstallOptions {
  db: Database;
  /** Where avatars are written. Files land after the transaction commits. */
  avatarsDir: string;
}

export async function installPack(
  options: InstallOptions,
  contents: PackContents,
): Promise<InstallResult> {
  const { db } = options;
  const found = candidatesOf(contents);
  const plan = planFrom(db, contents, found);
  if (plan.problem !== null) throw new PackError(plan.problem);

  const owned: Owned[] = [];
  const files: PendingFile[] = [];
  const warnings: string[] = [];
  const writer: Writer = {
    own: (table, id, label) => owned.push({ table, id, label }),
    file: (path, data) => files.push({ path, data }),
  };

  // One transaction for the whole pack. A throw anywhere inside rolls back
  // every row, which is what makes a half-installed pack impossible.
  const run = db.transaction(() => {
    const packRow = db
      .query(
        `INSERT INTO packs (ulid, name, version, author, description, host_api_range, installed_at)
         VALUES ($ulid, $name, $version, $author, $description, $range, $now)
         RETURNING id, ulid`,
      )
      .get({
        ulid: ulid(),
        name: contents.manifest.name,
        version: contents.manifest.version,
        author: contents.manifest.author,
        description: contents.manifest.description,
        range: contents.manifest.hostApiRange,
        now: Date.now(),
      }) as { id: number; ulid: string };

    // Plan and install walk the same list in the same order, so an item the
    // preview said would be added is the one that is.
    found.forEach((candidate, index) => {
      const item = plan.items[index];
      if (item === undefined || item.action === "skip") return;
      try {
        if (candidate.card !== null) {
          installCard(options, candidate.card, writer, warnings);
        } else if (candidate.document !== null) {
          installDocument(db, candidate.kind, candidate.document, writer);
        }
      } catch (caught) {
        if (caught instanceof CardError) {
          // A card that will not parse is one item, not the whole pack: the
          // rest of the archive is still coherent, and refusing all of it over
          // one bad file would be a worse trade than saying which file.
          warnings.push(`${item.name}: ${caught.message}`);
          item.action = "skip";
          item.detail = caught.message;
          return;
        }
        throw caught;
      }
    });

    const record = db.query(
      "INSERT INTO pack_rows (pack_id, table_name, row_id, label) VALUES ($pack, $table, $row, $label)",
    );
    for (const row of owned) {
      record.run({ pack: packRow.id, table: row.table, row: row.id, label: row.label });
    }
    return packRow.ulid;
  });

  const packId = run();

  // Files last. A write that fails now leaves a character with no avatar, which
  // falls back to the placeholder; rolling the database back for it would throw
  // away a working install over a missing picture.
  for (const file of files) {
    try {
      await Bun.write(join(options.avatarsDir, file.path), file.data);
    } catch {
      warnings.push(`${file.path} could not be written.`);
    }
  }

  const added = plan.items.filter((item) => item.action === "add").length;
  return {
    packId,
    manifest: contents.manifest,
    added,
    skipped: plan.items.length - added,
    items: plan.items,
    warnings,
  };
}

function installCard(
  options: InstallOptions,
  card: { path: string; bytes: Uint8Array },
  writer: Writer,
  warnings: string[],
): void {
  const fileName = card.path.split("/").at(-1) ?? card.path;
  const imported = importCard(card.bytes, fileName);

  let avatarPath: string | null = null;
  if (imported.avatar !== null) {
    avatarPath = `${hashOf(imported.avatar.data).slice(0, 32)}.${imported.avatar.extension}`;
    writer.file(avatarPath, imported.avatar.data);
  }

  const row = insertCharacter(options.db, {
    card: imported.card,
    rawCard: imported.rawCard,
    format: imported.format,
    avatarPath,
    sourceFilename: fileName,
    sourceHash: imported.sourceHash,
  });
  writer.own("characters", row.id, row.name);
  if (imported.unmodelledFields.length > 0) {
    warnings.push(
      `${row.name}: preserved but not shown in the editor — ${imported.unmodelledFields.join(", ")}.`,
    );
  }
}

function installDocument(
  db: Database,
  kind: PackKind,
  document: PackDocument,
  writer: Writer,
): void {
  const value = document.value;
  const name = text(value, "name", 120).trim();

  switch (kind) {
    case "characters": {
      // A card as JSON rather than as a file. The same reader, given bytes.
      const imported = importCard(new TextEncoder().encode(JSON.stringify(value)), document.path);
      const row = insertCharacter(db, {
        card: imported.card,
        rawCard: imported.rawCard,
        format: imported.format,
        avatarPath: null,
        sourceFilename: document.path,
        sourceHash: imported.sourceHash,
      });
      writer.own("characters", row.id, row.name);
      return;
    }

    case "lorebooks": {
      const book = insertLorebook(db, {
        name,
        description: text(value, "description", 2_000),
      });
      writer.own("lorebooks", book.id, book.name);
      const entries = Array.isArray(value["entries"]) ? (value["entries"] as unknown[]) : [];
      for (const raw of entries) {
        if (typeof raw !== "object" || raw === null) continue;
        const source = raw as Record<string, unknown>;
        const created = insertEntry(db, book.id, text(source, "content", 40_000));
        updateEntry(db, created.id, entryPatch(source));
        // Not owned individually: the cascade takes entries with the book, and
        // recording each one would make uninstall delete rows twice.
      }
      return;
    }

    case "presets": {
      const row = insertPreset(db, {
        name,
        samplers: value["samplerSettings"] ?? value["sampler_settings"] ?? {},
        contextSize: whole(value, "contextSize", 32_768),
        maxResponseTokens: whole(value, "maxResponseTokens", 1_024),
      });
      writer.own("presets", row.id, row.name);
      return;
    }

    case "authors": {
      const row = insertAuthor(db, name);
      updateAuthor(db, row.id, {
        personality: text(value, "personality"),
        writing_style: text(value, "writingStyle"),
        directing_style: text(value, "directingStyle"),
        ooc_voice: text(value, "oocVoice"),
        boundaries: text(value, "boundaries"),
      });
      writer.own("authors", row.id, row.name);
      return;
    }

    case "options": {
      installOptionGroup(db, value, writer);
      return;
    }

    case "regex": {
      const row = insertScript(db, {
        name,
        pattern: text(value, "pattern", 2_000),
        replacement: text(value, "replacement", 2_000),
        flags: text(value, "flags", 16) || "g",
        applyTo: (text(value, "applyTo", 20) || "ai_output") as never,
        // A packed script is global. Character and scene scopes name rows that
        // exist in this install and not in the pack's, and a script silently
        // rebound to whoever happens to share a name would be worse than one
        // the user narrows themselves.
        scope: "global",
        characterId: null,
        sceneId: null,
        enabled: flag(value, "enabled", true),
        runOrder: null,
      });
      writer.own("regex_scripts", row.id, row.name);
      return;
    }

    case "triggers": {
      const action = text(value, "action", 20) || "guide";
      const actionRef = text(value, "actionRef", 64);
      // A trigger naming a script names it by the pack's id, which is not this
      // install's. It is rebound to the script this same pack just added under
      // that name, and dropped if there is none — a trigger pointing at nothing
      // is automation that silently never works.
      const resolved =
        action === "script"
          ? ((
              db
                .query("SELECT ulid FROM regex_scripts WHERE name = $name COLLATE NOCASE LIMIT 1")
                .get({ name: text(value, "actionRefName", 120) || actionRef }) as
                | { ulid: string }
                | null
            )?.ulid ?? null)
          : actionRef;
      if (resolved === null) {
        throw new PackError(`${name} names a script this pack does not carry.`);
      }
      const row = insertTrigger(db, {
        name,
        event: (text(value, "event", 32) || "after_generation") as never,
        action: action as never,
        actionRef: resolved,
        automationId: text(value, "automationId", 64) || null,
        scope: "global",
        sceneId: null,
        enabled: flag(value, "enabled", true),
        runOrder: null,
      });
      writer.own("event_triggers", row.id, row.name);
      return;
    }

    case "banlists": {
      const phrases = Array.isArray(value["phrases"]) ? (value["phrases"] as unknown[]) : [];
      for (const phrase of phrases) {
        if (typeof phrase !== "string" || phrase.trim() === "") continue;
        // `addBan` bumps the count on a phrase that is already listed rather
        // than duplicating it - so a phrase the user already had must not be
        // claimed here, or uninstalling this pack would take theirs with it.
        const before = findBan(db, phrase.trim());
        const row = addBan(db, { sceneId: null, phrase, origin: "user" });
        if (before === null) writer.own("ban_phrases", row.id, row.phrase);
      }
      return;
    }
  }
}

/** The global list's existing phrase, or null. Matched as `addBan` matches. */
function findBan(db: Database, phrase: string): { id: number } | null {
  return (
    listBans(db, null).find(
      (row) => row.phrase.toLowerCase() === phrase.toLowerCase(),
    ) ?? null
  );
}

/**
 * A lore entry's fields, mapped from the app's own export shape.
 *
 * Every column §10 gives an entry, not a useful subset. A pack that carried an
 * entry's keys and dropped its sticky window would install something that looks
 * right and behaves differently, which is the failure §18 is about.
 */
function entryPatch(source: Record<string, unknown>): Record<string, unknown> {
  const list = (key: string) =>
    JSON.stringify(Array.isArray(source[key]) ? (source[key] as unknown[]) : []);
  const nullableWhole = (key: string): number | null => {
    const value = source[key];
    return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
  };
  // Constrained rather than passed through. Every one of these columns has a
  // CHECK behind it, so a pack carrying a value from a later version of the app
  // would abort the whole install over one field - the entry loses a setting
  // instead, which is the smaller loss and the one the report can name.
  const oneOf = (key: string, allowed: readonly string[], fallback: string): string => {
    const value = text(source, key, 32);
    return allowed.includes(value) ? value : fallback;
  };
  return {
    title: text(source, "title", 200),
    keys: list("keys"),
    secondary_keys: list("secondaryKeys"),
    secondary_logic: oneOf(
      "secondaryLogic",
      ["and_any", "and_all", "not_any", "not_all"],
      "and_any",
    ),
    enabled: flag(source, "enabled", true) ? 1 : 0,
    is_constant: flag(source, "isConstant", false) ? 1 : 0,
    case_sensitive: flag(source, "caseSensitive", false) ? 1 : 0,
    match_whole_words: flag(source, "matchWholeWords", true) ? 1 : 0,
    use_regex: flag(source, "useRegex", false) ? 1 : 0,
    probability: whole(source, "probability", 100),
    scan_depth: nullableWhole("scanDepth"),
    character_filter: list("characterFilter"),
    sticky: whole(source, "sticky", 0),
    cooldown: whole(source, "cooldown", 0),
    delay: whole(source, "delay", 0),
    delay_from: oneOf("delayFrom", ["scene_start", "branch_point"], "scene_start"),
    inclusion_group: text(source, "inclusionGroup", 64) || null,
    group_weight: whole(source, "groupWeight", 100),
    group_selection: oneOf("groupSelection", ["weight", "prioritize", "score"], "weight"),
    position: oneOf(
      "position",
      [
        "before_character",
        "after_character",
        "before_examples",
        "after_examples",
        "before_history",
        "at_depth",
        "outlet",
      ],
      "before_character",
    ),
    insertion_order: whole(source, "insertionOrder", 100),
    insertion_depth: whole(source, "insertionDepth", 0),
    insertion_role: oneOf("insertionRole", ["system", "user", "assistant"], "system"),
    outlet_name: text(source, "outletName", 64) || null,
    recursion_level: whole(source, "recursionLevel", 0),
    non_recursable: flag(source, "nonRecursable", false) ? 1 : 0,
    prevent_further_recursion: flag(source, "preventFurtherRecursion", false) ? 1 : 0,
    automation_id: text(source, "automationId", 64) || null,
  };
}

function installOptionGroup(db: Database, value: Record<string, unknown>, writer: Writer): void {
  const now = Date.now();
  const name = text(value, "name", 120).trim();
  // A group's key is unique across the table, so a packed group takes a fresh
  // one rather than colliding with a built-in that happens to share a name.
  const key = `pack_${ulid().toLowerCase()}`;
  const group = db
    .query(
      `INSERT INTO option_groups (ulid, key, name, description, cardinality, sort_order, is_builtin, created_at, updated_at)
       VALUES ($ulid, $key, $name, $description, $cardinality, $sort, 0, $now, $now)
       RETURNING id, name`,
    )
    .get({
      ulid: ulid(),
      key,
      name,
      description: text(value, "description", 2_000),
      cardinality: text(value, "cardinality", 16) === "any_of" ? "any_of" : "one_of",
      sort: whole(value, "sortOrder", 100),
      now,
    }) as { id: number; name: string };
  writer.own("option_groups", group.id, group.name);

  const options = Array.isArray(value["options"]) ? (value["options"] as unknown[]) : [];
  let order = 0;
  for (const raw of options) {
    if (typeof raw !== "object" || raw === null) continue;
    const source = raw as Record<string, unknown>;
    db.query(
      `INSERT INTO options (ulid, group_id, key, name, fragment, position, depth, outlet_name, role, sort_order, is_builtin, created_at, updated_at)
       VALUES ($ulid, $group, $key, $name, $fragment, $position, $depth, $outlet, $role, $sort, 0, $now, $now)`,
    ).run({
      ulid: ulid(),
      group: group.id,
      key: text(source, "key", 64) || `opt_${order}`,
      name: text(source, "name", 120),
      fragment: text(source, "fragment", 8_000),
      position: text(source, "position", 16) || "depth",
      depth: whole(source, "depth", 0),
      outlet: text(source, "outletName", 64) || null,
      role: text(source, "role", 16) || "system",
      sort: whole(source, "sortOrder", order),
      now,
    });
    order += 1;
    // Options cascade with their group, as lore entries do with their book.
  }
}

export interface UninstallPreview {
  packId: string;
  name: string;
  version: string;
  rows: { table: string; label: string }[];
}

export function uninstallPreview(db: Database, packUlid: string): UninstallPreview | null {
  const pack = db.query("SELECT * FROM packs WHERE ulid = $ulid").get({ ulid: packUlid }) as
    | { id: number; ulid: string; name: string; version: string }
    | null;
  if (pack === null) return null;
  const rows = db
    .query("SELECT table_name, label FROM pack_rows WHERE pack_id = $pack ORDER BY id")
    .all({ pack: pack.id }) as { table_name: string; label: string }[];
  return {
    packId: pack.ulid,
    name: pack.name,
    version: pack.version,
    rows: rows.map((row) => ({ table: row.table_name, label: row.label })),
  };
}

/**
 * The tables a pack may own a row in.
 *
 * An allow-list rather than trust in the column, because the table name reaches
 * a `DELETE` statement. Nothing user-supplied writes this column today, and it
 * still does not get to name a table.
 */
const OWNABLE = new Set([
  "characters",
  "lorebooks",
  "presets",
  "authors",
  "option_groups",
  "regex_scripts",
  "event_triggers",
  "ban_phrases",
]);

/**
 * Remove exactly what an install added.
 *
 * By recorded row id, not by name: a character the user renamed is still the
 * one this pack brought, and one they wrote themselves that happens to share a
 * name is not.
 */
export function uninstallPack(db: Database, packUlid: string): number {
  const pack = db.query("SELECT id FROM packs WHERE ulid = $ulid").get({ ulid: packUlid }) as
    | { id: number }
    | null;
  if (pack === null) return 0;

  return db.transaction(() => {
    const rows = db
      .query("SELECT table_name, row_id FROM pack_rows WHERE pack_id = $pack ORDER BY id DESC")
      .all({ pack: pack.id }) as { table_name: string; row_id: number }[];

    let removed = 0;
    for (const row of rows) {
      if (!OWNABLE.has(row.table_name)) continue;
      // Counted by looking, not by the driver's `changes`: a delete that
      // cascades reports a number that depends on how many children the row
      // had, and what this returns should be how many things the pack owned.
      const present = db
        .query(`SELECT 1 AS hit FROM ${row.table_name} WHERE id = $id`)
        .get({ id: row.row_id }) as { hit: number } | null;
      db.query(`DELETE FROM ${row.table_name} WHERE id = $id`).run({ id: row.row_id });
      if (present !== null) removed += 1;
    }
    // The pack row goes last; `pack_rows` cascades with it.
    db.query("DELETE FROM packs WHERE id = $id").run({ id: pack.id });
    return removed;
  })();
}
