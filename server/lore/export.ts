import type { LoreEntryRow, LorebookRow } from "../db/queries/lore.ts";

/**
 * Writing SillyTavern world info (SPEC §10 interop).
 *
 * §10 asks for import *and* export, and to "round-trip unknown fields". Only
 * the import half existed. This is the other half, and the round-trip is the
 * whole point of it: an entry imported from a file keeps that file's original
 * object in `raw_entry`, so export starts from what arrived and writes this
 * app's fields over the top.
 *
 * That ordering matters. Starting from our own columns and adding the unknown
 * fields back would silently drop anything SillyTavern gained since the import
 * — which is exactly the "lossy parsing is the most common migration
 * complaint" failure §9 names about character cards.
 */

/** The enum SillyTavern stores, which is an ordering rather than a name. */
const POSITION_NUMBERS: Record<LoreEntryRow["position"], number> = {
  before_character: 0,
  after_character: 1,
  before_examples: 2,
  after_examples: 3,
  at_depth: 4,
  // Neither of these is a SillyTavern position. `before_history` is its
  // default shape, and an outlet is addressed by name rather than placed at
  // all, so both land on 0 and keep their real value in the extension block
  // below rather than being written as a position that means something else.
  before_history: 0,
  outlet: 0,
};

const LOGIC_NUMBERS: Record<LoreEntryRow["secondary_logic"], number> = {
  and_any: 0,
  not_all: 1,
  not_any: 2,
  and_all: 3,
};

const ROLE_NUMBERS: Record<LoreEntryRow["insertion_role"], number> = {
  system: 0,
  user: 1,
  assistant: 2,
};

function parseList(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function originalOf(row: LoreEntryRow): Record<string, unknown> {
  if (row.raw_entry === null) return {};
  try {
    const parsed: unknown = JSON.parse(row.raw_entry);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? { ...(parsed as Record<string, unknown>) }
      : {};
  } catch {
    return {};
  }
}

/**
 * One entry, in the shape SillyTavern reads.
 *
 * `uid` and `displayIndex` are positional rather than meaningful — SillyTavern
 * keys entries by index — so they are written from the position in this export
 * rather than carried from an import that may have had different neighbours.
 */
export function toWorldInfoEntry(row: LoreEntryRow, index: number): Record<string, unknown> {
  const original = originalOf(row);
  return {
    ...original,
    uid: index,
    displayIndex: index,
    key: parseList(row.keys),
    keysecondary: parseList(row.secondary_keys),
    comment: row.title,
    content: row.content,
    constant: row.is_constant === 1,
    // SillyTavern's flag is the inverse of ours, and writing `enabled` instead
    // would leave every entry switched on when read back.
    disable: row.enabled === 0,
    selectiveLogic: LOGIC_NUMBERS[row.secondary_logic],
    // `selective` means "has secondary keys at all" over there.
    selective: parseList(row.secondary_keys).length > 0,
    caseSensitive: row.case_sensitive === 1,
    matchWholeWords: row.match_whole_words === 1,
    useRegex: row.use_regex === 1,
    probability: row.probability,
    useProbability: row.probability < 100,
    scanDepth: row.scan_depth,
    sticky: row.sticky,
    cooldown: row.cooldown,
    delay: row.delay,
    group: row.inclusion_group ?? "",
    groupWeight: row.group_weight,
    groupOverride: row.group_selection === "prioritize",
    position: POSITION_NUMBERS[row.position],
    order: row.insertion_order,
    depth: row.insertion_depth,
    role: ROLE_NUMBERS[row.insertion_role],
    automationId: row.automation_id ?? "",
    excludeRecursion: row.non_recursable === 1,
    preventRecursion: row.prevent_further_recursion === 1,
    delayUntilRecursion: row.recursion_level,
    /**
     * What this app has and SillyTavern does not.
     *
     * Under a namespaced key rather than at the top level: an unknown field
     * SillyTavern ignores is fine, but one that collides with a name it later
     * gives to something else is a file that reads as configured wrongly. Read
     * back on import by the same names it stores.
     */
    onsen: {
      position: row.position,
      outlet_name: row.outlet_name,
      group_selection: row.group_selection,
    },
  };
}

export interface WorldInfoFile {
  name: string;
  entries: Record<string, Record<string, unknown>>;
}

/**
 * A whole book.
 *
 * Entries are an object keyed by index, which is the shape SillyTavern writes
 * and the one its importer is happiest with — the reader here already accepts
 * both that and a bare array.
 */
export function toWorldInfo(book: LorebookRow, rows: LoreEntryRow[]): WorldInfoFile {
  const entries: Record<string, Record<string, unknown>> = {};
  rows.forEach((row, index) => {
    entries[String(index)] = toWorldInfoEntry(row, index);
  });
  return { name: book.name, entries };
}
