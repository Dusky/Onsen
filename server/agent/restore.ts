/**
 * Walking back what the agent did (SPEC §20 phase 219).
 *
 * `snapshot.ts` is the recording half and this is the restoring half, and until
 * phase 219 the second one knew two of the nineteen changes the first could
 * record. Its own doc comment said "the write tools record a snapshot before
 * they touch anything", which was true of two tools — the rest overwrote an
 * author, emptied a lorebook or recast a scene with nothing kept, while the
 * assistant's screen told the reader every change was listed under Undo.
 *
 * One `switch` over `UndoKind`, exhaustive: adding a kind without a restore for
 * it does not typecheck, which is the cheapest possible version of this rule.
 *
 * What a restore is honest about: it puts back the state the snapshot carries
 * and nothing else. A re-created character comes back without its picture or
 * its book bindings, and says so, because inventing them would be worse than
 * naming what is missing. Every return value carries that note when there is
 * one.
 *
 * Restores are not themselves snapshotted. An undo of an undo is the original
 * state, which is already in the list until it is used, and recording one would
 * make the list grow on the operation that is supposed to shrink it.
 */
import type { AppContext } from "../context.ts";
import type { Snapshot } from "./snapshot.ts";
import type { CharacterDto, LoreEntryDto, ThemeDto } from "../../shared/types.ts";
import { findCharacter, insertCharacter, updateCharacter } from "../db/queries/characters.ts";
import { buildCardDocument, type NormalisedCard } from "../cards/index.ts";
import {
  deleteScene,
  deleteMessage,
  findMessage,
  findScene,
  updateScene,
} from "../db/queries/history.ts";
import {
  addSceneMember,
  findAuthor,
  findPersona,
  listPersonas,
  removeSceneMember,
  setTurnStrategy,
  updateAuthor,
  updatePersona,
  deletePersona,
} from "../db/queries/authors.ts";
import {
  deleteEntry,
  deleteLorebook,
  findEntry,
  findLorebook,
  insertEntry,
  listLorebooks,
  updateEntry,
} from "../db/queries/lore.ts";
import {
  addGroupMember,
  deleteCharacterGroup,
  findCharacterGroup,
  removeGroupMember,
} from "../db/queries/groups.ts";
import {
  activeTheme,
  deleteTheme,
  findTheme,
  setActiveTheme,
  updateTheme,
} from "../db/queries/themes.ts";

/** What the undo did, for the response and for the notice the client shows. */
export type Restored = Record<string, unknown>;

/**
 * Put one snapshot back.
 *
 * Every branch is idempotent about the thing already being in the state asked
 * for — a character that is back in the library, a membership already removed —
 * because a reader who taps twice should get a note rather than an error.
 */
export function restoreSnapshot(ctx: AppContext, snapshot: Snapshot): Restored {
  const before: unknown = JSON.parse(snapshot.before);
  const named = before as { name?: unknown };
  const name = typeof named.name === "string" ? named.name : "something";

  switch (snapshot.kind) {
    case "character":
      return restoreCharacterFields(ctx, before as CharacterDto);
    case "character.deleted":
      return reinsertCharacter(ctx, before as CharacterDto);

    case "scene.created": {
      const scene = findScene(ctx.db, snapshot.subjectId);
      if (scene === null) return { kind: "roleplay", name, note: "Already gone." };
      deleteScene(ctx.db, scene.id);
      return { kind: "roleplay", name, note: "Deleted again, with its cast." };
    }
    case "scene": {
      const scene = findScene(ctx.db, snapshot.subjectId);
      if (scene === null) return { kind: "roleplay", name, note: "That roleplay is gone." };
      const was = before as {
        title?: string;
        scenarioOverride?: string | null;
        turnStrategy?: string;
      };
      updateScene(ctx.db, scene.id, {
        ...(was.title === undefined ? {} : { title: was.title }),
        scenarioOverride: was.scenarioOverride ?? null,
      });
      if (was.turnStrategy !== undefined) setTurnStrategy(ctx.db, scene.id, was.turnStrategy);
      return { kind: "roleplay", id: scene.ulid, name };
    }
    case "scene.note": {
      const message = findMessage(ctx.db, snapshot.subjectId);
      if (message === null) return { kind: "note", name, note: "Already gone." };
      deleteMessage(ctx.db, message);
      return { kind: "note", name, note: "Removed." };
    }

    case "lorebook.created": {
      const book = findLorebook(ctx.db, snapshot.subjectId);
      if (book === null) return { kind: "lorebook", name, note: "Already gone." };
      deleteLorebook(ctx.db, book.id);
      return { kind: "lorebook", name, note: "Deleted again, with its entries." };
    }
    case "lore_entry.created": {
      const entry = findEntry(ctx.db, snapshot.subjectId);
      if (entry === null) return { kind: "lore entry", name, note: "Already gone." };
      deleteEntry(ctx.db, entry.id);
      return { kind: "lore entry", name, note: "Removed." };
    }
    case "lore_entry":
      return restoreEntryFields(ctx, before as LoreEntryDto, name);
    case "lore_entry.deleted":
      return reinsertEntry(ctx, before as LoreEntryDto, name);

    case "persona.created": {
      const persona = findPersona(ctx.db, snapshot.subjectId);
      if (persona === null) return { kind: "persona", name, note: "Already gone." };
      deletePersona(ctx.db, persona.id);
      return { kind: "persona", name, note: "Removed." };
    }
    case "persona": {
      const persona = listPersonas(ctx.db).find((row) => row.ulid === snapshot.subjectId);
      if (persona === undefined) return { kind: "persona", name, note: "That persona is gone." };
      const was = before as { name?: string; description?: string | null; depth?: number | null };
      updatePersona(ctx.db, persona.id, {
        ...(was.name === undefined ? {} : { name: was.name }),
        description: was.description ?? null,
        depth: was.depth ?? null,
      });
      return { kind: "persona", id: persona.ulid, name };
    }

    case "author": {
      const author = findAuthor(ctx.db, snapshot.subjectId);
      if (author === null) return { kind: "author", name, note: "That author is gone." };
      const was = before as {
        name?: string;
        personality?: string | null;
        writingStyle?: string | null;
        directingStyle?: string | null;
        oocVoice?: string | null;
        boundaries?: string | null;
      };
      updateAuthor(ctx.db, author.id, {
        ...(was.name === undefined ? {} : { name: was.name }),
        personality: was.personality ?? null,
        writingStyle: was.writingStyle ?? null,
        directingStyle: was.directingStyle ?? null,
        oocVoice: was.oocVoice ?? null,
        boundaries: was.boundaries ?? null,
      });
      return { kind: "author", id: author.ulid, name };
    }

    case "theme.created": {
      const theme = findTheme(ctx.db, snapshot.subjectId);
      if (theme === null) return { kind: "theme", name, note: "Already gone." };
      // Deleting the theme in use would leave the app on nothing, so that
      // one is refused rather than repaired into some other theme.
      if (activeTheme(ctx.db)?.ulid === theme.ulid) {
        return { kind: "theme", name, note: "That theme is in use; pick another one first." };
      }
      deleteTheme(ctx.db, theme.id);
      return { kind: "theme", name, note: "Deleted." };
    }
    case "theme":
      return restoreThemeTokens(ctx, before as ThemeDto);
    case "theme.active": {
      const theme = findTheme(ctx.db, snapshot.subjectId);
      if (theme === null) return { kind: "theme", name, note: "That theme is gone." };
      setActiveTheme(ctx.db, theme.ulid);
      return { kind: "theme", id: theme.ulid, name, note: "Made active again." };
    }

    case "cast.added":
    case "cast.removed": {
      const was = before as { sceneId?: string; characterId?: string };
      const scene = was.sceneId === undefined ? null : findScene(ctx.db, was.sceneId);
      const character =
        was.characterId === undefined ? null : findCharacter(ctx.db, was.characterId);
      if (scene === null || character === null) {
        return { kind: "cast", name, note: "The roleplay or the character is gone." };
      }
      if (snapshot.kind === "cast.added") {
        removeSceneMember(ctx.db, scene.id, character.id);
        return { kind: "cast", name, note: `Taken back out of ${scene.title}.` };
      }
      addSceneMember(ctx.db, scene.id, character.id);
      return { kind: "cast", name, note: `Put back into ${scene.title}.` };
    }

    case "group.created": {
      const group = findCharacterGroup(ctx.db, snapshot.subjectId);
      if (group === null) return { kind: "group", name, note: "Already gone." };
      deleteCharacterGroup(ctx.db, group.id);
      return { kind: "group", name, note: "Deleted." };
    }
    case "group.added":
    case "group.removed": {
      const was = before as { groupId?: string; characterId?: string };
      const group = was.groupId === undefined ? null : findCharacterGroup(ctx.db, was.groupId);
      const character =
        was.characterId === undefined ? null : findCharacter(ctx.db, was.characterId);
      if (group === null || character === null) {
        return { kind: "group", name, note: "The group or the character is gone." };
      }
      if (snapshot.kind === "group.added") {
        removeGroupMember(ctx.db, group.id, character.id);
        return { kind: "group", name, note: `Taken back out of ${group.name}.` };
      }
      addGroupMember(ctx.db, group.id, character.id);
      return { kind: "group", name, note: `Put back into ${group.name}.` };
    }
  }
}

/**
 * Put a character's text back where it was.
 *
 * Through the card, not field by field, because the card is what the snapshot
 * holds and what `updateCharacter` already understands. A character that has
 * since been deleted is re-created rather than refused — the reader asked for
 * the old state, and "it is gone" is a worse answer than having it back.
 */
function restoreCharacterFields(ctx: AppContext, before: CharacterDto): Restored {
  const row = findCharacter(ctx.db, before.id);
  if (row === null) return reinsertCharacter(ctx, before);
  // `updateCharacter` versions the row it replaces, so the state being undone
  // is itself recoverable from the character editor's own history.
  updateCharacter(ctx.db, row.id, {
    name: before.name,
    description: before.description ?? null,
    personality: before.personality ?? null,
    scenario: before.scenario ?? null,
    firstMessage: before.firstMessage ?? null,
    exampleDialogue: before.exampleDialogue ?? null,
    systemPrompt: before.systemPrompt ?? null,
    postHistoryInstructions: before.postHistoryInstructions ?? null,
    creatorNotes: before.creatorNotes ?? null,
    mentionKeywords: before.mentionKeywords ?? [],
    tags: before.tags ?? [],
    folder: before.folder ?? null,
  });
  return { kind: "character", id: before.id, name: before.name };
}

/**
 * Re-create a deleted character from the snapshot the delete tool recorded.
 *
 * The snapshot is the DTO, so the text identity round-trips; the picture, the
 * version history and the lorebook binding do not survive a delete and are not
 * invented here. That is the honest bound of "so it can be restored", and it
 * is said in the response rather than left silent.
 */
function reinsertCharacter(ctx: AppContext, before: CharacterDto): Restored {
  if (findCharacter(ctx.db, before.id) !== null) {
    return { kind: "character", name: before.name, note: "Already in the library." };
  }
  const card: NormalisedCard = {
    name: before.name,
    description: before.description ?? null,
    personality: before.personality ?? null,
    scenario: before.scenario ?? null,
    firstMessage: before.firstMessage ?? null,
    alternateGreetings: before.alternateGreetings ?? [],
    groupGreetings: before.groupGreetings ?? [],
    exampleDialogue: before.exampleDialogue ?? null,
    systemPrompt: before.systemPrompt ?? null,
    postHistoryInstructions: before.postHistoryInstructions ?? null,
    creatorNotes: before.creatorNotes ?? null,
    tags: before.tags ?? [],
    creator: before.creator ?? null,
    characterVersion: before.characterVersion ?? null,
    depthPrompt: before.depthPrompt ?? null,
    depthPromptDepth: before.depthPromptDepth ?? 4,
    depthPromptRole: before.depthPromptRole ?? "system",
    extensions:
      before.mentionKeywords === undefined || before.mentionKeywords.length === 0
        ? {}
        : { mention_keywords: before.mentionKeywords },
  };
  const row = insertCharacter(ctx.db, {
    card,
    rawCard: buildCardDocument(card, null),
    format: before.format ?? "native",
    avatarPath: null,
    sourceFilename: null,
    sourceHash: null,
    voiceNotes: before.voiceNotes ?? null,
  });
  return {
    kind: "character",
    id: row.ulid,
    name: row.name,
    note: "Restored without its picture or book bindings.",
  };
}

/** Revert a theme's tokens to what they were before the agent changed them. */
function restoreThemeTokens(ctx: AppContext, before: ThemeDto): Restored {
  const row = findTheme(ctx.db, before.id);
  if (row === null) return { kind: "theme", name: before.name, note: "That theme is gone." };
  updateTheme(ctx.db, row.id, { tokens: before.tokens });
  return { kind: "theme", id: before.id, name: before.name };
}

/** The columns an entry's editor can set, back to what they were. */
function restoreEntryFields(ctx: AppContext, before: LoreEntryDto, name: string): Restored {
  const entry = findEntry(ctx.db, before.id);
  if (entry === null) return reinsertEntry(ctx, before, name);
  updateEntry(ctx.db, entry.id, entryColumns(before));
  return { kind: "lore entry", id: entry.ulid, name };
}

/**
 * Put a deleted entry back in the book it came from.
 *
 * The id changes — a new row gets a new ulid — which is worth saying, because
 * anything that referred to the old entry by id (an automation, a note) still
 * points at nothing.
 */
function reinsertEntry(ctx: AppContext, before: LoreEntryDto, name: string): Restored {
  if (findEntry(ctx.db, before.id) !== null) {
    return { kind: "lore entry", name, note: "Already in its book." };
  }
  const book = listLorebooks(ctx.db).find((row) => row.ulid === before.lorebookId);
  if (book === undefined) return { kind: "lore entry", name, note: "Its lorebook is gone." };
  const row = insertEntry(ctx.db, book.id, before.content);
  updateEntry(ctx.db, row.id, entryColumns(before));
  return {
    kind: "lore entry",
    id: row.ulid,
    name,
    note: "Restored under a new id; anything that referred to the old one does not follow.",
  };
}

/**
 * The entry columns a snapshot carries, as the row shape `updateEntry` takes.
 *
 * Only what the editor and the agent can set. The timed state (`sticky`,
 * `cooldown`, `delay`) is restored too, because those are the entry's
 * configuration; what is deliberately *not* restored is the live timer
 * `updateEntry` clears on every write, which is §10's rule that an edited entry
 * takes effect now.
 */
function entryColumns(before: LoreEntryDto): Record<string, unknown> {
  const list = (values: string[] | undefined) => JSON.stringify(values ?? []);
  return {
    title: before.title,
    content: before.content,
    enabled: before.enabled ? 1 : 0,
    keys: list(before.keys),
    secondary_keys: list(before.secondaryKeys),
    secondary_logic: before.secondaryLogic,
    case_sensitive: before.caseSensitive ? 1 : 0,
    match_whole_words: before.matchWholeWords ? 1 : 0,
    use_regex: before.useRegex ? 1 : 0,
    probability: before.probability,
    is_constant: before.isConstant ? 1 : 0,
    scan_depth: before.scanDepth,
    position: before.position,
    insertion_order: before.insertionOrder,
    insertion_depth: before.insertionDepth,
    insertion_role: before.insertionRole,
    inclusion_group: before.inclusionGroup,
    group_weight: before.groupWeight,
    sticky: before.sticky,
    cooldown: before.cooldown,
    delay: before.delay,
  };
}
