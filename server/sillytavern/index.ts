/**
 * Importing a SillyTavern install (SPEC §20 phase 44).
 *
 * The parsers next door are pure; this is the half that touches the database.
 * It takes a pile of files carrying their paths relative to SillyTavern's data
 * directory, works out what each one is, and applies them in the order their
 * dependencies demand — cards before the chats that cast them, everything
 * before nothing.
 *
 * Nothing here throws for a bad file. A real install is thousands of files and
 * will contain surprises; losing the other 1,999 to one of them is the failure
 * this is written to avoid. Every file gets a row in the report saying what
 * happened to it, which is the same add/skip shape a pack install and a bulk
 * card import already report.
 */
import { createHash } from "node:crypto";
import type { AppContext } from "../context.ts";
import type { MigrationItemDto, MigrationKind } from "../../shared/types.ts";
import { CardError, importCard } from "../cards/index.ts";
import { persistCard } from "../cards/persist.ts";
import { findByHash, type CharacterRow } from "../db/queries/characters.ts";
import {
  appendMessage,
  insertScene,
  setActiveLeaf,
  type SceneRow,
} from "../db/queries/history.ts";
import {
  addSceneMember,
  insertPersona,
  listPersonas,
  updatePersona,
} from "../db/queries/authors.ts";
import { insertCustomTemplate, listCustomTemplates } from "../db/queries/instruct.ts";
import { insertScript, listScripts } from "../db/queries/scripts.ts";
import {
  insertEntry,
  insertLorebook,
  listLorebooks,
  updateEntry,
  updateLorebook,
} from "../db/queries/lore.ts";
import { parseWorldInfo } from "../lore/import.ts";
import { ChatParseError, parseChat, titleFor, type ParsedChat, type SpeakerRef } from "./chat.ts";
import {
  CONTEXT_TEMPLATE_REFUSAL,
  isContextTemplate,
  parseInstruct,
  parsePersonas,
  parseRegex,
} from "./settings.ts";

/** One file, with the path it had inside the SillyTavern data directory. */
export interface IncomingFile {
  path: string;
  bytes: Uint8Array;
}

/* ------------------------------------------------------------------ */
/* Classifying a path                                                  */
/* ------------------------------------------------------------------ */

/**
 * What a file is, decided by where it sits.
 *
 * By path rather than by content, because SillyTavern's folders are the only
 * thing that distinguishes an instruct template from a context template from a
 * sampler preset — they are all bare JSON objects, and two of the three answer
 * to overlapping field names.
 */
export type FileKind =
  | "character"
  | "solo_chat"
  | "group_chat"
  | "group"
  | "settings"
  | "world"
  | "instruct"
  | "context"
  | "regex"
  | "ignored";

/** The path from the data root, lowercased, with any leading folder stripped. */
function normalise(path: string): string[] {
  const parts = path.split(/[\\/]/).filter((part) => part !== "" && part !== ".");
  // A folder picker roots the paths at whatever the reader chose, which may be
  // `default-user/` or the install directory above it. Drop leading segments
  // until one of SillyTavern's own folder names is in front.
  const known = new Set([
    "characters",
    "chats",
    "group chats",
    "groups",
    "worlds",
    "instruct",
    "context",
    "regex",
  ]);
  for (let index = 0; index < parts.length; index += 1) {
    if (known.has(parts[index]!.toLowerCase())) return parts.slice(index);
    if (parts[index]!.toLowerCase() === "settings.json") return parts.slice(index);
  }
  return parts;
}

export function classify(path: string): FileKind {
  const parts = normalise(path);
  const head = parts[0]?.toLowerCase() ?? "";
  const last = (parts.at(-1) ?? "").toLowerCase();

  if (last === "settings.json" && parts.length === 1) return "settings";
  if (head === "characters" && /\.(png|charx|json)$/.test(last)) return "character";
  if (head === "chats" && last.endsWith(".jsonl")) return "solo_chat";
  if (head === "group chats" && last.endsWith(".jsonl")) return "group_chat";
  if (head === "groups" && last.endsWith(".json")) return "group";
  if (head === "worlds" && last.endsWith(".json")) return "world";
  if (head === "instruct" && last.endsWith(".json")) return "instruct";
  if (head === "context" && last.endsWith(".json")) return "context";
  if (head === "regex" && last.endsWith(".json")) return "regex";
  return "ignored";
}

/** The character folder a solo chat sits in — the only reliable name it has. */
function soloSubject(path: string): string {
  const parts = normalise(path);
  return parts.length >= 3 ? parts[1]! : (parts.at(-1) ?? path);
}

/* ------------------------------------------------------------------ */
/* Matching SillyTavern's cards to ours                                */
/* ------------------------------------------------------------------ */

/**
 * A lookup from every name a SillyTavern chat might use to the row it means.
 *
 * SillyTavern references cards by avatar filename — `Seraphina.png` — which is
 * what `original_avatar` carries and what `characters.source_filename` holds
 * for anything imported from one. The display name is the fallback, and a poor
 * one: it is what a rename desynchronises.
 *
 * Built once per request. Per message this would be a query per turn on a file
 * that can hold two thousand of them.
 */
class CastIndex {
  private readonly byKey = new Map<string, CharacterRow>();

  constructor(rows: CharacterRow[]) {
    for (const row of rows) this.add(row);
  }

  add(row: CharacterRow): void {
    for (const key of CastIndex.keysFor(row)) {
      if (!this.byKey.has(key)) this.byKey.set(key, row);
    }
  }

  private static keysFor(row: CharacterRow): string[] {
    const keys = [row.name.toLowerCase()];
    if (row.source_filename !== null) {
      const file = row.source_filename.toLowerCase();
      keys.push(file, file.replace(/\.(png|charx|json)$/, ""));
    }
    return keys;
  }

  find(speaker: SpeakerRef): CharacterRow | null {
    const candidates = [
      speaker.avatar?.toLowerCase(),
      speaker.avatar?.toLowerCase().replace(/\.(png|charx|json)$/, ""),
      speaker.name.toLowerCase(),
    ];
    for (const key of candidates) {
      if (key === undefined || key === "") continue;
      const row = this.byKey.get(key);
      if (row !== undefined) return row;
    }
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Writing a chat into the tree                                        */
/* ------------------------------------------------------------------ */

function hashOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Lay a parsed chat into a scene as a tree.
 *
 * Each SillyTavern turn becomes one node per swipe, all siblings under the
 * previous turn's live node, and the next turn hangs off the live one. That is
 * the whole mapping: their linear-with-alternates is our tree, and the swipe
 * carousel walks the alternates without knowing they came from anywhere.
 *
 * The leaf is set once at the end, because `appendMessage` moves it to whatever
 * it just wrote and the last thing written is an alternate, not the turn the
 * reader left showing.
 */
function writeChat(ctx: AppContext, scene: SceneRow, chat: ParsedChat, cast: CastIndex): number {
  let parentId: number | null = null;
  let liveId: number | null = null;
  let written = 0;

  for (const turn of chat.turns) {
    let live: number | null = null;
    turn.versions.forEach((version, index) => {
      const character = version.speaker === null ? null : cast.find(version.speaker);
      const row = appendMessage(ctx.db, {
        sceneId: scene.id,
        parentId,
        kind: version.isUser ? "user" : "spotlight",
        authorType: version.isUser ? "user" : "character",
        content: version.content,
        characterId: character?.id ?? null,
        isHidden: version.isHidden,
        ...(version.reasoning === null ? {} : { reasoning: version.reasoning }),
      });
      written += 1;
      if (index === turn.liveIndex) live = row.id;
    });
    // A turn always writes at least one version, so `live` is set unless
    // `liveIndex` pointed outside the array — which the parser prevents.
    parentId = live;
    liveId = live;
  }

  if (liveId !== null) setActiveLeaf(ctx.db, scene.id, liveId, false);
  return written;
}

/* ------------------------------------------------------------------ */
/* The import                                                          */
/* ------------------------------------------------------------------ */

function item(
  kind: MigrationKind,
  name: string,
  path: string,
  action: "add" | "skip",
  detail: string,
): MigrationItemDto {
  return { kind, name, path, action, detail };
}

interface GroupDefinition {
  name: string;
  members: string[];
  disabled: Set<string>;
}

function readGroup(bytes: Uint8Array, path: string): GroupDefinition | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof parsed !== "object" || parsed === null) return null;
    const root = parsed as Record<string, unknown>;
    const members = Array.isArray(root["members"])
      ? root["members"].filter((v): v is string => typeof v === "string")
      : [];
    const disabled = Array.isArray(root["disabled_members"])
      ? root["disabled_members"].filter((v): v is string => typeof v === "string")
      : [];
    const name =
      typeof root["name"] === "string" && root["name"].trim() !== ""
        ? root["name"]
        : (path.split(/[\\/]/).at(-1) ?? "Group").replace(/\.json$/i, "");
    return { name, members, disabled: new Set(disabled.map((m) => m.toLowerCase())) };
  } catch {
    return null;
  }
}

export interface ImportResult {
  added: number;
  skipped: number;
  items: MigrationItemDto[];
}

/**
 * Import everything in one pass, in dependency order.
 *
 * Cards first, because a chat that cannot find its character is skipped and the
 * whole point is that it should be able to. Then the settings-shaped things,
 * which depend on nothing. Then chats, then groups — groups last because they
 * need both their cards and their definition file.
 */
export async function importSillyTavern(
  ctx: AppContext,
  files: IncomingFile[],
  existingCharacters: CharacterRow[],
): Promise<ImportResult> {
  const items: MigrationItemDto[] = [];
  const cast = new CastIndex(existingCharacters);
  const buckets = new Map<FileKind, IncomingFile[]>();
  for (const file of files) {
    const kind = classify(file.path);
    if (kind === "ignored") continue;
    buckets.set(kind, [...(buckets.get(kind) ?? []), file]);
  }
  const bucket = (kind: FileKind) => buckets.get(kind) ?? [];
  const text = (file: IncomingFile) => new TextDecoder().decode(file.bytes);
  const json = (file: IncomingFile): unknown => {
    try {
      return JSON.parse(text(file));
    } catch {
      return undefined;
    }
  };
  const basename = (path: string) => path.split(/[\\/]/).at(-1) ?? path;

  /* --- cards ---------------------------------------------------- */
  for (const file of bucket("character")) {
    const name = basename(file.path);
    let imported;
    try {
      imported = importCard(file.bytes, name);
    } catch (caught) {
      items.push(
        item("character", name, file.path, "skip",
          caught instanceof CardError ? caught.message : "Not a character card."),
      );
      continue;
    }
    const already = findByHash(ctx.db, imported.sourceHash);
    if (already !== null) {
      cast.add(already);
      items.push(item("character", already.name, file.path, "skip", "Already in the library."));
      continue;
    }
    const { row, warnings } = await persistCard(ctx, name, imported);
    cast.add(row);
    items.push(item("character", row.name, file.path, "add", warnings.join(" ")));
  }

  /* --- personas -------------------------------------------------- */
  for (const file of bucket("settings")) {
    const parsed = parsePersonas(json(file));
    if (parsed.length === 0) {
      items.push(item("persona", basename(file.path), file.path, "skip", "No personas in it."));
      continue;
    }
    const taken = new Set(listPersonas(ctx.db).map((row) => row.name.toLowerCase()));
    for (const persona of parsed) {
      if (taken.has(persona.name.toLowerCase())) {
        items.push(item("persona", persona.name, file.path, "skip", "Already here."));
        continue;
      }
      const row = insertPersona(ctx.db, persona.name);
      updatePersona(ctx.db, row.id, {
        ...(persona.description === null ? {} : { description: persona.description }),
      });
      taken.add(persona.name.toLowerCase());
      items.push(item("persona", persona.name, file.path, "add", ""));
    }
  }

  /* --- world info ------------------------------------------------ */
  const books = new Set(listLorebooks(ctx.db).map((row) => row.name.toLowerCase()));
  for (const file of bucket("world")) {
    const name = basename(file.path).replace(/\.json$/i, "");
    const parsed = parseWorldInfo(text(file), name);
    if (parsed === null) {
      items.push(item("lorebook", name, file.path, "skip", "Not a world info file."));
      continue;
    }
    if (books.has(parsed.name.toLowerCase())) {
      items.push(item("lorebook", parsed.name, file.path, "skip", "Already here."));
      continue;
    }
    books.add(parsed.name.toLowerCase());
    const book = insertLorebook(ctx.db, { name: parsed.name, rawImport: parsed.raw });
    updateLorebook(ctx.db, book.id, {
      ...(parsed.scanDepth === null ? {} : { scan_depth: parsed.scanDepth }),
      ...(parsed.tokenBudget === null ? {} : { token_budget: parsed.tokenBudget }),
      ...(parsed.recursionDepth === null ? {} : { recursion_depth: parsed.recursionDepth }),
    });
    for (const entry of parsed.entries) {
      const row = insertEntry(ctx.db, book.id, String(entry.columns.content ?? ""));
      updateEntry(ctx.db, row.id, entry.columns);
    }
    items.push(
      item("lorebook", parsed.name, file.path, "add", `${parsed.entries.length} entries.`),
    );
  }

  /* --- instruct templates ---------------------------------------- */
  const templates = new Set(listCustomTemplates(ctx.db).map((row) => row.name.toLowerCase()));
  for (const file of bucket("instruct")) {
    const name = basename(file.path).replace(/\.json$/i, "");
    const parsed = parseInstruct(json(file));
    if (parsed === null) {
      items.push(item("instruct", name, file.path, "skip", "Not an instruct template."));
      continue;
    }
    if (templates.has(parsed.template.name.toLowerCase())) {
      items.push(item("instruct", parsed.template.name, file.path, "skip", "Already here."));
      continue;
    }
    templates.add(parsed.template.name.toLowerCase());
    insertCustomTemplate(ctx.db, {
      name: parsed.template.name,
      template: { ...parsed.template, id: "" },
    });
    items.push(
      item("instruct", parsed.template.name, file.path, "add",
        parsed.dropped.length === 0
          ? ""
          : `Not carried over: ${parsed.dropped.join(", ")}.`),
    );
  }

  /* --- context templates: refused, by name ------------------------ */
  for (const file of bucket("context")) {
    const name = basename(file.path).replace(/\.json$/i, "");
    items.push(
      item("context", name, file.path, "skip",
        isContextTemplate(json(file))
          ? CONTEXT_TEMPLATE_REFUSAL
          : "Not a context template."),
    );
  }

  /* --- regex scripts ---------------------------------------------- */
  const scripts = new Set(listScripts(ctx.db).map((row) => row.name.toLowerCase()));
  for (const file of bucket("regex")) {
    const name = basename(file.path).replace(/\.json$/i, "");
    const parsed = parseRegex(json(file));
    if (parsed === null) {
      items.push(item("regex", name, file.path, "skip", "Not a regex script."));
      continue;
    }
    if (scripts.has(parsed.name.toLowerCase())) {
      items.push(item("regex", parsed.name, file.path, "skip", "Already here."));
      continue;
    }
    try {
      new RegExp(parsed.pattern, parsed.flags);
    } catch (caught) {
      // A pattern that will not compile is a script that does nothing on every
      // turn until somebody notices, which is why the table refuses one.
      items.push(
        item("regex", parsed.name, file.path, "skip",
          `The pattern will not compile: ${caught instanceof Error ? caught.message : "invalid"}.`),
      );
      continue;
    }
    scripts.add(parsed.name.toLowerCase());
    insertScript(ctx.db, {
      name: parsed.name,
      pattern: parsed.pattern,
      replacement: parsed.replacement,
      flags: parsed.flags,
      applyTo: parsed.applyTo,
      scope: "global",
      characterId: null,
      sceneId: null,
      enabled: parsed.enabled,
      runOrder: null,
    });
    items.push(
      item("regex", parsed.name, file.path, "add",
        parsed.dropped.length === 0 ? "" : `Not carried over: ${parsed.dropped.join(", ")}.`),
    );
  }

  /* --- chats ------------------------------------------------------ */
  const groups = new Map<string, GroupDefinition>();
  for (const file of bucket("group")) {
    const parsed = readGroup(file.bytes, file.path);
    if (parsed !== null) groups.set(parsed.name.toLowerCase(), parsed);
  }

  // Imported scenes carry the default profile and preset. A migrated library
  // where every scene's status bar says NO MODEL is a bad first minute, and the
  // reader has already chosen a default by the time they get here — the setup
  // wizard made them.
  const defaultProfile = ctx.db
    .query("SELECT id FROM connection_profiles ORDER BY is_default DESC, id LIMIT 1")
    .get() as { id: number } | null;
  const defaultPreset = ctx.db
    .query("SELECT id FROM presets WHERE is_default = 1 LIMIT 1")
    .get() as { id: number } | null;

  const chatFiles = [
    ...bucket("solo_chat").map((file) => ({ file, group: false })),
    ...bucket("group_chat").map((file) => ({ file, group: true })),
  ];

  for (const { file, group } of chatFiles) {
    const kind: MigrationKind = group ? "group_chat" : "chat";
    const subject = group
      ? basename(file.path).replace(/\.jsonl$/i, "")
      : soloSubject(file.path);
    const label = titleFor(subject, file.path);

    const hash = hashOf(file.bytes);
    const seen = ctx.db
      .query("SELECT title FROM scenes WHERE import_hash = $hash")
      .get({ hash }) as { title: string } | null;
    if (seen !== null) {
      items.push(item(kind, seen.title, file.path, "skip", "Already imported."));
      continue;
    }

    let chat: ParsedChat;
    try {
      chat = parseChat(text(file));
    } catch (caught) {
      items.push(
        item(kind, label, file.path, "skip",
          caught instanceof ChatParseError ? caught.message : "Could not be read."),
      );
      continue;
    }

    // Who is in it. A solo chat's folder names the character even when every
    // message's `name` has been renamed since; a group's members come from its
    // definition where there is one, and from the log itself where there is not.
    const definition = group ? groups.get(subject.toLowerCase()) : undefined;
    const wanted: SpeakerRef[] = group
      ? (definition?.members ?? []).map((avatar) => ({ avatar, name: avatar }))
      : [{ avatar: null, name: subject }];
    const speakers = wanted.length > 0 ? wanted : chat.speakers;

    const members: CharacterRow[] = [];
    const missing: string[] = [];
    for (const speaker of [...speakers, ...chat.speakers]) {
      const row = cast.find(speaker);
      if (row === null) {
        const shown = speaker.avatar ?? speaker.name;
        if (!missing.includes(shown)) missing.push(shown);
      } else if (!members.some((existing) => existing.id === row.id)) {
        members.push(row);
      }
    }

    if (members.length === 0) {
      items.push(
        item(
          kind,
          label,
          file.path,
          "skip",
          `No card here matches ${missing.join(", ") || subject}. ` +
            "Import the characters first, then run this again.",
        ),
      );
      continue;
    }

    const scene = insertScene(ctx.db, {
      title: label,
      ...(defaultProfile === null ? {} : { connectionProfileId: defaultProfile.id }),
      ...(defaultPreset === null ? {} : { presetId: defaultPreset.id }),
    });
    ctx.db
      .query("UPDATE scenes SET import_source = $path, import_hash = $hash WHERE id = $id")
      .run({ id: scene.id, path: file.path, hash });
    for (const member of members) addSceneMember(ctx.db, scene.id, member.id);

    const written = writeChat(ctx, scene, chat, cast);
    const notes = [`${chat.turns.length} turns, ${written} versions.`];
    if (missing.length > 0) notes.push(`No card for ${missing.join(", ")}.`);
    notes.push(...chat.warnings);
    items.push(item(kind, label, file.path, "add", notes.join(" ")));
  }

  return {
    added: items.filter((entry) => entry.action === "add").length,
    skipped: items.filter((entry) => entry.action === "skip").length,
    items,
  };
}
