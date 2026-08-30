import type { Database } from "bun:sqlite";
import { ulid } from "../../lib/ulid.ts";
import { createEstimatingTokenizer } from "../../prompt/index.ts";
import type {
  LoreBindingDto,
  LoreBindingScope,
  LoreEntryDto,
  LorebookDto,
} from "../../../shared/types.ts";
import type { LoreCandidate } from "../../lore/activate.ts";

/**
 * Lorebook storage (SPEC §10).
 *
 * The interesting function here is `candidatesFor`, which is what turns rows
 * into the pure engine's input. Everything else is ordinary CRUD; that one is
 * where the binding model becomes a single flat list of entries, and where a
 * decision worth stating gets made: **a book bound several ways contributes its
 * entries once.** A book attached both globally and to this scene is one book,
 * and a reader who did that meant "definitely include it", not "include it
 * twice".
 */

export interface LorebookRow {
  id: number;
  ulid: string;
  name: string;
  description: string | null;
  token_budget: number;
  scan_depth: number;
  recursion_depth: number;
  raw_import: string | null;
  created_at: number;
  updated_at: number;
}

export interface LoreEntryRow {
  id: number;
  ulid: string;
  lorebook_id: number;
  title: string;
  content: string;
  enabled: number;
  keys: string;
  secondary_keys: string;
  secondary_logic: LoreEntryDto["secondaryLogic"];
  case_sensitive: number;
  match_whole_words: number;
  use_regex: number;
  probability: number;
  is_constant: number;
  scan_depth: number | null;
  character_filter: string;
  sticky: number;
  cooldown: number;
  delay: number;
  delay_from: LoreEntryDto["delayFrom"];
  inclusion_group: string | null;
  group_weight: number;
  group_selection: LoreEntryDto["groupSelection"];
  position: LoreEntryDto["position"];
  insertion_order: number;
  insertion_depth: number;
  insertion_role: LoreEntryDto["insertionRole"];
  outlet_name: string | null;
  recursion_level: number;
  non_recursable: number;
  prevent_further_recursion: number;
  automation_id: string | null;
  raw_entry: string | null;
  created_at: number;
  updated_at: number;
}

export interface LoreBindingRow {
  id: number;
  lorebook_id: number;
  scope: LoreBindingScope;
  scene_id: number | null;
  character_id: number | null;
  persona_id: number | null;
  created_at: number;
}

/** A JSON string array that survives anything the column might hold. */
function parseList(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

export function listLorebooks(db: Database): LorebookRow[] {
  return db.query("SELECT * FROM lorebooks ORDER BY name").all() as LorebookRow[];
}

export function findLorebook(db: Database, value: string): LorebookRow | null {
  return (db.query("SELECT * FROM lorebooks WHERE ulid = $ulid").get({ ulid: value }) ??
    null) as LorebookRow | null;
}

export function listEntries(db: Database, lorebookId: number): LoreEntryRow[] {
  return db
    .query("SELECT * FROM lore_entries WHERE lorebook_id = $book ORDER BY insertion_order, id")
    .all({ book: lorebookId }) as LoreEntryRow[];
}

export function findEntry(db: Database, value: string): LoreEntryRow | null {
  return (db.query("SELECT * FROM lore_entries WHERE ulid = $ulid").get({ ulid: value }) ??
    null) as LoreEntryRow | null;
}

export function bindingsOf(db: Database, lorebookId: number): LoreBindingRow[] {
  return db
    .query("SELECT * FROM lorebook_bindings WHERE lorebook_id = $book ORDER BY id")
    .all({ book: lorebookId }) as LoreBindingRow[];
}

/**
 * Every book that reaches this scene: the global ones, this scene's own, the
 * ones its cast brought along, and its persona's.
 */
export function booksForScene(
  db: Database,
  sceneId: number,
  personaId: number | null,
): LorebookRow[] {
  return db
    .query(
      `SELECT DISTINCT b.* FROM lorebooks b
         JOIN lorebook_bindings bind ON bind.lorebook_id = b.id
        WHERE bind.scope = 'global'
           OR (bind.scope = 'scene' AND bind.scene_id = $scene)
           OR (bind.scope = 'persona' AND bind.persona_id IS NOT NULL
               AND bind.persona_id = $persona)
           OR (bind.scope = 'character' AND bind.character_id IN (
                 SELECT character_id FROM scene_members WHERE scene_id = $scene))
        ORDER BY b.name`,
    )
    .all({ scene: sceneId, persona: personaId }) as LorebookRow[];
}

/** Turn rows into what the engine takes, one entry per book per scene. */
export function candidatesFor(db: Database, books: LorebookRow[]): LoreCandidate[] {
  const seen = new Set<number>();
  const candidates: LoreCandidate[] = [];
  for (const book of books) {
    for (const row of listEntries(db, book.id)) {
      // A book bound several ways is still one book (see the note above).
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      candidates.push(toCandidate(row, book));
    }
  }
  return candidates;
}

export function toCandidate(row: LoreEntryRow, book: LorebookRow): LoreCandidate {
  return {
    id: row.ulid,
    title: row.title,
    content: row.content,
    enabled: row.enabled === 1,
    keys: parseList(row.keys),
    secondaryKeys: parseList(row.secondary_keys),
    secondaryLogic: row.secondary_logic,
    caseSensitive: row.case_sensitive === 1,
    matchWholeWords: row.match_whole_words === 1,
    useRegex: row.use_regex === 1,
    probability: row.probability,
    isConstant: row.is_constant === 1,
    scanDepth: row.scan_depth,
    characterFilter: parseList(row.character_filter),
    sticky: row.sticky,
    cooldown: row.cooldown,
    delay: row.delay,
    delayFrom: row.delay_from,
    inclusionGroup: row.inclusion_group,
    groupWeight: row.group_weight,
    groupSelection: row.group_selection,
    position: row.position,
    insertionOrder: row.insertion_order,
    insertionDepth: row.insertion_depth,
    insertionRole: row.insertion_role,
    outletName: row.outlet_name,
    recursionLevel: row.recursion_level,
    nonRecursable: row.non_recursable === 1,
    preventFurtherRecursion: row.prevent_further_recursion === 1,
    bookId: book.ulid,
    bookScanDepth: book.scan_depth,
    bookTokenBudget: book.token_budget,
  };
}

/* ------------------------------------------------------------------ */
/* Timed effects (§10)                                                 */
/* ------------------------------------------------------------------ */

/**
 * How many messages ago each entry last fired, counted along the active path.
 *
 * The counting is what makes §10's "inherited by branches" true rather than
 * approximately true: an effect anchored to a message that is not on this
 * branch never happened here, so it is not reported at all.
 */
export function timedStateFor(
  db: Database,
  sceneId: number,
  path: { id: number }[],
): { entryId: string; messagesAgo: number }[] {
  const position = new Map(path.map((row, index) => [row.id, index]));
  const rows = db
    .query(
      `SELECT e.ulid AS entry_ulid, t.message_id AS message_id
         FROM lore_timed_effects t
         JOIN lore_entries e ON e.id = t.entry_id
        WHERE t.scene_id = $scene
        ORDER BY t.id DESC`,
    )
    .all({ scene: sceneId }) as { entry_ulid: string; message_id: number }[];

  const newest = new Map<string, number>();
  for (const row of rows) {
    const at = position.get(row.message_id);
    // Off this branch: as far as this path is concerned it never fired.
    if (at === undefined) continue;
    const ago = path.length - 1 - at;
    const held = newest.get(row.entry_ulid);
    if (held === undefined || ago < held) newest.set(row.entry_ulid, ago);
  }
  return [...newest.entries()].map(([entryId, messagesAgo]) => ({ entryId, messagesAgo }));
}

/** Record that these entries fired after this message. */
export function recordActivations(
  db: Database,
  sceneId: number,
  messageId: number,
  entryUlids: string[],
): void {
  if (entryUlids.length === 0) return;
  const find = db.query("SELECT id FROM lore_entries WHERE ulid = $ulid");
  const insert = db.query(
    `INSERT INTO lore_timed_effects (scene_id, entry_id, message_id, created_at)
     VALUES ($scene, $entry, $message, $now)`,
  );
  const now = Date.now();
  for (const value of entryUlids) {
    const row = find.get({ ulid: value }) as { id: number } | null;
    if (row === null) continue;
    insert.run({ scene: sceneId, entry: row.id, message: messageId, now });
  }
}

/**
 * §10: timed effects are "forcibly cleared when the entry is edited".
 *
 * Without this, an entry edited mid-sticky keeps injecting its old behaviour
 * for the rest of the window — the change appears not to have taken.
 */
export function clearTimedEffects(db: Database, entryId: number): void {
  db.query("DELETE FROM lore_timed_effects WHERE entry_id = $entry").run({ entry: entryId });
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

export function insertLorebook(
  db: Database,
  input: { name: string; description?: string | null; rawImport?: string | null },
): LorebookRow {
  const now = Date.now();
  return db
    .query(
      `INSERT INTO lorebooks (ulid, name, description, raw_import, created_at, updated_at)
       VALUES ($ulid, $name, $description, $raw, $now, $now) RETURNING *`,
    )
    .get({
      ulid: ulid(),
      name: input.name,
      description: input.description ?? null,
      raw: input.rawImport ?? null,
      now,
    }) as LorebookRow;
}

export function updateLorebook(
  db: Database,
  id: number,
  patch: Partial<Pick<LorebookRow, "name" | "description" | "token_budget" | "scan_depth" | "recursion_depth">>,
): LorebookRow {
  const current = db.query("SELECT * FROM lorebooks WHERE id = $id").get({ id }) as LorebookRow;
  return db
    .query(
      `UPDATE lorebooks
          SET name = $name, description = $description, token_budget = $budget,
              scan_depth = $scan, recursion_depth = $recursion, updated_at = $now
        WHERE id = $id RETURNING *`,
    )
    .get({
      id,
      name: patch.name ?? current.name,
      description: patch.description === undefined ? current.description : patch.description,
      budget: patch.token_budget ?? current.token_budget,
      scan: patch.scan_depth ?? current.scan_depth,
      recursion: patch.recursion_depth ?? current.recursion_depth,
      now: Date.now(),
    }) as LorebookRow;
}

export function deleteLorebook(db: Database, id: number): void {
  db.query("DELETE FROM lorebooks WHERE id = $id").run({ id });
}

export function insertEntry(db: Database, lorebookId: number, content: string): LoreEntryRow {
  const now = Date.now();
  return db
    .query(
      `INSERT INTO lore_entries (ulid, lorebook_id, content, created_at, updated_at)
       VALUES ($ulid, $book, $content, $now, $now) RETURNING *`,
    )
    .get({ ulid: ulid(), book: lorebookId, content, now }) as LoreEntryRow;
}

/** Every column an entry editor can set, in one statement. */
export function updateEntry(
  db: Database,
  id: number,
  patch: Partial<Omit<LoreEntryRow, "id" | "ulid" | "lorebook_id" | "created_at" | "updated_at">>,
): LoreEntryRow {
  const current = db.query("SELECT * FROM lore_entries WHERE id = $id").get({ id }) as LoreEntryRow;
  const next = { ...current, ...patch };
  // §10: editing an entry clears its timed state, so a change takes effect now
  // rather than after the current sticky window runs out.
  clearTimedEffects(db, id);
  return db
    .query(
      `UPDATE lore_entries SET
         title = $title, content = $content, enabled = $enabled,
         keys = $keys, secondary_keys = $secondary_keys, secondary_logic = $secondary_logic,
         case_sensitive = $case_sensitive, match_whole_words = $match_whole_words,
         use_regex = $use_regex, probability = $probability, is_constant = $is_constant,
         scan_depth = $scan_depth, character_filter = $character_filter,
         sticky = $sticky, cooldown = $cooldown, delay = $delay, delay_from = $delay_from,
         inclusion_group = $inclusion_group, group_weight = $group_weight,
         group_selection = $group_selection, position = $position,
         insertion_order = $insertion_order, insertion_depth = $insertion_depth,
         insertion_role = $insertion_role, outlet_name = $outlet_name,
         recursion_level = $recursion_level, non_recursable = $non_recursable,
         prevent_further_recursion = $prevent_further_recursion,
         automation_id = $automation_id, updated_at = $now
       WHERE id = $id RETURNING *`,
    )
    .get({
      id,
      title: next.title,
      content: next.content,
      enabled: next.enabled,
      keys: next.keys,
      secondary_keys: next.secondary_keys,
      secondary_logic: next.secondary_logic,
      case_sensitive: next.case_sensitive,
      match_whole_words: next.match_whole_words,
      use_regex: next.use_regex,
      probability: next.probability,
      is_constant: next.is_constant,
      scan_depth: next.scan_depth,
      character_filter: next.character_filter,
      sticky: next.sticky,
      cooldown: next.cooldown,
      delay: next.delay,
      delay_from: next.delay_from,
      inclusion_group: next.inclusion_group,
      group_weight: next.group_weight,
      group_selection: next.group_selection,
      position: next.position,
      insertion_order: next.insertion_order,
      insertion_depth: next.insertion_depth,
      insertion_role: next.insertion_role,
      outlet_name: next.outlet_name,
      recursion_level: next.recursion_level,
      non_recursable: next.non_recursable,
      prevent_further_recursion: next.prevent_further_recursion,
      automation_id: next.automation_id,
      now: Date.now(),
    }) as LoreEntryRow;
}

export function deleteEntry(db: Database, id: number): void {
  db.query("DELETE FROM lore_entries WHERE id = $id").run({ id });
}

export function bind(
  db: Database,
  lorebookId: number,
  scope: LoreBindingScope,
  targetId: number | null,
): void {
  const columns = { scene: null as number | null, character: null as number | null, persona: null as number | null };
  if (scope === "scene") columns.scene = targetId;
  if (scope === "character") columns.character = targetId;
  if (scope === "persona") columns.persona = targetId;

  db.query(
    `INSERT INTO lorebook_bindings (lorebook_id, scope, scene_id, character_id, persona_id, created_at)
     VALUES ($book, $scope, $scene, $character, $persona, $now)`,
  ).run({
    book: lorebookId,
    scope,
    scene: columns.scene,
    character: columns.character,
    persona: columns.persona,
    now: Date.now(),
  });
}

export function unbind(db: Database, bindingId: number): void {
  db.query("DELETE FROM lorebook_bindings WHERE id = $id").run({ id: bindingId });
}

/* ------------------------------------------------------------------ */
/* Mappers                                                             */
/* ------------------------------------------------------------------ */

export function toEntryDto(row: LoreEntryRow, bookUlid: string): LoreEntryDto {
  const tokenizer = createEstimatingTokenizer();
  return {
    id: row.ulid,
    lorebookId: bookUlid,
    title: row.title,
    content: row.content,
    enabled: row.enabled === 1,
    tokenCount: tokenizer.count(row.content),
    keys: parseList(row.keys),
    secondaryKeys: parseList(row.secondary_keys),
    secondaryLogic: row.secondary_logic,
    caseSensitive: row.case_sensitive === 1,
    matchWholeWords: row.match_whole_words === 1,
    useRegex: row.use_regex === 1,
    probability: row.probability,
    isConstant: row.is_constant === 1,
    scanDepth: row.scan_depth,
    characterFilter: parseList(row.character_filter),
    sticky: row.sticky,
    cooldown: row.cooldown,
    delay: row.delay,
    delayFrom: row.delay_from,
    inclusionGroup: row.inclusion_group,
    groupWeight: row.group_weight,
    groupSelection: row.group_selection,
    position: row.position,
    insertionOrder: row.insertion_order,
    insertionDepth: row.insertion_depth,
    insertionRole: row.insertion_role,
    outletName: row.outlet_name,
    recursionLevel: row.recursion_level,
    nonRecursable: row.non_recursable === 1,
    preventFurtherRecursion: row.prevent_further_recursion === 1,
    automationId: row.automation_id,
    updatedAt: row.updated_at,
  };
}

export function toBookDto(db: Database, row: LorebookRow): LorebookDto {
  const count = db
    .query("SELECT COUNT(*) AS n FROM lore_entries WHERE lorebook_id = $book")
    .get({ book: row.id }) as { n: number };

  const bindings: LoreBindingDto[] = bindingsOf(db, row.id).map((binding) => {
    const target =
      binding.scope === "scene"
        ? nameOf(db, "scenes", "title", binding.scene_id)
        : binding.scope === "character"
          ? nameOf(db, "characters", "name", binding.character_id)
          : binding.scope === "persona"
            ? nameOf(db, "personas", "name", binding.persona_id)
            : null;
    return {
      id: String(binding.id),
      scope: binding.scope,
      targetId: target?.ulid ?? null,
      targetName: target?.name ?? null,
    };
  });

  return {
    id: row.ulid,
    name: row.name,
    description: row.description,
    tokenBudget: row.token_budget,
    scanDepth: row.scan_depth,
    recursionDepth: row.recursion_depth,
    entryCount: count.n,
    bindings,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function nameOf(
  db: Database,
  table: "scenes" | "characters" | "personas",
  column: "title" | "name",
  id: number | null,
): { ulid: string; name: string } | null {
  if (id === null) return null;
  const row = db
    .query(`SELECT ulid, ${column} AS name FROM ${table} WHERE id = $id`)
    .get({ id }) as { ulid: string; name: string } | null;
  return row ?? null;
}
