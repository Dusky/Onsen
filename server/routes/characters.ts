import { Hono } from "hono";
import { join } from "node:path";
import { unlinkSync } from "node:fs";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import {
  CardError,
  buildCardDocument,
  exportCard,
  importCard,
  type ExportFormat,
} from "../cards/index.ts";
import {
  deleteCharacter,
  findByHash,
  findCharacter,
  insertCharacter,
  listCharacters,
  toCharacterDto,
  toNormalisedCard,
  updateCharacter,
  type CharacterRow,
} from "../db/queries/characters.ts";
import {
  bulkApply,
  characterFolders,
  characterTags,
  characterVersions,
  findVersion,
  listCharactersFiltered,
  restoreVersion,
} from "../db/queries/library.ts";
import type { TaskRunner } from "../tasks/runner.ts";
import { SUGGEST_TAGS, taskKind } from "../tasks/registry.ts";
import {
  buildSuggestTagsPrompt,
  parseTagSuggestions,
} from "../generation/tags.ts";
import { createEstimatingTokenizer } from "../prompt/index.ts";
import type {
  BulkCharacterRequest,
  CharacterFilterQuery,
  ImportCharacterResponse,
  PromptRoleName,
  UpdateCharacterRequest,
} from "../../shared/types.ts";

/**
 * The character library (SPEC §9, §20 phase 6).
 *
 * Import accepts a PNG card, a CharX archive, or raw card JSON, detected from
 * the content rather than the filename. Export re-emits from the preserved
 * original with edits overlaid, so nothing the app does not model is lost on
 * the way back out.
 */

/** Cards are small; this only exists so a stray upload cannot exhaust memory. */
const MAX_CARD_BYTES = 32 * 1024 * 1024;

const ROLES: PromptRoleName[] = ["system", "user", "assistant"];

function badRequest(message: string) {
  return { error: { code: "bad_request", message } } as const;
}

function notFound() {
  return { error: { code: "not_found", message: "No such character." } } as const;
}

export function characterRoutes(ctx: AppContext, tasks: TaskRunner): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  function avatarFile(row: CharacterRow): string | null {
    return row.avatar_path === null ? null : join(ctx.config.avatarsDir, row.avatar_path);
  }

  app.get("/", (c) => {
    const q = c.req.query("q");
    const tag = c.req.query("tag");
    const folder = c.req.query("folder");
    const filter: CharacterFilterQuery = {
      ...(q === undefined ? {} : { q }),
      ...(tag === undefined ? {} : { tag }),
      ...(folder === undefined ? {} : { folder }),
    };
    const rows = listCharactersFiltered(ctx.db, filter);
    return c.json(rows.map((row) => toCharacterDto(ctx.db, row)));
  });

  /** The controlled vocabulary for tag autocomplete (SPEC §9). */
  app.get("/tags", (c) => c.json(characterTags(ctx.db)));

  /** Every folder in the library, for the folder filter. */
  app.get("/folders", (c) => c.json(characterFolders(ctx.db)));

  /** A bulk edit over a multi-selection (SPEC §9). */
  app.post("/bulk", async (c) => {
    let body: BulkCharacterRequest;
    try {
      body = (await c.req.json()) as BulkCharacterRequest;
    } catch {
      return c.json(badRequest("Expected a JSON body."), 400);
    }
    if (!Array.isArray(body.ids) || !["tag", "untag", "move", "delete"].includes(body.op)) {
      return c.json(badRequest("Bulk edits need a list of ids and an operation."), 400);
    }
    const { characters, deleted } = bulkApply(
      ctx.db,
      body.ids,
      body.op,
      body.tag ?? null,
      body.folder ?? null,
    );
    return c.json({
      characters: characters.map((row) => toCharacterDto(ctx.db, row)),
      deleted,
    });
  });

  /**
   * Import a card. The file's own bytes decide the format; a card renamed from
   * .charx to .png still imports correctly.
   */
  app.post("/import", async (c) => {
    let file: File | null = null;
    try {
      const form = await c.req.formData();
      const candidate = form.get("file");
      if (candidate instanceof File) file = candidate;
    } catch {
      return c.json(badRequest("Expected a file upload."), 400);
    }
    if (file === null) return c.json(badRequest("No file was uploaded."), 400);
    if (file.size > MAX_CARD_BYTES) return c.json(badRequest("That file is too large."), 413);

    const bytes = new Uint8Array(await file.arrayBuffer());

    let imported;
    try {
      imported = importCard(bytes, file.name);
    } catch (caught) {
      if (caught instanceof CardError) return c.json(badRequest(caught.message), 400);
      throw caught;
    }

    // The parsed-card cache also serves as duplicate detection: re-importing a
    // file already in the library returns what is there rather than a copy.
    const existing = findByHash(ctx.db, imported.sourceHash);
    if (existing !== null) {
      const body: ImportCharacterResponse = {
        character: toCharacterDto(ctx.db, existing),
        duplicateOf: existing.ulid,
        warnings: [`${existing.name} is already in the library.`],
      };
      return c.json(body, 200);
    }

    // The avatar is written before the row so a failure leaves an orphaned file
    // rather than a character pointing at nothing.
    let avatarPath: string | null = null;
    if (imported.avatar !== null) {
      avatarPath = `${imported.sourceHash.slice(0, 32)}.${imported.avatar.extension}`;
      await Bun.write(join(ctx.config.avatarsDir, avatarPath), imported.avatar.data);
    }

    const row = insertCharacter(ctx.db, {
      card: imported.card,
      rawCard: imported.rawCard,
      format: imported.format,
      avatarPath,
      sourceFilename: file.name,
      sourceHash: imported.sourceHash,
    });

    const warnings = [...imported.warnings];
    if (imported.unmodelledFields.length > 0) {
      // Silent partial imports are the worst outcome (SPEC §18); naming what
      // was not understood is the difference between preserved and lost.
      warnings.push(
        `Preserved but not shown in the editor: ${imported.unmodelledFields.join(", ")}.`,
      );
    }

    const body: ImportCharacterResponse = {
      character: toCharacterDto(ctx.db, row),
      duplicateOf: null,
      warnings,
    };
    return c.json(body, 201);
  });

  /** Create an empty card to fill in by hand. */
  app.post("/", async (c) => {
    let name = "New character";
    try {
      const body = (await c.req.json()) as { name?: unknown };
      if (typeof body.name === "string" && body.name.trim() !== "") name = body.name.trim();
    } catch {
      /* An empty body is fine. */
    }

    const card = {
      name,
      description: null,
      personality: null,
      scenario: null,
      firstMessage: null,
      alternateGreetings: [],
      groupGreetings: [],
      exampleDialogue: null,
      systemPrompt: null,
      postHistoryInstructions: null,
      creatorNotes: null,
      tags: [],
      creator: null,
      characterVersion: null,
      depthPrompt: null,
      depthPromptDepth: 4,
      depthPromptRole: "system" as const,
      extensions: {},
    };

    const row = insertCharacter(ctx.db, {
      card,
      // A card authored here still has an original: the document it would
      // export as. That keeps raw_card meaningful for every character.
      rawCard: buildCardDocument(card, null),
      format: "native",
      avatarPath: null,
      sourceFilename: null,
      sourceHash: null,
    });
    return c.json(toCharacterDto(ctx.db, row), 201);
  });

  app.get("/:characterId", (c) => {
    const row = findCharacter(ctx.db, c.req.param("characterId"));
    return row === null ? c.json(notFound(), 404) : c.json(toCharacterDto(ctx.db, row));
  });

  app.patch("/:characterId", async (c) => {
    const row = findCharacter(ctx.db, c.req.param("characterId"));
    if (row === null) return c.json(notFound(), 404);

    let patch: UpdateCharacterRequest;
    try {
      patch = (await c.req.json()) as UpdateCharacterRequest;
    } catch {
      return c.json(badRequest("Expected a JSON body."), 400);
    }
    if (typeof patch !== "object" || patch === null) {
      return c.json(badRequest("Expected a JSON object."), 400);
    }
    if ("name" in patch && (typeof patch.name !== "string" || patch.name.trim() === "")) {
      return c.json(badRequest("A character needs a name."), 400);
    }
    if ("depthPromptRole" in patch && !ROLES.includes(patch.depthPromptRole as PromptRoleName)) {
      return c.json(badRequest("Unknown depth prompt role."), 400);
    }
    if (
      "depthPromptDepth" in patch &&
      (typeof patch.depthPromptDepth !== "number" || !Number.isFinite(patch.depthPromptDepth))
    ) {
      return c.json(badRequest("Depth must be a number."), 400);
    }

    return c.json(toCharacterDto(ctx.db, updateCharacter(ctx.db, row.id, { ...patch })));
  });

  app.delete("/:characterId", (c) => {
    const row = findCharacter(ctx.db, c.req.param("characterId"));
    if (row === null) return c.json(notFound(), 404);

    const avatar = avatarFile(row);
    deleteCharacter(ctx.db, row.id);
    if (avatar !== null) {
      try {
        unlinkSync(avatar);
      } catch {
        // An avatar shared by two imports of the same file, or already gone.
      }
    }
    return c.body(null, 204);
  });

  /** The version history, newest first (SPEC §9). */
  app.get("/:characterId/versions", (c) => {
    const row = findCharacter(ctx.db, c.req.param("characterId"));
    if (row === null) return c.json(notFound(), 404);
    return c.json(characterVersions(ctx.db, row.id));
  });

  /** One snapshot, for the diff the editor draws against the current state. */
  app.get("/:characterId/versions/:versionUlid", (c) => {
    const row = findCharacter(ctx.db, c.req.param("characterId"));
    if (row === null) return c.json(notFound(), 404);
    const version = findVersion(ctx.db, row.id, c.req.param("versionUlid"));
    if (version === null) {
      return c.json({ error: { code: "not_found", message: "No such version." } }, 404);
    }
    return c.json(version);
  });

  /** Restore a snapshot — the state before it becomes a new version itself. */
  app.post("/:characterId/versions/:versionUlid/restore", (c) => {
    const row = findCharacter(ctx.db, c.req.param("characterId"));
    if (row === null) return c.json(notFound(), 404);
    const restored = restoreVersion(ctx.db, row.id, c.req.param("versionUlid"));
    if (restored === null) {
      return c.json({ error: { code: "not_found", message: "No such version." } }, 404);
    }
    return c.json(toCharacterDto(ctx.db, restored));
  });

  /**
   * Derive a variant (SPEC §9): a copy with a link back to its parent, for
   * alternate-universe versions of the same character. The copy carries the
   * parent's card rebuilt, not its raw document — a variant is a new original.
   */
  app.post("/:characterId/derive", async (c) => {
    const row = findCharacter(ctx.db, c.req.param("characterId"));
    if (row === null) return c.json(notFound(), 404);

    let name = `${row.name} (variant)`;
    try {
      const body = (await c.req.json()) as { name?: unknown };
      if (typeof body.name === "string" && body.name.trim() !== "") name = body.name.trim();
    } catch {
      /* The default name stands. */
    }

    const card = { ...toNormalisedCard(row), name };
    const derived = insertCharacter(ctx.db, {
      card,
      rawCard: buildCardDocument(card, null),
      format: "native",
      avatarPath: row.avatar_path,
      sourceFilename: null,
      sourceHash: null,
    });
    ctx.db
      .query("UPDATE characters SET parent_character_id = $parent, folder = $folder WHERE id = $id")
      .run({ id: derived.id, parent: row.id, folder: row.folder });
    const withParent = findCharacter(ctx.db, derived.ulid);
    return c.json(toCharacterDto(ctx.db, withParent ?? derived), 201);
  });

  /**
   * AI-assisted tagging (SPEC §9): read the card, propose tags from the
   * library's own vocabulary. Proposals only — the user is the gate, and a
   * side call that failed returns no tags rather than a failed request.
   */
  app.post("/:characterId/suggest-tags", async (c) => {
    const row = findCharacter(ctx.db, c.req.param("characterId"));
    if (row === null) return c.json(notFound(), 404);

    // No scene here, so the task's own profile and the default profile are
    // the two rungs it can climb — a character-level op has nowhere else to
    // look (§7's routing order, minus the scene).
    const fallback = (ctx.db.query(
      "SELECT id FROM connection_profiles ORDER BY is_default DESC, id LIMIT 1",
    ).get() ?? null) as { id: number } | null;

    const kind = taskKind(SUGGEST_TAGS)!;
    const outcome = await tasks.run({
      kind,
      sceneId: null,
      profileId: null,
      fallbackProfileId: fallback?.id ?? null,
      prompt: buildSuggestTagsPrompt(
        {
          name: row.name,
          description: row.description,
          personality: row.personality,
          creatorNotes: row.creator_notes,
          vocabulary: characterTags(ctx.db),
        },
        createEstimatingTokenizer(),
      ),
    });
    if (!outcome.ok) {
      return c.json(
        { error: { code: "unavailable", message: outcome.detail } },
        502,
      );
    }
    // Proposals only ever narrow: the model may not invent tags outside the
    // library's vocabulary, except where there is none.
    const vocabulary = new Set(characterTags(ctx.db));
    const proposals = parseTagSuggestions(outcome.text).filter(
      (tag) => vocabulary.size === 0 || vocabulary.has(tag),
    );
    return c.json({ tags: proposals });
  });

  /** Export in any supported format, re-emitting from the preserved original. */
  app.get("/:characterId/export", async (c) => {
    const row = findCharacter(ctx.db, c.req.param("characterId"));
    if (row === null) return c.json(notFound(), 404);

    const requested = c.req.query("format") ?? "png";
    if (requested !== "png" && requested !== "charx" && requested !== "json") {
      return c.json(badRequest("Unknown export format."), 400);
    }

    const avatarPath = avatarFile(row);
    let avatar: Uint8Array | null = null;
    if (avatarPath !== null) {
      const file = Bun.file(avatarPath);
      if (await file.exists()) avatar = new Uint8Array(await file.arrayBuffer());
    }

    const exported = exportCard(
      {
        card: toNormalisedCard(row),
        rawCard: row.raw_card,
        avatar,
        assets: new Map(),
      },
      requested as ExportFormat,
    );

    return c.body(exported.bytes as unknown as ArrayBuffer, 200, {
      "Content-Type": exported.contentType,
      "Content-Disposition": `attachment; filename="${exported.filename}"`,
    });
  });

  app.get("/:characterId/avatar", async (c) => {
    const row = findCharacter(ctx.db, c.req.param("characterId"));
    const path = row === null ? null : avatarFile(row);
    if (path === null) return c.json(notFound(), 404);

    const file = Bun.file(path);
    if (!(await file.exists())) return c.json(notFound(), 404);
    // Content-addressed by hash, so it can be cached indefinitely.
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    return c.body(file.stream(), 200, { "Content-Type": file.type });
  });

  return app;
}
