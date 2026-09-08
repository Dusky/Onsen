import type { LoreEntryRow } from "../db/queries/lore.ts";

/**
 * Importing SillyTavern world info (SPEC §10 interop).
 *
 * The rule that matters is the one `characters.raw_card` already follows:
 * **store the original and re-emit from it.** RisuAI and Agnai both silently
 * drop advanced lorebook fields on import, and that is the migration failure
 * this ecosystem has over and over. Every entry keeps its source object, so an
 * export carries fields this app has never heard of.
 *
 * The shape is loose on purpose. SillyTavern has changed these field names
 * several times and other tools export near-misses of them, so each field is
 * read from a list of the names it has been known by, and anything unreadable
 * falls back to the schema default rather than failing the import.
 */

export interface ImportedEntry {
  columns: Partial<Omit<LoreEntryRow, "id" | "ulid" | "lorebook_id" | "created_at" | "updated_at">>;
  raw: unknown;
}

export interface ImportedBook {
  name: string;
  scanDepth: number | null;
  recursionDepth: number | null;
  tokenBudget: number | null;
  entries: ImportedEntry[];
  raw: string;
}

function pick(source: Record<string, unknown>, names: string[]): unknown {
  for (const name of names) {
    if (source[name] !== undefined && source[name] !== null) return source[name];
  }
  return undefined;
}

function asStrings(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  // Some exports keep keys as one comma-separated string.
  if (typeof value === "string") {
    return value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "");
  }
  return [];
}

function asInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** SillyTavern's numeric position enum, which is its own ordering rather than a name. */
function positionOf(source: Record<string, unknown>): LoreEntryRow["position"] {
  const named = pick(source, ["position"]);
  if (typeof named === "string") {
    const known: Record<string, LoreEntryRow["position"]> = {
      before_char: "before_character",
      after_char: "after_character",
      before_character: "before_character",
      after_character: "after_character",
      before_example: "before_examples",
      after_example: "after_examples",
      before_examples: "before_examples",
      after_examples: "after_examples",
      before_history: "before_history",
      at_depth: "at_depth",
      outlet: "outlet",
    };
    if (named in known) return known[named]!;
  }
  if (typeof named === "number") {
    // 0/1 before/after character, 2/3 before/after examples, 4 at depth.
    return (
      ([
        "before_character",
        "after_character",
        "before_examples",
        "after_examples",
        "at_depth",
      ] as const)[named] ?? "before_history"
    );
  }
  return "before_history";
}

/** The character filter, from SillyTavern's one-object shape or its flat editor fields. */
function characterFilterOf(source: Record<string, unknown>): {
  names: string[];
  tags: string[];
  exclude: boolean;
} {
  const obj = source["characterFilter"];
  if (typeof obj === "object" && obj !== null) {
    const o = obj as Record<string, unknown>;
    return {
      names: asStrings(o["names"]),
      tags: asStrings(o["tags"]),
      exclude: asBool(o["isExclude"], false),
    };
  }
  return {
    names: asStrings(source["characterFilterNames"]),
    tags: asStrings(source["characterFilterTags"]),
    exclude: asBool(source["characterFilterExclude"], false),
  };
}

/** The card fields an entry matches against, from Onsen's array or ST's booleans. */
function matchAgainstOf(source: Record<string, unknown>): string[] {
  const onsen = (source["onsen"] ?? {}) as Record<string, unknown>;
  const arr = onsen["match_against"];
  if (Array.isArray(arr)) return arr.filter((item): item is string => typeof item === "string");
  const exts = (source["extensions"] ?? {}) as Record<string, unknown>;
  const pairs: [string, string][] = [
    ["persona_description", "match_persona_description"],
    ["character_description", "match_character_description"],
    ["character_personality", "match_character_personality"],
    ["character_depth_prompt", "match_character_depth_prompt"],
    ["scenario", "match_scenario"],
    ["creator_notes", "match_creator_notes"],
  ];
  return pairs.filter(([, key]) => exts[key] === true).map(([field]) => field);
}

function logicOf(source: Record<string, unknown>): LoreEntryRow["secondary_logic"] {
  const value = pick(source, ["selectiveLogic", "secondary_logic"]);
  if (typeof value === "string") {
    const known = ["and_any", "and_all", "not_any", "not_all"] as const;
    if ((known as readonly string[]).includes(value)) return value as LoreEntryRow["secondary_logic"];
  }
  // SillyTavern's enum: 0 AND ANY, 1 NOT ALL, 2 NOT ANY, 3 AND ALL.
  if (typeof value === "number") {
    return (["and_any", "not_all", "not_any", "and_all"] as const)[value] ?? "and_any";
  }
  return "and_any";
}

function entryFrom(source: Record<string, unknown>): ImportedEntry {
  const keys = asStrings(pick(source, ["key", "keys"]));
  const secondary = asStrings(pick(source, ["keysecondary", "secondary_keys", "secondaryKeys"]));
  const position = positionOf(source);

  return {
    raw: source,
    columns: {
      title: String(pick(source, ["comment", "title", "name"]) ?? ""),
      content: String(pick(source, ["content", "entry", "text"]) ?? ""),
      enabled: asBool(pick(source, ["enabled"]), pick(source, ["disable"]) !== true) ? 1 : 0,
      keys: JSON.stringify(keys),
      secondary_keys: JSON.stringify(secondary),
      secondary_logic: logicOf(source),
      case_sensitive: asBool(pick(source, ["caseSensitive", "case_sensitive"]), false) ? 1 : 0,
      match_whole_words: asBool(pick(source, ["matchWholeWords", "match_whole_words"]), true) ? 1 : 0,
      use_regex: asBool(pick(source, ["useRegex", "use_regex"]), false) ? 1 : 0,
      probability: Math.max(0, Math.min(100, asInt(pick(source, ["probability"]), 100))),
      is_constant: asBool(pick(source, ["constant", "is_constant"]), false) ? 1 : 0,
      scan_depth:
        typeof pick(source, ["scanDepth", "scan_depth"]) === "number"
          ? asInt(pick(source, ["scanDepth", "scan_depth"]), 4)
          : null,
      // The character filter: SillyTavern persists one object; the flat fields
      // are its editor's shape. Both are read (§20 phase 126).
      character_filter: JSON.stringify(characterFilterOf(source).names),
      character_filter_tags: JSON.stringify(characterFilterOf(source).tags),
      character_filter_exclude: characterFilterOf(source).exclude ? 1 : 0,
      sticky: Math.max(0, asInt(pick(source, ["sticky"]), 0)),
      cooldown: Math.max(0, asInt(pick(source, ["cooldown"]), 0)),
      delay: Math.max(0, asInt(pick(source, ["delay"]), 0)),
      inclusion_group: (() => {
        const group = pick(source, ["group", "inclusion_group"]);
        return typeof group === "string" && group.trim() !== "" ? group.trim() : null;
      })(),
      group_weight: Math.max(0, asInt(pick(source, ["groupWeight", "group_weight"]), 100)),
      group_selection: (() => {
        const onsen = (source["onsen"] ?? {}) as Record<string, unknown>;
        const mode = onsen["group_selection"] ?? source["groupSelection"];
        return mode === "score" || mode === "prioritize" ? mode : "weight";
      })(),
      ignore_budget: asBool(pick(source, ["ignoreBudget"]), false) ? 1 : 0,
      use_probability: asBool(pick(source, ["useProbability"]), true) ? 1 : 0,
      group_override: asBool(pick(source, ["groupOverride"]), false) ? 1 : 0,
      delay_until_recursion: Math.max(
        0,
        asInt(pick(source, ["delayUntilRecursion", "delay_until_recursion"]), 0),
      ),
      triggers: JSON.stringify(asStrings(pick(source, ["triggers"]))),
      match_against: JSON.stringify(matchAgainstOf(source)),
      vectorized: asBool((source["extensions"] as Record<string, unknown> | undefined)?.["vectorized"], false) ? 1 : 0,
      position,
      insertion_order: asInt(pick(source, ["order", "insertion_order", "insertionOrder"]), 100),
      insertion_depth: Math.max(0, asInt(pick(source, ["depth", "insertion_depth"]), 4)),
      insertion_role: (() => {
        const role = pick(source, ["role"]);
        if (role === 1 || role === "user") return "user" as const;
        if (role === 2 || role === "assistant") return "assistant" as const;
        return "system" as const;
      })(),
      // §10's automation ids, kept even though nothing dispatches on them yet:
      // dropping one would break the round-trip this whole module is for.
      automation_id: (() => {
        const id = pick(source, ["automationId", "automation_id"]);
        return typeof id === "string" && id.trim() !== "" ? id.trim() : null;
      })(),
      non_recursable: asBool(pick(source, ["excludeRecursion", "non_recursable"]), false) ? 1 : 0,
      prevent_further_recursion: asBool(
        pick(source, ["preventRecursion", "prevent_further_recursion"]),
        false,
      )
        ? 1
        : 0,
      recursion_level: Math.max(
        0,
        asInt(
          pick(source, ["recursion_level"]),
          asInt((source["onsen"] as Record<string, unknown> | undefined)?.["recursion_level"] ?? 0, 0),
        ),
      ),
      raw_entry: JSON.stringify(source),
    },
  };
}

/**
 * Read a world-info file. Returns null when it is not one, rather than throwing:
 * a bad file is a message to the user, not a stack trace.
 */
export function parseWorldInfo(text: string, fallbackName: string): ImportedBook | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const source = parsed as Record<string, unknown>;

  // SillyTavern keeps entries as an object keyed by index; some exports use an
  // array. Both are ordinary here.
  const rawEntries = source["entries"];
  const list: Record<string, unknown>[] = Array.isArray(rawEntries)
    ? rawEntries.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    : typeof rawEntries === "object" && rawEntries !== null
      ? Object.values(rawEntries).filter(
          (item): item is Record<string, unknown> => typeof item === "object" && item !== null,
        )
      : [];
  if (list.length === 0) return null;

  const settings = (source["settings"] ?? {}) as Record<string, unknown>;
  const scan = pick(source, ["scan_depth", "scanDepth"]) ?? pick(settings, ["scan_depth", "scanDepth"]);
  const budget = pick(source, ["token_budget", "budget"]) ?? pick(settings, ["token_budget", "budget"]);
  const recursion = pick(source, ["recursion_depth"]) ?? pick(settings, ["recursion_depth"]);

  return {
    name: String(pick(source, ["name"]) ?? fallbackName),
    scanDepth: typeof scan === "number" ? Math.max(0, Math.trunc(scan)) : null,
    tokenBudget: typeof budget === "number" ? Math.max(0, Math.trunc(budget)) : null,
    recursionDepth: typeof recursion === "number" ? Math.max(0, Math.trunc(recursion)) : null,
    entries: list.map(entryFrom),
    raw: text,
  };
}

/**
 * The world-info book a character card carries embedded (`character_book`),
 * parsed into the same shape a file import produces (§20 phase 139). A card
 * without one, or with one that does not parse, returns null.
 */
export function embeddedCharacterBook(rawCard: string): ImportedBook | null {
  try {
    const parsed = JSON.parse(rawCard) as { data?: { character_book?: unknown } };
    const book = parsed.data?.character_book;
    if (book === undefined || book === null) return null;
    return parseWorldInfo(JSON.stringify(book), "Lore");
  } catch {
    return null;
  }
}
