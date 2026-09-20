/**
 * What the agent can do (SPEC §20 phase 46).
 *
 * One registry, one entry per tool: the schema the model is shown, and the
 * function that runs. Hand-written rather than generated off the routes,
 * because the model needs a description written for a reader — "the roleplays
 * in this install, newest first" beats "GET /scenes" — and because the set the
 * agent should have is narrower and blunter than the set the UI needs.
 *
 * Reads are wide. Writes are real writes: this is a single-user app on a LAN,
 * and an agent that can only suggest is a worse version of the ops that already
 * exist. **Every** write snapshots first (see `snapshot.ts`), so there is
 * something to go back to — which the app mostly did not have before.
 *
 * "Every" is load-bearing and was not true until §20 phase 219. Two tools
 * snapshotted while the assistant's own screen promised that every change it
 * made was listed under Undo, so an overwritten author or a deleted lore entry
 * was simply gone. `test/agent-undo.test.ts` runs each tool against a real
 * database and requires a snapshot from anything that changed a row, which is
 * the only version of this check that asks the question the reader cares about.
 */
import type { AppContext } from "../context.ts";
import type { ToolSpec } from "../prompt/index.ts";
import {
  deleteCharacter,
  findCharacter,
  listCharacters,
  toCharacterDto,
  updateCharacter,
} from "../db/queries/characters.ts";
import {
  activePathDtos,
  appendMessage,
  findScene,
  insertScene,
  listScenes,
  sceneDto,
  updateScene,
} from "../db/queries/history.ts";
import {
  addSceneMember,
  findAuthor,
  insertPersona,
  listAuthors,
  listPersonas,
  removeSceneMember,
  setTurnStrategy,
  toAuthorDto,
  toPersonaDto,
  updateAuthor,
  updatePersona,
} from "../db/queries/authors.ts";
import {
  deleteEntry,
  findEntry,
  findLorebook,
  insertEntry,
  insertLorebook,
  listEntries,
  listLorebooks,
  toBookDto,
  toEntryDto,
  updateEntry,
} from "../db/queries/lore.ts";
import {
  addGroupMember,
  findCharacterGroup,
  insertCharacterGroup,
  listCharacterGroups,
  removeGroupMember,
} from "../db/queries/groups.ts";
import { listDocuments } from "../documents/store.ts";
import {
  activeTheme,
  findTheme,
  insertTheme,
  listThemes,
  setActiveTheme,
  toThemeDto,
  updateTheme,
} from "../db/queries/themes.ts";
import { listCharactersFiltered } from "../db/queries/library.ts";
import { snapshotBefore, snapshotCreated } from "./snapshot.ts";

export interface Tool {
  spec: ToolSpec;
  /** Returns whatever the model should see. Throwing is a reported failure. */
  run(ctx: AppContext, args: Record<string, unknown>): unknown;
}

/* ------------------------------------------------------------------ */
/* Argument reading                                                    */
/* ------------------------------------------------------------------ */

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${key} is required and must be a non-empty string.`);
  }
  return value;
}

function optionalStr(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

function num(args: Record<string, unknown>, key: string, fallback: number): number {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * The turn strategies, named once. The schema the model is shown and the check
 * the tool runs read the same list, so an enum the tool would reject can never
 * be offered.
 */
const TURN_STRATEGIES = ["manual", "round_robin", "mention", "classifier"] as const;

/**
 * A lorebook's id as the rest of the app says it, from the numeric one a row
 * carries. Through `listLorebooks` rather than a query of its own, so this file
 * keeps reading the library the same way everything else does.
 */
function bookUlidOf(ctx: AppContext, lorebookId: number): string {
  return listLorebooks(ctx.db).find((book) => book.id === lorebookId)?.ulid ?? "";
}

const S = {
  string: (description: string) => ({ type: "string", description }),
  number: (description: string) => ({ type: "number", description }),
  object: (
    properties: Record<string, unknown>,
    required: string[] = [],
  ): Record<string, unknown> => ({ type: "object", properties, required }),
};

/* ------------------------------------------------------------------ */
/* The registry                                                        */
/* ------------------------------------------------------------------ */

export const TOOLS: Record<string, Tool> = {
  /* --- cast ---------------------------------------------------- */

  list_characters: {
    spec: {
      name: "list_characters",
      description:
        "Every character in the library, with id, name, folder, tags and which " +
        "fields are empty. Start here before changing anything about the cast.",
      parameters: S.object({}),
    },
    run: (ctx) =>
      listCharacters(ctx.db).map((row) => {
        const dto = toCharacterDto(ctx.db, row);
        return {
          id: dto.id,
          name: dto.name,
          folder: dto.folder,
          tags: dto.tags,
          empty: (
            [
              ["description", dto.description],
              ["personality", dto.personality],
              ["scenario", dto.scenario],
              ["firstMessage", dto.firstMessage],
            ] as const
          )
            .filter(([, value]) => value === null || value.trim() === "")
            .map(([field]) => field),
        };
      }),
  },

  search_characters: {
    spec: {
      name: "search_characters",
      description:
        "Full-text search across name, description, personality and creator notes. " +
        "Use this rather than listing everything when the library is large.",
      parameters: S.object({ query: S.string("What to look for.") }, ["query"]),
    },
    run: (ctx, args) =>
      listCharactersFiltered(ctx.db, { q: str(args, "query") })
        .slice(0, 40)
        .map((row) => {
          const dto = toCharacterDto(ctx.db, row);
          return { id: dto.id, name: dto.name, description: dto.description, tags: dto.tags };
        }),
  },

  get_character: {
    spec: {
      name: "get_character",
      description: "One character in full, every field.",
      parameters: S.object({ id: S.string("The character's id.") }, ["id"]),
    },
    run: (ctx, args) => {
      const row = findCharacter(ctx.db, str(args, "id"));
      if (row === null) throw new Error("No character has that id.");
      return toCharacterDto(ctx.db, row);
    },
  },

  update_character: {
    spec: {
      name: "update_character",
      description:
        "Change fields on a character. Only the fields you pass are touched. " +
        "The previous version is kept, so this can be undone.",
      parameters: S.object(
        {
          id: S.string("The character's id."),
          name: S.string("New name."),
          description: S.string("Who they are."),
          personality: S.string("How they behave."),
          scenario: S.string("The situation the card assumes."),
          firstMessage: S.string("How they open a scene."),
          mentionKeywords: {
            type: "array",
            items: { type: "string" },
            description: "What else they answer to, for the mention turn director.",
          },
          tags: { type: "array", items: { type: "string" }, description: "Library tags." },
          folder: S.string("Library folder."),
        },
        ["id"],
      ),
    },
    run: (ctx, args) => {
      const row = findCharacter(ctx.db, str(args, "id"));
      if (row === null) throw new Error("No character has that id.");
      const { id: _id, ...patch } = args;
      snapshotBefore(ctx, "character", row.ulid, toCharacterDto(ctx.db, row));
      return toCharacterDto(ctx.db, updateCharacter(ctx.db, row.id, patch));
    },
  },

  delete_character: {
    spec: {
      name: "delete_character",
      description:
        "Remove a character from the library. What they said in existing " +
        "roleplays stays. Snapshotted first, so it can be restored — though " +
        "not its picture or book binding, which a restore does not carry.",
      parameters: S.object({ id: S.string("The character's id.") }, ["id"]),
    },
    run: (ctx, args) => {
      const row = findCharacter(ctx.db, str(args, "id"));
      if (row === null) throw new Error("No character has that id.");
      snapshotBefore(ctx, "character.deleted", row.ulid, toCharacterDto(ctx.db, row));
      deleteCharacter(ctx.db, row.id);
      return { deleted: row.name };
    },
  },

  /* --- roleplays ----------------------------------------------- */

  list_scenes: {
    spec: {
      name: "list_scenes",
      description: "Every roleplay, newest first, with its cast and how long it is.",
      parameters: S.object({}),
    },
    run: (ctx) =>
      listScenes(ctx.db).map((row) => {
        const dto = sceneDto(ctx.db, row);
        return {
          id: dto.id,
          title: dto.title,
          messages: dto.turnCount,
          cast: dto.cast.map((member) => member.name),
          updatedAt: dto.updatedAt,
        };
      }),
  },

  read_scene: {
    spec: {
      name: "read_scene",
      description:
        "The turns on a roleplay's current path, oldest first. Long scenes are " +
        "truncated to the most recent turns; ask for more only if you need them.",
      parameters: S.object(
        { id: S.string("The roleplay's id."), limit: S.number("How many turns. Default 40.") },
        ["id"],
      ),
    },
    run: (ctx, args) => {
      const scene = findScene(ctx.db, str(args, "id"));
      if (scene === null) throw new Error("No roleplay has that id.");
      const all = activePathDtos(ctx.db, scene);
      const limit = Math.max(1, Math.min(200, num(args, "limit", 40)));
      return {
        title: scene.title,
        omitted: Math.max(0, all.length - limit),
        turns: all.slice(-limit).map((message) => ({
          id: message.id,
          speaker: message.speakerName ?? "you",
          content: message.content,
        })),
      };
    },
  },

  create_scene: {
    spec: {
      name: "create_scene",
      description: "Start a new roleplay, optionally casting characters into it.",
      parameters: S.object(
        {
          title: S.string("What to call it."),
          characterIds: {
            type: "array",
            items: { type: "string" },
            description: "Characters to cast, in order. The first one opens it.",
          },
        },
        ["title"],
      ),
    },
    run: (ctx, args) => {
      const row = insertScene(ctx.db, { title: str(args, "title") });
      const ids = Array.isArray(args["characterIds"]) ? args["characterIds"] : [];
      for (const id of ids) {
        if (typeof id !== "string") continue;
        const character = findCharacter(ctx.db, id);
        if (character !== null) addSceneMember(ctx.db, row.id, character.id);
      }
      // One snapshot for the whole scene, cast included: undoing a create is a
      // delete, and the members go with it.
      snapshotCreated(ctx, "scene.created", row.ulid, { name: row.title });
      return sceneDto(ctx.db, row);
    },
  },

  update_scene: {
    spec: {
      name: "update_scene",
      description: "Rename a roleplay, or change its scenario or turn strategy.",
      parameters: S.object(
        {
          id: S.string("The roleplay's id."),
          title: S.string("New title."),
          scenarioOverride: S.string("This roleplay's own framing, replacing the card's."),
          turnStrategy: {
            type: "string",
            enum: TURN_STRATEGIES,
            description: "Who speaks next.",
          },
        },
        ["id"],
      ),
    },
    run: (ctx, args) => {
      const scene = findScene(ctx.db, str(args, "id"));
      if (scene === null) throw new Error("No roleplay has that id.");
      snapshotBefore(ctx, "scene", scene.ulid, {
        name: scene.title,
        title: scene.title,
        scenarioOverride: scene.scenario_override,
        turnStrategy: scene.turn_strategy,
      });
      /*
       * Each of the three advertised fields, written through the one thing that
       * owns its column (§20 phase 219).
       *
       * This used to spread the raw arguments into `updateScene`, whose patch
       * type has no `scenarioOverride` or `turnStrategy` — so two of the three
       * fields the tool describes were accepted, reported as changed, and
       * dropped. The strategy has its own writer because `scene_members` work
       * lives beside it; the scenario is a plain scene column and `updateScene`
       * carries it now.
       */
      const patch: Parameters<typeof updateScene>[2] = {};
      const title = optionalStr(args, "title");
      if (title !== undefined && title.trim() !== "") patch.title = title.trim();
      if ("scenarioOverride" in args) {
        const scenario = optionalStr(args, "scenarioOverride");
        patch.scenarioOverride =
          scenario === undefined || scenario.trim() === "" ? null : scenario.trim();
      }
      const strategy = optionalStr(args, "turnStrategy");
      if (strategy !== undefined) {
        if (!TURN_STRATEGIES.includes(strategy as (typeof TURN_STRATEGIES)[number])) {
          throw new Error(`turnStrategy must be one of ${TURN_STRATEGIES.join(", ")}.`);
        }
        setTurnStrategy(ctx.db, scene.id, strategy);
      }
      return sceneDto(ctx.db, updateScene(ctx.db, scene.id, patch));
    },
  },

  add_note_to_scene: {
    spec: {
      name: "add_note_to_scene",
      description:
        "Append a hidden note to a roleplay. It sits in the log for the reader " +
        "and is kept out of the prompt, so it never changes what the author sees.",
      parameters: S.object(
        { id: S.string("The roleplay's id."), text: S.string("The note.") },
        ["id", "text"],
      ),
    },
    run: (ctx, args) => {
      const scene = findScene(ctx.db, str(args, "id"));
      if (scene === null) throw new Error("No roleplay has that id.");
      const row = appendMessage(ctx.db, {
        sceneId: scene.id,
        parentId: scene.active_leaf_id,
        kind: "system",
        authorType: "system",
        content: str(args, "text"),
        isHidden: true,
      });
      snapshotCreated(ctx, "scene.note", row.ulid, {
        name: `a note on ${scene.title}`,
        sceneId: scene.ulid,
      });
      return { added: row.ulid };
    },
  },

  /* --- lore ----------------------------------------------------- */

  list_lorebooks: {
    spec: {
      name: "list_lorebooks",
      description: "Every lorebook, with how many entries each holds.",
      parameters: S.object({}),
    },
    run: (ctx) =>
      listLorebooks(ctx.db).map((row) => ({
        ...toBookDto(ctx.db, row),
        entries: listEntries(ctx.db, row.id).length,
      })),
  },

  read_lorebook: {
    spec: {
      name: "read_lorebook",
      description: "One lorebook's entries, with their keys and content.",
      parameters: S.object({ id: S.string("The lorebook's id.") }, ["id"]),
    },
    run: (ctx, args) => {
      const book = listLorebooks(ctx.db).find((row) => row.ulid === str(args, "id"));
      if (book === undefined) throw new Error("No lorebook has that id.");
      return listEntries(ctx.db, book.id).map((row) => toEntryDto(row, book.ulid));
    },
  },

  create_lorebook: {
    spec: {
      name: "create_lorebook",
      description:
        "A new, empty lorebook. Add entries to it with add_lore_entry; a book " +
        "with no entries does nothing.",
      parameters: S.object({ name: S.string("What to call it.") }, ["name"]),
    },
    run: (ctx, args) => {
      const row = insertLorebook(ctx.db, { name: str(args, "name"), rawImport: null });
      snapshotCreated(ctx, "lorebook.created", row.ulid, { name: row.name });
      return toBookDto(ctx.db, row);
    },
  },

  add_lore_entry: {
    spec: {
      name: "add_lore_entry",
      description:
        "Add an entry to a lorebook. Keys are what makes it fire: the words that " +
        "have to appear in recent turns for this to be injected.",
      parameters: S.object(
        {
          lorebookId: S.string("The lorebook's id."),
          content: S.string("What the author is told when this fires."),
          keys: { type: "array", items: { type: "string" }, description: "Words that trigger it." },
          comment: S.string("A label for you, never sent to the model."),
        },
        ["lorebookId", "content"],
      ),
    },
    run: (ctx, args) => {
      const book = listLorebooks(ctx.db).find((row) => row.ulid === str(args, "lorebookId"));
      if (book === undefined) throw new Error("No lorebook has that id.");
      const row = insertEntry(ctx.db, book.id, str(args, "content"));
      const keys = Array.isArray(args["keys"])
        ? args["keys"].filter((k): k is string => typeof k === "string")
        : [];
      updateEntry(ctx.db, row.id, {
        keys: JSON.stringify(keys),
        ...(optionalStr(args, "comment") === undefined ? {} : { comment: args["comment"] }),
      });
      snapshotCreated(ctx, "lore_entry.created", row.ulid, {
        name: `an entry in ${book.name}`,
      });
      return { added: row.ulid };
    },
  },

  /* --- you ------------------------------------------------------ */

  list_personas: {
    spec: {
      name: "list_personas",
      description: "The identities the reader plays as.",
      parameters: S.object({}),
    },
    run: (ctx) => listPersonas(ctx.db).map((row) => ({ id: row.ulid, name: row.name })),
  },

  upsert_persona: {
    spec: {
      name: "upsert_persona",
      description: "Create a persona, or change one that exists.",
      parameters: S.object(
        {
          id: S.string("Omit to create a new one."),
          name: S.string("Their name."),
          description: S.string("Who the reader is in the story."),
        },
        ["name"],
      ),
    },
    run: (ctx, args) => {
      const existing = listPersonas(ctx.db).find((row) => row.ulid === optionalStr(args, "id"));
      const row = existing ?? insertPersona(ctx.db, str(args, "name"));
      // Two tools in one name, so two kinds: an overwrite keeps the old
      // persona to put back, a create keeps only the id to delete.
      if (existing === undefined) {
        snapshotCreated(ctx, "persona.created", row.ulid, { name: str(args, "name") });
      } else {
        snapshotBefore(ctx, "persona", row.ulid, toPersonaDto(existing));
      }
      const patch: Record<string, unknown> = { name: str(args, "name") };
      if (optionalStr(args, "description") !== undefined) patch["description"] = args["description"];
      const saved = updatePersona(ctx.db, row.id, patch);
      return { id: saved.ulid, name: saved.name };
    },
  },

  /* --- themes --------------------------------------------------- */

  list_themes: {
    spec: {
      name: "list_themes",
      description: "Every theme, which is active, and which ship with the app.",
      parameters: S.object({}),
    },
    run: (ctx) => {
      const active = activeTheme(ctx.db);
      return listThemes(ctx.db).map((row) => ({
        id: row.ulid,
        name: row.name,
        base: row.base,
        isBuiltin: row.is_builtin === 1,
        active: row.ulid === active?.ulid,
      }));
    },
  },

  create_theme: {
    spec: {
      name: "create_theme",
      description:
        "A new theme. Token names are the --onsen-* custom properties without " +
        "the prefix: color-bg, color-text, color-red, radius, shadow-card. Set " +
        "only what you mean to change; the rest follows.",
      parameters: S.object(
        {
          name: S.string("What to call it."),
          base: { type: "string", enum: ["dark", "light"], description: "Which defaults it sits on." },
          tokens: {
            type: "object",
            description: 'Token name to value, e.g. {"color-bg": "#0d1712"}.',
            additionalProperties: { type: "string" },
          },
        },
        ["name", "tokens"],
      ),
    },
    run: (ctx, args) => {
      const tokens: Record<string, string> = {};
      const offered = args["tokens"];
      if (typeof offered === "object" && offered !== null) {
        for (const [k, v] of Object.entries(offered as Record<string, unknown>)) {
          if (typeof v === "string") tokens[k] = v;
        }
      }
      const row = insertTheme(ctx.db, {
        name: str(args, "name"),
        base: args["base"] === "light" ? "light" : "dark",
        tokens,
      });
      const saved = toThemeDto(row);
      snapshotCreated(ctx, "theme.created", saved.id, { name: saved.name });
      // Report what was refused, so the model can correct rather than assume.
      const refused = Object.keys(tokens).filter((key) => !(key in saved.tokens));
      return { id: saved.id, name: saved.name, refusedTokens: refused };
    },
  },

  set_theme: {
    spec: {
      name: "set_theme",
      description: "Make a theme the active one. The reader's browser reloads into it.",
      parameters: S.object({ id: S.string("The theme's id.") }, ["id"]),
    },
    run: (ctx, args) => {
      const row = findTheme(ctx.db, str(args, "id"));
      if (row === null) throw new Error("No theme has that id.");
      // Which theme *was* active is the thing an undo needs, not which one is
      // being set — so the snapshot is the one being replaced.
      const was = activeTheme(ctx.db);
      if (was !== null) {
        snapshotBefore(ctx, "theme.active", was.ulid, { name: was.name });
      }
      setActiveTheme(ctx.db, row.ulid);
      return { active: row.name };
    },
  },

  update_theme: {
    spec: {
      name: "update_theme",
      description: "Change a theme's tokens. Shipped themes cannot be changed; copy one first.",
      parameters: S.object(
        {
          id: S.string("The theme's id."),
          tokens: {
            type: "object",
            description: "The complete token set to store.",
            additionalProperties: { type: "string" },
          },
        },
        ["id", "tokens"],
      ),
    },
    run: (ctx, args) => {
      const row = findTheme(ctx.db, str(args, "id"));
      if (row === null) throw new Error("No theme has that id.");
      if (row.is_builtin === 1) {
        throw new Error("That theme ships with Onsen. Create a new one from its values instead.");
      }
      const tokens: Record<string, string> = {};
      const offered = args["tokens"];
      if (typeof offered === "object" && offered !== null) {
        for (const [k, v] of Object.entries(offered as Record<string, unknown>)) {
          if (typeof v === "string") tokens[k] = v;
        }
      }
      snapshotBefore(ctx, "theme", row.ulid, toThemeDto(row));
      return toThemeDto(updateTheme(ctx.db, row.id, { tokens }));
    },
  },

  /* --- authors (§2) ------------------------------------------- */

  list_authors: {
    spec: {
      name: "list_authors",
      description:
        "Every author in the install, with id, name, and whether it is the " +
        "default one scenes use.",
      parameters: S.object({}),
    },
    run: (ctx) =>
      listAuthors(ctx.db).map((row) => ({
        id: row.ulid,
        name: row.name,
        isDefault: row.is_default === 1,
      })),
  },

  get_author: {
    spec: {
      name: "get_author",
      description: "One author in full: personality, writing and directing style, voice.",
      parameters: S.object({ id: S.string("The author's id.") }, ["id"]),
    },
    run: (ctx, args) => {
      const row = findAuthor(ctx.db, str(args, "id"));
      if (row === null) throw new Error("No author has that id.");
      return {
        id: row.ulid,
        name: row.name,
        personality: row.personality,
        writingStyle: row.writing_style,
        directingStyle: row.directing_style,
        oocVoice: row.ooc_voice,
        boundaries: row.boundaries,
      };
    },
  },

  update_author: {
    spec: {
      name: "update_author",
      description:
        "Change an author's fields. Only the fields you pass are touched. " +
        "The author is the one writing partner who voices every cast member, " +
        "so these shape how every scene reads.",
      parameters: S.object(
        {
          id: S.string("The author's id."),
          name: S.string("New name."),
          personality: S.string("Who they are, as a writing partner."),
          writingStyle: S.string("How their prose reads."),
          directingStyle: S.string("How they move a scene."),
          oocVoice: S.string("How they talk out of character."),
          boundaries: S.string("What they steer toward and away from."),
        },
        ["id"],
      ),
    },
    run: (ctx, args) => {
      const row = findAuthor(ctx.db, str(args, "id"));
      if (row === null) throw new Error("No author has that id.");
      const patch: Record<string, unknown> = {};
      for (const key of [
        "name",
        "personality",
        "writingStyle",
        "directingStyle",
        "oocVoice",
        "boundaries",
      ] as const) {
        const value = args[key];
        if (typeof value === "string") patch[key] = value;
      }
      snapshotBefore(ctx, "author", row.ulid, toAuthorDto(row));
      updateAuthor(ctx.db, row.id, patch);
      return { id: row.ulid, name: (patch["name"] as string | undefined) ?? row.name };
    },
  },

  /* --- a scene's cast (§2) ------------------------------------ */

  add_to_cast: {
    spec: {
      name: "add_to_cast",
      description:
        "Put a character into a roleplay's cast. Casting the first one seeds " +
        "the scene's opening from the character's card.",
      parameters: S.object(
        {
          sceneId: S.string("The roleplay's id."),
          characterId: S.string("The character's id."),
        },
        ["sceneId", "characterId"],
      ),
    },
    run: (ctx, args) => {
      const scene = findScene(ctx.db, str(args, "sceneId"));
      if (scene === null) throw new Error("No roleplay has that id.");
      const character = findCharacter(ctx.db, str(args, "characterId"));
      if (character === null) throw new Error("No character has that id.");
      snapshotCreated(ctx, "cast.added", character.ulid, {
        name: `${character.name} in ${scene.title}`,
        sceneId: scene.ulid,
        characterId: character.ulid,
      });
      addSceneMember(ctx.db, scene.id, character.id);
      return { added: character.name, to: scene.title };
    },
  },

  remove_from_cast: {
    spec: {
      name: "remove_from_cast",
      description:
        "Take a character out of a roleplay's cast. What they already said in " +
        "the roleplay stays.",
      parameters: S.object(
        {
          sceneId: S.string("The roleplay's id."),
          characterId: S.string("The character's id."),
        },
        ["sceneId", "characterId"],
      ),
    },
    run: (ctx, args) => {
      const scene = findScene(ctx.db, str(args, "sceneId"));
      if (scene === null) throw new Error("No roleplay has that id.");
      const character = findCharacter(ctx.db, str(args, "characterId"));
      if (character === null) throw new Error("No character has that id.");
      snapshotBefore(ctx, "cast.removed", character.ulid, {
        name: `${character.name} in ${scene.title}`,
        sceneId: scene.ulid,
        characterId: character.ulid,
      });
      removeSceneMember(ctx.db, scene.id, character.id);
      return { removed: character.name, from: scene.title };
    },
  },

  /* --- lore entries (§10) ------------------------------------- */

  update_lore_entry: {
    spec: {
      name: "update_lore_entry",
      description:
        "Change a lore entry's title, text or keys. Editing clears its timed " +
        "state, so the change takes effect next turn.",
      parameters: S.object(
        {
          id: S.string("The entry's id."),
          title: S.string("New title."),
          content: S.string("New text, injected when it fires."),
          keys: {
            type: "array",
            items: { type: "string" },
            description: "Words that make it fire.",
          },
        },
        ["id"],
      ),
    },
    run: (ctx, args) => {
      const entry = findEntry(ctx.db, str(args, "id"));
      if (entry === null) throw new Error("No lore entry has that id.");
      const patch: Record<string, unknown> = {};
      const title = optionalStr(args, "title");
      if (title !== undefined) patch["title"] = title;
      const content = optionalStr(args, "content");
      if (content !== undefined) patch["content"] = content;
      if (Array.isArray(args["keys"])) {
        patch["keys"] = JSON.stringify(
          (args["keys"] as unknown[]).filter((k): k is string => typeof k === "string"),
        );
      }
      snapshotBefore(ctx, "lore_entry", entry.ulid, {
        ...toEntryDto(entry, bookUlidOf(ctx, entry.lorebook_id)),
        name: entry.title ?? "a lore entry",
      });
      updateEntry(ctx.db, entry.id, patch as never);
      return { id: entry.ulid, title: (patch["title"] as string | undefined) ?? entry.title };
    },
  },

  delete_lore_entry: {
    spec: {
      name: "delete_lore_entry",
      description:
        "Remove a lore entry from its book. Snapshotted first, so it can be " +
        "restored into the same book.",
      parameters: S.object({ id: S.string("The entry's id.") }, ["id"]),
    },
    run: (ctx, args) => {
      const entry = findEntry(ctx.db, str(args, "id"));
      if (entry === null) throw new Error("No lore entry has that id.");
      snapshotBefore(ctx, "lore_entry.deleted", entry.ulid, {
        ...toEntryDto(entry, bookUlidOf(ctx, entry.lorebook_id)),
        name: entry.title ?? "a lore entry",
      });
      deleteEntry(ctx.db, entry.id);
      return { deleted: entry.title };
    },
  },

  /* --- character groups (§178) -------------------------------- */

  list_groups: {
    spec: {
      name: "list_groups",
      description: "Every character group, with its id, name and members.",
      parameters: S.object({}),
    },
    run: (ctx) => listCharacterGroups(ctx.db),
  },

  create_group: {
    spec: {
      name: "create_group",
      description: "Make a character group. Groups start a roleplay with a whole cast at once.",
      parameters: S.object({ name: S.string("What to call it.") }, ["name"]),
    },
    run: (ctx, args) => {
      const row = insertCharacterGroup(ctx.db, { name: str(args, "name") });
      snapshotCreated(ctx, "group.created", row.ulid, { name: row.name });
      return { id: row.ulid, name: row.name };
    },
  },

  add_to_group: {
    spec: {
      name: "add_to_group",
      description: "Add a character to a group, so a group roleplay starts with them in it.",
      parameters: S.object(
        { groupId: S.string("The group's id."), characterId: S.string("The character's id.") },
        ["groupId", "characterId"],
      ),
    },
    run: (ctx, args) => {
      const group = findCharacterGroup(ctx.db, str(args, "groupId"));
      if (group === null) throw new Error("No group has that id.");
      const character = findCharacter(ctx.db, str(args, "characterId"));
      if (character === null) throw new Error("No character has that id.");
      snapshotCreated(ctx, "group.added", character.ulid, {
        name: `${character.name} in ${group.name}`,
        groupId: group.ulid,
        characterId: character.ulid,
      });
      addGroupMember(ctx.db, group.id, character.id);
      return { added: character.name, to: group.name };
    },
  },

  remove_from_group: {
    spec: {
      name: "remove_from_group",
      description: "Remove a character from a group.",
      parameters: S.object(
        { groupId: S.string("The group's id."), characterId: S.string("The character's id.") },
        ["groupId", "characterId"],
      ),
    },
    run: (ctx, args) => {
      const group = findCharacterGroup(ctx.db, str(args, "groupId"));
      if (group === null) throw new Error("No group has that id.");
      const character = findCharacter(ctx.db, str(args, "characterId"));
      if (character === null) throw new Error("No character has that id.");
      snapshotBefore(ctx, "group.removed", character.ulid, {
        name: `${character.name} in ${group.name}`,
        groupId: group.ulid,
        characterId: character.ulid,
      });
      removeGroupMember(ctx.db, group.id, character.id);
      return { removed: character.name, from: group.name };
    },
  },

  /* --- the data bank (§11) ------------------------------------ */

  list_documents: {
    spec: {
      name: "list_documents",
      description:
        "Documents in the data bank, global first: title, id, and whether it is " +
        "scoped to one roleplay or available everywhere.",
      parameters: S.object({}),
    },
    run: (ctx) =>
      listDocuments(ctx.db, null).map((row) => ({
        id: row.ulid,
        title: row.title,
        global: row.scene_id === null,
      })),
  },
};

/** The specs, for the prompt. */
export function toolSpecs(): ToolSpec[] {
  return Object.values(TOOLS).map((tool) => tool.spec);
}
