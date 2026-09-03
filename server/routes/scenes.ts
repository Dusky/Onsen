import { Hono } from "hono";
import { join } from "node:path";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import { ulid } from "../lib/ulid.ts";
import {
  activePathDtos,
  appendMessage,
  deleteCheckpoint,
  deleteMessage,
  deleteScene,
  findCheckpoint,
  findMessage,
  findScene,
  findSceneById,
  insertCheckpoint,
  insertScene,
  isSelfOrDescendant,
  listCheckpoints,
  listScenes,
  messageDto,
  sceneDto,
  setActiveLeaf,
  siblingsOf,
  speakerLookup,
  splitBeat,
  toCheckpointDto,
  toMessageDto,
  updateMessage,
  updateScene,
  type MessageRow,
  type SceneRow,
} from "../db/queries/history.ts";
import {
  addSceneMember,
  findAuthor,
  findPersona,
  removeSceneMember,
  setAutoPasses,
  setDirectorNote,
  setDirectorProfile,
  setMemberActive,
  setTurnStrategy,
} from "../db/queries/authors.ts";
import { findCharacter } from "../db/queries/characters.ts";
import { scriptText } from "../scripts/runtime.ts";
import type { TriggerRunner } from "../triggers/runner.ts";
import type { WebhookSender } from "../webhooks/sender.ts";
import { activeGuides, editGuide, findGuide, flushGuides, toGuideDto } from "../db/queries/guides.ts";
import type { AutopilotRunner } from "../generation/autopilot.ts";
import { resolveNextSpeaker } from "../generation/turn.ts";
import {
  isMessageAuthorType,
  isMessageKind,
  TURN_STRATEGIES,
  type AppendMessageRequest,
  type CheckpointDto,
  type CreateCheckpointRequest,
  type CreateSceneRequest,
  type MessageDto,
  type SceneWithHistoryDto,
  type SetActiveLeafRequest,
  type UpdateMessageRequest,
  type UpdateSceneRequest,
} from "../../shared/types.ts";

const MAX_TITLE = 200;
const MAX_CHECKPOINT_NAME = 120;

function badRequest(message: string) {
  return { error: { code: "bad_request", message } } as const;
}

function notFound(what: string) {
  return { error: { code: "not_found", message: `No such ${what}.` } } as const;
}

/** A file's extension, or a safe default for images whose name has none. */
function extensionOfName(name: string): string {
  const dot = name.lastIndexOf(".");
  const extension = dot === -1 ? "png" : name.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(extension) ? extension : "png";
}

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown | symbol> {
  try {
    return await c.req.json();
  } catch {
    return BAD_JSON;
  }
}
const BAD_JSON = Symbol("bad json");

function asObject(body: unknown): Record<string, unknown> | null {
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

/** Optional string field: absent, or a string within the length bound. */
function optionalString(
  value: unknown,
  max: number,
): { ok: true; value: string | undefined } | { ok: false } {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return { ok: false };
  return { ok: true, value: trimmed };
}

/**
 * Scenes, the message tree, and checkpoints (SPEC §20 phase 2). The API comes
 * before any UI so the tree can be exercised directly; the chat screen in
 * phase 5 is a client of exactly these routes.
 */
/**
 * The numeric summarisation settings and what counts as a sane value (§11).
 *
 * Bounded rather than free: a threshold of zero summarises the turn that just
 * happened, and a freeze of a thousand means the injection point never moves
 * again. Neither is a setting anybody wants, and both look like a working
 * feature until a long scene goes wrong.
 */
const SUMMARY_NUMBERS: readonly [string, string, number, number][] = [
  ["summariseEveryMessages", "summarise_every_messages", 2, 500],
  ["summariseEveryWords", "summarise_every_words", 100, 100_000],
  ["summariseThreshold", "summarise_threshold", 0, 500],
  ["summariseFreeze", "summarise_freeze", 1, 100],
  // How long before the author may step out of the scene again (SPEC §7).
  ["oocInterval", "ooc_interval", 1, 500],
];

export function sceneRoutes(
  ctx: AppContext,
  autopilot: AutopilotRunner | null = null,
  triggers: TriggerRunner | null = null,
  webhooks: WebhookSender | null = null,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  /** Resolve a scene from the path, or null once a 404 has been written. */
  function scene(id: string): SceneRow | null {
    return findScene(ctx.db, id);
  }

  /** A message, checked to belong to the scene it was requested under. */
  function messageIn(sceneRow: SceneRow, messageUlid: string): MessageRow | null {
    const row = findMessage(ctx.db, messageUlid);
    return row !== null && row.scene_id === sceneRow.id ? row : null;
  }

  function history(sceneRow: SceneRow): SceneWithHistoryDto {
    return {
      scene: sceneDto(ctx.db, sceneRow),
      messages: activePathDtos(ctx.db, sceneRow),
      // The director's choice travels with the scene rather than needing a
      // second request: the composer has to know who the send button will
      // speak as before the user presses it.
      nextSpeaker: resolveNextSpeaker(ctx.db, sceneRow),
      // Versioned per message, so what comes back follows the active path
      // (SPEC §8) — rewinding rewinds them.
      guides: activeGuides(ctx.db, sceneRow.id).map(toGuideDto),
    };
  }

  /* -------------------------------------------------------------- */
  /* Scenes                                                          */
  /* -------------------------------------------------------------- */

  app.get("/", (c) => c.json(listScenes(ctx.db).map((row) => sceneDto(ctx.db, row))));

  app.post("/", async (c) => {
    const body = await readJson(c);
    if (body === BAD_JSON) return c.json(badRequest("Expected a JSON body."), 400);
    const input = asObject(body) ?? {};

    const title = optionalString((input as CreateSceneRequest).title, MAX_TITLE);
    if (!title.ok) return c.json(badRequest("The title must be a non-empty string."), 400);

    const preset = resolveRef(input.presetId, "presets");
    if (preset === INVALID) return c.json(badRequest("No such preset."), 400);
    const profile = resolveRef(input.connectionProfileId, "connection_profiles");
    if (profile === INVALID) return c.json(badRequest("No such connection profile."), 400);

    const row = insertScene(ctx.db, {
      title: title.value ?? "Untitled",
      presetId: preset,
      connectionProfileId: profile,
    });
    return c.json(sceneDto(ctx.db, row), 201);
  });

  app.get("/:sceneId", (c) => {
    const row = scene(c.req.param("sceneId"));
    return row === null ? c.json(notFound("scene"), 404) : c.json(history(row));
  });

  app.patch("/:sceneId", async (c) => {
    const row = scene(c.req.param("sceneId"));
    if (row === null) return c.json(notFound("scene"), 404);

    const body = await readJson(c);
    if (body === BAD_JSON) return c.json(badRequest("Expected a JSON body."), 400);
    const input = asObject(body) ?? {};

    const title = optionalString((input as UpdateSceneRequest).title, MAX_TITLE);
    if (!title.ok) return c.json(badRequest("The title must be a non-empty string."), 400);

    const patch: Parameters<typeof updateScene>[2] = {};
    if (title.value !== undefined) patch.title = title.value;
    if ("presetId" in input) {
      const preset = resolveRef(input.presetId, "presets");
      if (preset === INVALID) return c.json(badRequest("No such preset."), 400);
      patch.presetId = preset;
    }
    if ("connectionProfileId" in input) {
      const profile = resolveRef(input.connectionProfileId, "connection_profiles");
      if (profile === INVALID) return c.json(badRequest("No such connection profile."), 400);
      patch.connectionProfileId = profile;
    }
    // A null author is not a missing value: it selects single-character mode.
    if ("authorId" in input) {
      const author = resolveRef(input.authorId, "authors");
      if (author === INVALID) return c.json(badRequest("No such author."), 400);
      patch.authorId = author;
    }
    if ("personaId" in input) {
      const persona = resolveRef(input.personaId, "personas");
      if (persona === INVALID) return c.json(badRequest("No such persona."), 400);
      patch.personaId = persona;
    }
    if ("turnStrategy" in input) {
      if (!(TURN_STRATEGIES as readonly unknown[]).includes(input.turnStrategy)) {
        return c.json(badRequest("Unknown turn strategy."), 400);
      }
      setTurnStrategy(ctx.db, row.id, input.turnStrategy as string);
    }
    // Steer (SPEC §7): a note applied to every turn until cleared. An empty
    // string is a clear, not an empty instruction.
    if ("directorNote" in input) {
      const note = input.directorNote;
      if (note !== null && typeof note !== "string") {
        return c.json(badRequest("The steer must be text, or nothing."), 400);
      }
      setDirectorNote(ctx.db, row.id, note === null || note.trim() === "" ? null : note.trim());
    }
    // The custom guide's question is the user's own (SPEC §8). An empty string
    // clears it, which turns the guide off — there is nothing to ask.
    if ("customGuidePrompt" in input) {
      const prompt = input.customGuidePrompt;
      if (prompt !== null && typeof prompt !== "string") {
        return c.json(badRequest("The custom guide's question must be text, or nothing."), 400);
      }
      ctx.db.query("UPDATE scenes SET custom_guide_prompt = $prompt WHERE id = $id").run({
        id: row.id,
        prompt: prompt === null || prompt.trim() === "" ? null : prompt.trim(),
      });
    }
    // This scene's own framing, in place of the card's (SPEC §2). Empty clears
    // it, which puts the card's scenario back.
    if ("scenarioOverride" in input) {
      const scenario = input.scenarioOverride;
      if (scenario !== null && typeof scenario !== "string") {
        return c.json(badRequest("The scenario must be text, or nothing."), 400);
      }
      ctx.db.query("UPDATE scenes SET scenario_override = $scenario WHERE id = $id").run({
        id: row.id,
        scenario: scenario === null || scenario.trim() === "" ? null : scenario.trim(),
      });
    }
    // Whether a finished turn gets read by the passes without being asked
    // (SPEC §7.5). Which passes take part is the per-op switch.
    if ("autoPasses" in input) {
      if (typeof input.autoPasses !== "boolean") {
        return c.json(badRequest("autoPasses must be a boolean."), 400);
      }
      setAutoPasses(ctx.db, row.id, input.autoPasses);
    }
    // Rolling summarisation (SPEC §11). All six knobs are per scene, because
    // how fast a story moves is a property of the story: a scene of one-line
    // exchanges and one of long descriptive turns want different thresholds.
    if ("summarise" in input) {
      if (typeof input.summarise !== "boolean") {
        return c.json(badRequest("summarise must be a boolean."), 400);
      }
      ctx.db
        .query("UPDATE scenes SET summarise = $on WHERE id = $id")
        .run({ id: row.id, on: input.summarise ? 1 : 0 });
    }
    // Whether the author may step out of character at all (SPEC §7).
    if ("oocEnabled" in input) {
      if (typeof input.oocEnabled !== "boolean") {
        return c.json(badRequest("oocEnabled must be a boolean."), 400);
      }
      ctx.db
        .query("UPDATE scenes SET ooc_enabled = $on WHERE id = $id")
        .run({ id: row.id, on: input.oocEnabled ? 1 : 0 });
    }
    // Whether an aside renders inline in the log, or only in the channel
    // (§7). Inline is the designed first appearance; a reader who finds it
    // redundant switches it off here.
    if ("oocInline" in input) {
      if (typeof input.oocInline !== "boolean") {
        return c.json(badRequest("oocInline must be a boolean."), 400);
      }
      ctx.db.query("UPDATE scenes SET ooc_inline = $on WHERE id = $id").run({
        id: row.id,
        on: input.oocInline ? 1 : 0,
      });
    }
    // Autopilot (SPEC §6). Throwing the switch off is itself a stop: the
    // reader has said what they want, and "one more turn" is one too many.
    if ("autopilotEnabled" in input) {
      if (typeof input.autopilotEnabled !== "boolean") {
        return c.json(badRequest("autopilotEnabled must be a boolean."), 400);
      }
      ctx.db
        .query("UPDATE scenes SET autopilot_enabled = $on WHERE id = $id")
        .run({ id: row.id, on: input.autopilotEnabled ? 1 : 0 });
      if (!input.autopilotEnabled && autopilot !== null) {
        await autopilot.stop(row.id, "off");
      }
    }
    if ("autopilotMaxTurns" in input) {
      const value = input.autopilotMaxTurns;
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > 100
      ) {
        return c.json(
          badRequest("autopilotMaxTurns must be a whole number between 1 and 100."),
          400,
        );
      }
      ctx.db.query("UPDATE scenes SET autopilot_max_turns = $value WHERE id = $id").run({
        id: row.id,
        value,
      });
    }
    // Visual novel staging (SPEC §12): sprites above the log. Off by default —
    // a reader who wants prose wants prose.
    if ("vnModeEnabled" in input) {
      if (typeof input.vnModeEnabled !== "boolean") {
        return c.json(badRequest("vnModeEnabled must be a boolean."), 400);
      }
      ctx.db.query("UPDATE scenes SET vn_mode_enabled = $on WHERE id = $id").run({
        id: row.id,
        on: input.vnModeEnabled ? 1 : 0,
      });
    }
    if ("summariseEvict" in input) {
      if (typeof input.summariseEvict !== "boolean") {
        return c.json(badRequest("summariseEvict must be a boolean."), 400);
      }
      ctx.db
        .query("UPDATE scenes SET summarise_evict = $on WHERE id = $id")
        .run({ id: row.id, on: input.summariseEvict ? 1 : 0 });
    }
    for (const [field, column, min, max] of SUMMARY_NUMBERS) {
      if (!(field in input)) continue;
      const value = (input as Record<string, unknown>)[field];
      if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
        return c.json(badRequest(`${field} must be a whole number between ${min} and ${max}.`), 400);
      }
      ctx.db.query(`UPDATE scenes SET ${column} = $value WHERE id = $id`).run({
        id: row.id,
        value,
      });
    }
    // Where the classifier runs (SPEC §6). Null is meaningful: it means the
    // scene's own profile, which is correct but spends a roleplay model on a
    // one-line question.
    if ("directorProfileId" in input) {
      const profile = resolveRef(input.directorProfileId, "connection_profiles");
      if (profile === INVALID) return c.json(badRequest("No such connection profile."), 400);
      setDirectorProfile(ctx.db, row.id, profile ?? null);
    }

    return c.json(sceneDto(ctx.db, updateScene(ctx.db, row.id, patch)));
  });

  app.delete("/:sceneId", (c) => {
    const row = scene(c.req.param("sceneId"));
    if (row === null) return c.json(notFound("scene"), 404);
    deleteScene(ctx.db, row.id);
    return c.body(null, 204);
  });

  /** Set a scene's background image (SPEC §12). */
  app.post("/:sceneId/background", async (c) => {
    const row = scene(c.req.param("sceneId"));
    if (row === null) return c.json(notFound("scene"), 404);
    let file: File | null = null;
    try {
      const form = await c.req.formData();
      const candidate = form.get("file");
      if (candidate instanceof File) file = candidate;
    } catch {
      return c.json(badRequest("Expected a file upload."), 400);
    }
    if (file === null) return c.json(badRequest("No image was uploaded."), 400);
    if (file.size > 16 * 1024 * 1024) return c.json(badRequest("That background is too large."), 413);

    const path = `${row.id}-${ulid()}.${extensionOfName(file.name)}`;
    await Bun.write(join(ctx.config.dataDir, "backgrounds", path), new Uint8Array(await file.arrayBuffer()));
    ctx.db.query("UPDATE scenes SET background_path = $path WHERE id = $id").run({
      id: row.id,
      path,
    });
    return c.json(sceneDto(ctx.db, findScene(ctx.db, row.ulid)!));
  });

  app.get("/:sceneId/background", async (c) => {
    const row = scene(c.req.param("sceneId"));
    if (row === null || row.background_path === null) return c.json(notFound("scene"), 404);
    const file = Bun.file(join(ctx.config.dataDir, "backgrounds", row.background_path));
    if (!(await file.exists())) return c.json(notFound("scene"), 404);
    c.header("Cache-Control", "public, max-age=3600");
    return c.body(file.stream(), 200, { "Content-Type": file.type });
  });

  /* -------------------------------------------------------------- */
  /* Cast                                                            */
  /* -------------------------------------------------------------- */

  /**
   * Add a character to a scene. Adding is cheap by design (SPEC §9): the author
   * drives generation, so a cast member costs a compact definition rather than
   * a whole second agent.
   */
  app.put("/:sceneId/cast/:characterId", (c) => {
    const sceneRow = scene(c.req.param("sceneId"));
    if (sceneRow === null) return c.json(notFound("scene"), 404);
    const character = findCharacter(ctx.db, c.req.param("characterId"));
    if (character === null) return c.json(notFound("character"), 404);

    addSceneMember(ctx.db, sceneRow.id, character.id);
    return c.json(sceneDto(ctx.db, sceneRow));
  });

  /**
   * Instant scene assignment (SPEC §9): add several cast members at once, the
   * character-picker's bulk half. The same cheap add as the single route, so
   * the picker is one request, not a loop.
   */
  app.post("/:sceneId/cast", async (c) => {
    const sceneRow = scene(c.req.param("sceneId"));
    if (sceneRow === null) return c.json(notFound("scene"), 404);

    let body: { characterIds?: unknown };
    try {
      body = (await c.req.json()) as { characterIds?: unknown };
    } catch {
      return c.json(badRequest("Expected a JSON body."), 400);
    }
    if (!Array.isArray(body.characterIds)) {
      return c.json(badRequest("A list of characterIds is required."), 400);
    }

    for (const id of body.characterIds) {
      if (typeof id !== "string") continue;
      const character = findCharacter(ctx.db, id);
      if (character !== null) addSceneMember(ctx.db, sceneRow.id, character.id);
    }
    return c.json(sceneDto(ctx.db, sceneRow));
  });

  /** Bench or un-bench a cast member: they stay, but stop being chosen. */
  app.patch("/:sceneId/cast/:characterId", async (c) => {
    const sceneRow = scene(c.req.param("sceneId"));
    if (sceneRow === null) return c.json(notFound("scene"), 404);
    const character = findCharacter(ctx.db, c.req.param("characterId"));
    if (character === null) return c.json(notFound("character"), 404);

    let isActive = true;
    try {
      const body = (await c.req.json()) as { isActive?: unknown };
      if (typeof body.isActive !== "boolean") {
        return c.json(badRequest("isActive must be a boolean."), 400);
      }
      isActive = body.isActive;
    } catch {
      return c.json(badRequest("Expected a JSON body."), 400);
    }

    setMemberActive(ctx.db, sceneRow.id, character.id, isActive);
    return c.json(sceneDto(ctx.db, sceneRow));
  });

  app.delete("/:sceneId/cast/:characterId", (c) => {
    const sceneRow = scene(c.req.param("sceneId"));
    if (sceneRow === null) return c.json(notFound("scene"), 404);
    const character = findCharacter(ctx.db, c.req.param("characterId"));
    if (character === null) return c.json(notFound("character"), 404);

    // History written by this character stays: removing them from the cast is
    // not the same as deleting what they said.
    removeSceneMember(ctx.db, sceneRow.id, character.id);
    return c.json(sceneDto(ctx.db, sceneRow));
  });

  /* -------------------------------------------------------------- */
  /* Messages                                                        */
  /* -------------------------------------------------------------- */

  app.get("/:sceneId/messages", (c) => {
    const row = scene(c.req.param("sceneId"));
    return row === null ? c.json(notFound("scene"), 404) : c.json(activePathDtos(ctx.db, row));
  });

  app.post("/:sceneId/messages", async (c) => {
    const sceneRow = scene(c.req.param("sceneId"));
    if (sceneRow === null) return c.json(notFound("scene"), 404);

    // A message from the reader is §6's second stop, and it must be acted on
    // *before* the append: the loop's in-flight turn would otherwise land
    // after — and on top of — what the reader just said.
    if (autopilot !== null) await autopilot.yieldToUser(sceneRow.id);

    const body = await readJson(c);
    if (body === BAD_JSON) return c.json(badRequest("Expected a JSON body."), 400);
    const input = asObject(body);
    if (input === null) return c.json(badRequest("Expected a JSON object."), 400);

    const request = input as Partial<AppendMessageRequest>;
    if (!isMessageKind(request.kind)) return c.json(badRequest("Unknown message kind."), 400);
    if (!isMessageAuthorType(request.authorType)) {
      return c.json(badRequest("Unknown author type."), 400);
    }
    if (typeof request.content !== "string") {
      return c.json(badRequest("Content must be a string."), 400);
    }

    // Absent means the active leaf — the normal case. An explicit null attaches
    // at the root, which is how alternate greetings become siblings.
    let parentId: number | null;
    if (request.parentId === undefined) {
      parentId = sceneRow.active_leaf_id;
    } else if (request.parentId === null) {
      parentId = null;
    } else {
      const parent = messageIn(sceneRow, request.parentId);
      if (parent === null) return c.json(notFound("parent message"), 404);
      parentId = parent.id;
    }

    // §14's `user_input` stage: what the reader typed is rewritten before it is
    // stored, so the model and the log see the same thing. Only what the reader
    // wrote - a system note or an imported greeting arriving through this route
    // is not input, and a script written to fix the reader's habits should not
    // reach it.
    const content =
      request.authorType === "user"
        ? scriptText(ctx.db, "user_input", request.content, { sceneId: sceneRow.id })
        : request.content;

    // Whether the scene was empty has to be read before the write, not after.
    const wasEmpty = sceneRow.active_leaf_id === null;

    const row = appendMessage(ctx.db, {
      sceneId: sceneRow.id,
      parentId,
      kind: request.kind,
      authorType: request.authorType,
      content,
      ...(request.isHidden === undefined ? {} : { isHidden: request.isHidden }),
    });
    const dto = messageDto(ctx.db, row, sceneRow.ulid);

    // §14's two message-side events. Not awaited: an action is a side call, and
    // the composer should not wait on one to see the line it just sent. Never
    // able to break the write either - by the time this runs, the message is
    // already in the tree.
    // §15's `message.created`, for what the reader wrote. The generated half is
    // fired by the service, which is the only place that knows a turn landed.
    if (webhooks?.anyFor("message.created") === true) {
      webhooks.emit(
        "message.created",
        { sceneId: sceneRow.ulid, sceneTitle: sceneRow.title },
        {
          messageId: dto.id,
          kind: dto.kind,
          authorType: dto.authorType,
          content: dto.content,
          speaker: dto.speakerName,
          createdAt: dto.createdAt,
        },
      );
    }

    if (triggers !== null) {
      const after = findScene(ctx.db, sceneRow.ulid);
      if (after !== null) {
        // "Scene start" is the first thing being written into it, rather than
        // the scene being created: a scene with no messages has nothing for a
        // guide or a script to read, so firing at creation would fire at the
        // one moment every action is guaranteed to do nothing.
        if (wasEmpty && triggers.anyFor("scene_start")) {
          void triggers.fire("scene_start", { scene: after }).catch(() => {});
        }
        if (request.authorType === "user" && triggers.anyFor("user_message")) {
          void triggers.fire("user_message", { scene: after }).catch(() => {});
        }
      }
    }
    return c.json(dto, 201);
  });

  app.patch("/:sceneId/messages/:messageId", async (c) => {
    const sceneRow = scene(c.req.param("sceneId"));
    if (sceneRow === null) return c.json(notFound("scene"), 404);
    const row = messageIn(sceneRow, c.req.param("messageId"));
    if (row === null) return c.json(notFound("message"), 404);

    const body = await readJson(c);
    if (body === BAD_JSON) return c.json(badRequest("Expected a JSON body."), 400);
    const input = asObject(body);
    if (input === null) return c.json(badRequest("Expected a JSON object."), 400);

    const request = input as UpdateMessageRequest;
    if (request.content !== undefined && typeof request.content !== "string") {
      return c.json(badRequest("Content must be a string."), 400);
    }
    if (request.isHidden !== undefined && typeof request.isHidden !== "boolean") {
      return c.json(badRequest("isHidden must be a boolean."), 400);
    }

    const patch: Parameters<typeof updateMessage>[2] = {};
    if (request.content !== undefined) patch.content = request.content;
    if (request.isHidden !== undefined) patch.isHidden = request.isHidden;

    return c.json(messageDto(ctx.db, updateMessage(ctx.db, row.id, patch), sceneRow.ulid));
  });

  app.delete("/:sceneId/messages/:messageId", (c) => {
    const sceneRow = scene(c.req.param("sceneId"));
    if (sceneRow === null) return c.json(notFound("scene"), 404);
    const row = messageIn(sceneRow, c.req.param("messageId"));
    if (row === null) return c.json(notFound("message"), 404);

    deleteMessage(ctx.db, row);
    // The caller needs the new leaf, so return the scene rather than 204.
    return c.json(sceneDto(ctx.db, findSceneById(ctx.db, sceneRow.id) as SceneRow));
  });

  /**
   * Split a beat into one message per segment (SPEC §7).
   *
   * The new messages are a chain under the beat's own parent, so the beat
   * survives as a sibling of them: this is a branch, not a conversion, and
   * nothing is destroyed. The point of it is being able to branch from the
   * middle of an exchange the author wrote in one go.
   */
  app.post("/:sceneId/messages/:messageId/split", (c) => {
    const sceneRow = scene(c.req.param("sceneId"));
    if (sceneRow === null) return c.json(notFound("scene"), 404);
    const row = messageIn(sceneRow, c.req.param("messageId"));
    if (row === null) return c.json(notFound("message"), 404);

    if (row.kind !== "beat") {
      return c.json(badRequest("Only a beat can be split — it is the one with parts."), 400);
    }
    const created = splitBeat(ctx.db, row);
    if (created.length === 0) {
      return c.json(
        badRequest("This beat has only one part, so splitting it would change nothing."),
        400,
      );
    }
    return c.json(history(findSceneById(ctx.db, sceneRow.id) as SceneRow));
  });

  /** The swipe carousel: every version of this turn, in creation order. */
  app.get("/:sceneId/messages/:messageId/siblings", (c) => {
    const sceneRow = scene(c.req.param("sceneId"));
    if (sceneRow === null) return c.json(notFound("scene"), 404);
    const row = messageIn(sceneRow, c.req.param("messageId"));
    if (row === null) return c.json(notFound("message"), 404);

    const siblings = siblingsOf(ctx.db, row);
    const parentUlid =
      row.parent_id === null
        ? null
        : ((
            ctx.db.query("SELECT ulid FROM messages WHERE id = $id").get({ id: row.parent_id }) as
              | { ulid: string }
              | null
          )?.ulid ?? null);

    // Sibling positions are known from the list itself, so they are supplied
    // rather than re-queried per row.
    const speakers = speakerLookup(ctx.db);
    const dtos: MessageDto[] = siblings.map((sibling, index) =>
      toMessageDto(
        { ...sibling, sibling_index: index, sibling_count: siblings.length },
        sceneRow.ulid,
        parentUlid,
        speakers,
      ),
    );
    return c.json(dtos);
  });

  /**
   * Move the leaf. Swipe, rewind, branch and checkpoint restore are all this
   * one operation — none of them destroy anything, they choose a path.
   */
  app.put("/:sceneId/leaf", async (c) => {
    const sceneRow = scene(c.req.param("sceneId"));
    if (sceneRow === null) return c.json(notFound("scene"), 404);

    const body = await readJson(c);
    if (body === BAD_JSON) return c.json(badRequest("Expected a JSON body."), 400);
    const input = asObject(body);
    if (input === null) return c.json(badRequest("Expected a JSON object."), 400);

    const request = input as Partial<SetActiveLeafRequest>;
    if (typeof request.messageId !== "string") {
      return c.json(badRequest("messageId is required."), 400);
    }
    const target = messageIn(sceneRow, request.messageId);
    if (target === null) return c.json(notFound("message"), 404);

    setActiveLeaf(ctx.db, sceneRow.id, target.id, request.descend !== false);
    return c.json(history(findSceneById(ctx.db, sceneRow.id) as SceneRow));
  });

  /* -------------------------------------------------------------- */
  /* Checkpoints                                                     */
  /* -------------------------------------------------------------- */

  app.get("/:sceneId/checkpoints", (c) => {
    const sceneRow = scene(c.req.param("sceneId"));
    if (sceneRow === null) return c.json(notFound("scene"), 404);
    return c.json(checkpointDtos(sceneRow));
  });

  app.post("/:sceneId/checkpoints", async (c) => {
    const sceneRow = scene(c.req.param("sceneId"));
    if (sceneRow === null) return c.json(notFound("scene"), 404);

    const body = await readJson(c);
    if (body === BAD_JSON) return c.json(badRequest("Expected a JSON body."), 400);
    const input = asObject(body);
    if (input === null) return c.json(badRequest("Expected a JSON object."), 400);

    const request = input as Partial<CreateCheckpointRequest>;
    const name = optionalString(request.name, MAX_CHECKPOINT_NAME);
    if (!name.ok || name.value === undefined) {
      return c.json(badRequest("A checkpoint needs a name."), 400);
    }

    let messageId: number;
    if (request.messageId === undefined) {
      if (sceneRow.active_leaf_id === null) {
        return c.json(badRequest("There is nothing to bookmark in an empty scene."), 400);
      }
      messageId = sceneRow.active_leaf_id;
    } else {
      const target = messageIn(sceneRow, request.messageId);
      if (target === null) return c.json(notFound("message"), 404);
      messageId = target.id;
    }

    const row = insertCheckpoint(ctx.db, { sceneId: sceneRow.id, messageId, name: name.value });
    const messageUlid = (
      ctx.db.query("SELECT ulid FROM messages WHERE id = $id").get({ id: messageId }) as {
        ulid: string;
      }
    ).ulid;
    return c.json(toCheckpointDto(row, sceneRow.ulid, messageUlid), 201);
  });

  /**
   * Restore lands exactly on the bookmarked message rather than descending to a
   * leaf: a checkpoint is a place to fork from, so the next message must attach
   * there (SPEC §2).
   */
  app.post("/:sceneId/checkpoints/:checkpointId/restore", (c) => {
    const sceneRow = scene(c.req.param("sceneId"));
    if (sceneRow === null) return c.json(notFound("scene"), 404);
    const checkpoint = findCheckpoint(ctx.db, c.req.param("checkpointId"));
    if (checkpoint === null || checkpoint.scene_id !== sceneRow.id) {
      return c.json(notFound("checkpoint"), 404);
    }

    setActiveLeaf(ctx.db, sceneRow.id, checkpoint.message_id, false);
    return c.json(history(findSceneById(ctx.db, sceneRow.id) as SceneRow));
  });

  app.delete("/:sceneId/checkpoints/:checkpointId", (c) => {
    const sceneRow = scene(c.req.param("sceneId"));
    if (sceneRow === null) return c.json(notFound("scene"), 404);
    const checkpoint = findCheckpoint(ctx.db, c.req.param("checkpointId"));
    if (checkpoint === null || checkpoint.scene_id !== sceneRow.id) {
      return c.json(notFound("checkpoint"), 404);
    }
    deleteCheckpoint(ctx.db, checkpoint.id);
    return c.body(null, 204);
  });

  /* -------------------------------------------------------------- */
  /* Helpers needing ctx                                             */
  /* -------------------------------------------------------------- */

  function checkpointDtos(sceneRow: SceneRow): CheckpointDto[] {
    return listCheckpoints(ctx.db, sceneRow.id).map((row) => {
      const messageUlid = (
        ctx.db.query("SELECT ulid FROM messages WHERE id = $id").get({ id: row.message_id }) as
          | { ulid: string }
          | null
      )?.ulid;
      return toCheckpointDto(row, sceneRow.ulid, messageUlid ?? "");
    });
  }

  /**
   * Resolve an optional external identifier to an internal one. Returns null for
   * an explicit null, undefined when the field is absent, and INVALID when the
   * value names something that does not exist.
   */
  function resolveRef(
    value: unknown,
    table: "presets" | "connection_profiles" | "authors" | "personas",
  ): number | null | typeof INVALID {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") return INVALID;
    const row = ctx.db.query(`SELECT id FROM ${table} WHERE ulid = $ulid`).get({ ulid: value }) as
      | { id: number }
      | null;
    return row === null ? INVALID : row.id;
  }

  return app;
}

const INVALID = Symbol("invalid reference");
