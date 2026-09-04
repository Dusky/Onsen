import { Hono } from "hono";
import { join } from "node:path";
import { unlinkSync } from "node:fs";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import { ulid } from "../lib/ulid.ts";
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
import {
  addExpression,
  deleteExpression,
  ensurePack,
  findExpression,
  findPackByCharacter,
  toPackDto,
} from "../db/queries/expressions.ts";
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
  BulkImportCharactersResponse,
  CharacterImportItemDto,
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

/** A file's extension, or a safe default for images whose name has none. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  const extension = dot === -1 ? "png" : name.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(extension) ? extension : "png";
}

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
   * Everything after the bytes have been parsed: the avatar on disk, the row,
   * the CharX sprites, and the warnings that say what was not understood.
   *
   * Shared by the single-file route and the bulk one, so a folder import and a
   * one-off import cannot drift into behaving differently.
   */
  async function persistCard(
    filename: string,
    imported: ReturnType<typeof importCard>,
  ): Promise<{ row: CharacterRow; warnings: string[] }> {
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
      sourceFilename: filename,
      sourceHash: imported.sourceHash,
    });

    // CharX bundles carry expression sprites under an `expressions/` tree;
    // import them into the pack so the VN stage has something to draw (§12).
    // The label is the filename stem; anything that is not named like a sprite
    // is left for re-export, not guessed at.
    let expressionCount = 0;
    for (const [path, data] of imported.assets) {
      const match = /(?:^|\/)expressions?\/([a-zA-Z0-9_-]+)\.(?:png|jpe?g|webp|gif)$/i.exec(path);
      if (match === null) continue;
      const label = match[1]!.toLowerCase();
      const pack = ensurePack(ctx.db, row.id, `${row.name} sprites`);
      const filePath = `${row.id}-${label}-${ulid()}.${path.split(".").at(-1) ?? "png"}`;
      await Bun.write(join(ctx.config.spritesDir, filePath), data);
      addExpression(ctx.db, pack.id, label, filePath, 0);
      expressionCount += 1;
    }

    const warnings = [...imported.warnings];
    if (expressionCount > 0) {
      warnings.push(
        `Imported ${expressionCount} expression sprite${expressionCount === 1 ? "" : "s"}.`,
      );
    }
    if (imported.unmodelledFields.length > 0) {
      // Silent partial imports are the worst outcome (SPEC §18); naming what
      // was not understood is the difference between preserved and lost.
      warnings.push(
        `Preserved but not shown in the editor: ${imported.unmodelledFields.join(", ")}.`,
      );
    }
    return { row, warnings };
  }

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

    const { row, warnings } = await persistCard(file.name, imported);

    const body: ImportCharacterResponse = {
      character: toCharacterDto(ctx.db, row),
      duplicateOf: null,
      warnings,
    };
    return c.json(body, 201);
  });

  /**
   * Bulk import (SPEC §9): a multi-select, or a whole folder.
   *
   * One bad file must not lose the other 199, so nothing here is a 400 except
   * an empty upload. Every file gets a row in the report saying what happened
   * to it — the same add/skip plan a pack install already reports, because a
   * folder of two hundred cards is exactly the case where "it worked" is not an
   * answer.
   *
   * Files are handled one at a time rather than in parallel: they are read into
   * memory whole, and a folder drop is not the moment to hold two hundred cards
   * at once.
   */
  app.post("/import/bulk", async (c) => {
    let files: File[] = [];
    try {
      const form = await c.req.formData();
      files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
    } catch {
      return c.json(badRequest("Expected a file upload."), 400);
    }
    if (files.length === 0) return c.json(badRequest("No files were uploaded."), 400);

    const items: CharacterImportItemDto[] = [];
    for (const file of files) {
      if (file.size > MAX_CARD_BYTES) {
        items.push({
          name: file.name,
          filename: file.name,
          action: "skip",
          detail: "Too large.",
          characterId: null,
        });
        continue;
      }

      let imported;
      try {
        imported = importCard(new Uint8Array(await file.arrayBuffer()), file.name);
      } catch (caught) {
        // A folder holds whatever a folder holds — a readme, a stray avatar, a
        // truncated download. Naming why each was passed over is the report.
        items.push({
          name: file.name,
          filename: file.name,
          action: "skip",
          detail: caught instanceof CardError ? caught.message : "Not a character card.",
          characterId: null,
        });
        continue;
      }

      const existing = findByHash(ctx.db, imported.sourceHash);
      if (existing !== null) {
        items.push({
          name: existing.name,
          filename: file.name,
          action: "skip",
          detail: "Already in the library.",
          characterId: existing.ulid,
        });
        continue;
      }

      const { row, warnings } = await persistCard(file.name, imported);
      items.push({
        name: row.name,
        filename: file.name,
        action: "add",
        detail: warnings.join(" "),
        characterId: row.ulid,
      });
    }

    const body: BulkImportCharactersResponse = {
      added: items.filter((item) => item.action === "add").length,
      skipped: items.filter((item) => item.action === "skip").length,
      items,
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

  /** The character's expression pack — the tag-to-sprite binding (§12). */
  app.get("/:characterId/expressions", (c) => {
    const row = findCharacter(ctx.db, c.req.param("characterId"));
    if (row === null) return c.json(notFound(), 404);
    const pack = findPackByCharacter(ctx.db, row.id);
    if (pack === null) {
      return c.json({ id: null, characterId: row.ulid, expressions: [] });
    }
    return c.json(toPackDto(ctx.db, pack, row.ulid));
  });

  /** Upload one sprite under a label, creating the pack on first use (§12). */
  app.post("/:characterId/expressions", async (c) => {
    const row = findCharacter(ctx.db, c.req.param("characterId"));
    if (row === null) return c.json(notFound(), 404);

    let file: File | null = null;
    let label = "";
    try {
      const form = await c.req.formData();
      const candidate = form.get("file");
      if (candidate instanceof File) file = candidate;
      const labelValue = form.get("label");
      if (typeof labelValue === "string") label = labelValue.trim().toLowerCase();
    } catch {
      return c.json(badRequest("Expected a file and a label."), 400);
    }
    if (file === null) return c.json(badRequest("No image was uploaded."), 400);
    if (label === "") return c.json(badRequest("An expression needs a label."), 400);
    if (file.size > 8 * 1024 * 1024) return c.json(badRequest("That sprite is too large."), 413);

    const pack = ensurePack(ctx.db, row.id, `${row.name} sprites`);
    // A flat name keeps the write inside the one directory the config creates
    // and makes the file content-addressed enough to never collide.
    const path = `${row.id}-${label}-${ulid()}.${extensionOf(file.name)}`;
    await Bun.write(join(ctx.config.spritesDir, path), new Uint8Array(await file.arrayBuffer()));
    const expression = addExpression(ctx.db, pack.id, label, path, 0);
    return c.json(toPackDto(ctx.db, pack, row.ulid), 201);
  });

  /** Serve a sprite by its expression id. */
  app.get("/expressions/:expressionId/image", async (c) => {
    const expression = findExpression(ctx.db, c.req.param("expressionId"));
    if (expression === null) {
      return c.json({ error: { code: "not_found", message: "No such expression." } }, 404);
    }
    const file = Bun.file(join(ctx.config.spritesDir, expression.image_path));
    if (!(await file.exists())) {
      return c.json({ error: { code: "not_found", message: "No image for that expression." } }, 404);
    }
    c.header("Cache-Control", "public, max-age=3600");
    return c.body(file.stream(), 200, { "Content-Type": file.type });
  });

  app.delete("/expressions/:expressionId", async (c) => {
    const expression = findExpression(ctx.db, c.req.param("expressionId"));
    if (expression === null) {
      return c.json({ error: { code: "not_found", message: "No such expression." } }, 404);
    }
    deleteExpression(ctx.db, expression.id);
    const file = Bun.file(join(ctx.config.spritesDir, expression.image_path));
    if (await file.exists()) {
      try {
        await file.delete();
      } catch {
        /* The row is gone; a leftover file is an orphan, not a failure. */
      }
    }
    return c.body(null, 204);
  });

  return app;
}
