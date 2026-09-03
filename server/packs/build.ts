import type { Database } from "bun:sqlite";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { listEntries, findLorebook } from "../db/queries/lore.ts";
import { listGroups, listOptions, listBans } from "../db/queries/options.ts";
import { listScripts } from "../db/queries/scripts.ts";
import { listTriggers } from "../db/queries/triggers.ts";
import { exportCard } from "../cards/index.ts";
import { toNormalisedCard, type CharacterRow } from "../db/queries/characters.ts";
import { safeName, writePack, type PackDraft } from "./archive.ts";
import type { PackKind, PackManifest } from "./manifest.ts";

/**
 * Building a pack out of what is already installed (SPEC §15 tier 2).
 *
 * The shapes written here are the shapes `install.ts` reads. They are the app's
 * own export shapes rather than a second format invented for packs — §15's
 * claim is that "all of it is data, all of it exports as JSON", and a pack
 * format that disagreed with the single-entity exports would make that two
 * claims instead of one.
 */

export interface PackSelection {
  characters: string[];
  lorebooks: string[];
  presets: string[];
  authors: string[];
  options: string[];
  regex: string[];
  triggers: string[];
  /** The global ban list travels whole or not at all: it is one list. */
  banlist: boolean;
}

export function emptySelection(): PackSelection {
  return {
    characters: [],
    lorebooks: [],
    presets: [],
    authors: [],
    options: [],
    regex: [],
    triggers: [],
    banlist: false,
  };
}

interface Documents {
  [kind: string]: { name: string; value: unknown }[];
}

function emptyDocuments(): Record<PackKind, { name: string; value: unknown }[]> {
  return {
    characters: [],
    lorebooks: [],
    presets: [],
    authors: [],
    options: [],
    regex: [],
    triggers: [],
    banlists: [],
  };
}

/** Names are unique inside a directory, since one file overwrites another. */
function namer() {
  const used = new Map<string, number>();
  return (raw: string, fallback: string): string => {
    const base = safeName(raw, fallback);
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    return seen === 0 ? base : `${base}-${seen + 1}`;
  };
}

export async function buildPack(
  db: Database,
  options: { manifest: PackManifest; selection: PackSelection; avatarsDir: string },
): Promise<Uint8Array> {
  const documents = emptyDocuments();
  const assets = new Map<string, Uint8Array>();
  const { selection } = options;

  // Characters travel as cards, written by the same exporter the library's own
  // download button uses - so a pack's character is a file the user could have
  // downloaded on its own, and one SillyTavern would accept.
  //
  // A PNG where there is an avatar, JSON where there is not. The PNG *is* the
  // avatar: that is the whole convention behind the format, and carrying the
  // picture separately would mean inventing a link between two files where the
  // format already has one.
  const characterName = namer();
  for (const id of selection.characters) {
    const row = db.query("SELECT * FROM characters WHERE ulid = $ulid").get({ ulid: id }) as
      | CharacterRow
      | null;
    if (row === null) continue;

    const avatar =
      row.avatar_path === null
        ? null
        : await readQuietly(join(options.avatarsDir, row.avatar_path));
    const exported = exportCard(
      { card: toNormalisedCard(row), rawCard: row.raw_card, avatar, assets: new Map() },
      avatar === null ? "json" : "png",
    );
    const file = characterName(row.name, `character-${row.id}`);
    const extension = avatar === null ? "json" : "png";
    assets.set(`characters/${file}.${extension}`, exported.bytes);
  }

  const bookName = namer();
  for (const id of selection.lorebooks) {
    const book = findLorebook(db, id);
    if (book === null) continue;
    documents.lorebooks.push({
      name: bookName(book.name, `lorebook-${book.id}`),
      value: {
        name: book.name,
        description: book.description ?? "",
        entries: listEntries(db, book.id).map(entryDocument),
      },
    });
  }

  const presetName = namer();
  for (const id of selection.presets) {
    const row = db.query("SELECT * FROM presets WHERE ulid = $ulid").get({ ulid: id }) as
      | {
          id: number;
          name: string;
          sampler_settings: string;
          context_size: number;
          max_response_tokens: number;
        }
      | null;
    if (row === null) continue;
    documents.presets.push({
      name: presetName(row.name, `preset-${row.id}`),
      value: {
        name: row.name,
        samplerSettings: JSON.parse(row.sampler_settings) as unknown,
        contextSize: row.context_size,
        maxResponseTokens: row.max_response_tokens,
      },
    });
  }

  const authorName = namer();
  for (const id of selection.authors) {
    const row = db.query("SELECT * FROM authors WHERE ulid = $ulid").get({ ulid: id }) as
      | Record<string, unknown>
      | null;
    if (row === null) continue;
    documents.authors.push({
      name: authorName(String(row["name"] ?? ""), `author-${String(row["id"])}`),
      value: {
        name: row["name"],
        personality: row["personality"] ?? "",
        writingStyle: row["writing_style"] ?? "",
        directingStyle: row["directing_style"] ?? "",
        oocVoice: row["ooc_voice"] ?? "",
        boundaries: row["boundaries"] ?? "",
      },
    });
  }

  const groupName = namer();
  for (const group of listGroups(db)) {
    if (!selection.options.includes(group.ulid)) continue;
    documents.options.push({
      name: groupName(group.name, `options-${group.id}`),
      value: {
        name: group.name,
        description: group.description,
        cardinality: group.cardinality,
        sortOrder: group.sort_order,
        options: listOptions(db, group.id).map((option) => ({
          key: option.key,
          name: option.name,
          fragment: option.fragment,
          position: option.position,
          depth: option.depth,
          outletName: option.outlet_name,
          role: option.role,
          sortOrder: option.sort_order,
        })),
      },
    });
  }

  const allScripts = listScripts(db);
  const scriptName = namer();
  for (const script of allScripts) {
    if (!selection.regex.includes(script.id)) continue;
    documents.regex.push({
      name: scriptName(script.name, `script-${script.id}`),
      value: {
        name: script.name,
        pattern: script.pattern,
        replacement: script.replacement,
        flags: script.flags,
        applyTo: script.applyTo,
        enabled: script.enabled,
      },
    });
  }

  const byId = new Map(allScripts.map((script) => [script.id, script.name]));
  const triggerName = namer();
  for (const trigger of listTriggers(db)) {
    if (!selection.triggers.includes(trigger.id)) continue;
    documents.triggers.push({
      name: triggerName(trigger.name, `trigger-${trigger.id}`),
      value: {
        name: trigger.name,
        event: trigger.event,
        action: trigger.action,
        actionRef: trigger.actionRef,
        // A script's id means nothing in another install, so the name travels
        // beside it and the installer rebinds by that.
        actionRefName: trigger.action === "script" ? (byId.get(trigger.actionRef) ?? null) : null,
        automationId: trigger.automationId,
        enabled: trigger.enabled,
      },
    });
  }

  if (selection.banlist) {
    const phrases = listBans(db, null)
      .filter((row) => row.origin !== "proposed")
      .map((row) => row.phrase);
    if (phrases.length > 0) {
      documents.banlists.push({ name: "banlist", value: { name: "Ban list", phrases } });
    }
  }

  return writePack({ manifest: options.manifest, documents, assets });
}

function entryDocument(row: {
  title: string;
  content: string;
  enabled: number;
  keys: string;
  secondary_keys: string;
  secondary_logic: string;
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
  delay_from: string;
  inclusion_group: string | null;
  group_weight: number;
  group_selection: string;
  position: string;
  insertion_order: number;
  insertion_depth: number;
  insertion_role: string;
  outlet_name: string | null;
  recursion_level: number;
  non_recursable: number;
  prevent_further_recursion: number;
  automation_id: string | null;
}): Record<string, unknown> {
  const list = (value: string): unknown => {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  return {
    title: row.title,
    content: row.content,
    enabled: row.enabled === 1,
    keys: list(row.keys),
    secondaryKeys: list(row.secondary_keys),
    secondaryLogic: row.secondary_logic,
    caseSensitive: row.case_sensitive === 1,
    matchWholeWords: row.match_whole_words === 1,
    useRegex: row.use_regex === 1,
    probability: row.probability,
    isConstant: row.is_constant === 1,
    scanDepth: row.scan_depth,
    characterFilter: list(row.character_filter),
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
  };
}

/** A missing avatar is a pack without a picture, not a failed export. */
async function readQuietly(path: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(path));
  } catch {
    return null;
  }
}
