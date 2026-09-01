import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import { activePath, findScene, speakerLookup, type SceneRow } from "../db/queries/history.ts";
import {
  findCharacter,
  insertCharacter,
  toCharacterDto,
  toNormalisedCard,
  updateCharacter,
  type CharacterRow,
} from "../db/queries/characters.ts";
import { buildCardDocument } from "../cards/index.ts";
import { findEntry, toEntryDto, updateEntry } from "../db/queries/lore.ts";
import type { TaskRunner } from "../tasks/runner.ts";
import {
  CREATE_CHARACTER,
  EXTRACT_CHARACTER,
  REVISE_CHARACTER,
  REVISE_LORE,
  SUGGEST_LORE,
  SUGGEST_VOICE,
  taskKind,
} from "../tasks/registry.ts";
import {
  buildCreateCharacterPrompt,
  buildExtractCharacterPrompt,
  buildReviseCharacterPrompt,
  buildReviseLorePrompt,
  buildSuggestLorePrompt,
  buildVoiceNotesPrompt,
  parseCreateCharacter,
  parseExtractCharacter,
  parseLoreProposals,
  parseReviseCharacter,
  parseReviseLore,
  parseVoiceNotes,
  type AuthoringCard,
} from "../generation/authoring.ts";
import { createEstimatingTokenizer } from "../prompt/index.ts";
import type { BuiltPrompt } from "../prompt/index.ts";

/**
 * AI-assisted authoring (SPEC §9, §20 phase 27).
 *
 * Six tasks, one door. Each produces a structured record — a card, a patch, a
 * proposal — and the schema is enforced here, not in the model: a reply that
 * cannot be read is a 422 with the reason, never a card assembled from
 * whatever the JSON happened to contain. The routes are thin because the
 * prompts and parsers are pure and live in `/generation/authoring`.
 */

function badRequest(message: string) {
  return { error: { code: "bad_request", message } } as const;
}

function unreadable(problem: string) {
  return { error: { code: "unreadable", message: problem } } as const;
}

/** The scene's history as a labelled transcript, or null for an empty scene. */
function transcriptOf(db: import("bun:sqlite").Database, sceneId: number): string | null {
  const path = activePath(db, sceneId);
  if (path.length === 0) return null;
  const speakers = speakerLookup(db);
  const lines = path
    .filter((row) => row.is_hidden === 0)
    .map((row) => {
      const speaker =
        row.character_id === null
          ? row.author_type === "user"
            ? "The reader"
            : "Narration"
          : (speakers.nameById.get(row.character_id) ?? "Someone");
      return `${speaker}: ${row.content}`;
    });
  return lines.length === 0 ? null : lines.join("\n");
}

/** A card into the shape `insertCharacter` wants — voice notes travel separately. */
function normalisedCardOf(card: AuthoringCard) {
  return {
    name: card.name,
    description: card.description,
    personality: card.personality,
    scenario: card.scenario,
    firstMessage: card.firstMessage,
    alternateGreetings: [],
    groupGreetings: [],
    exampleDialogue: card.exampleDialogue,
    systemPrompt: null,
    postHistoryInstructions: null,
    creatorNotes: card.creatorNotes,
    tags: card.tags,
    creator: null,
    characterVersion: null,
    depthPrompt: null,
    depthPromptDepth: 4,
    depthPromptRole: "system" as const,
    extensions: {},
  };
}

export function authoringRoutes(ctx: AppContext, tasks: TaskRunner): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());
  const tokenizer = createEstimatingTokenizer();

  /** Run one authoring task, routing by scene profile where there is a scene. */
  async function run(
    kindKey: string,
    prompt: BuiltPrompt,
    scene: SceneRow | null,
  ): Promise<{ ok: true; text: string } | { ok: false; detail: string }> {
    const kind = taskKind(kindKey)!;
    const outcome = await tasks.run({
      kind,
      sceneId: scene?.id ?? null,
      profileId: null,
      fallbackProfileId: scene?.connection_profile_id ?? defaultProfileId(),
      prompt,
    });
    if (!outcome.ok) return { ok: false, detail: outcome.detail };
    return { ok: true, text: outcome.text };
  }

  function defaultProfileId(): number | null {
    const row = ctx.db
      .query("SELECT id FROM connection_profiles ORDER BY is_default DESC, id LIMIT 1")
      .get() as { id: number } | null;
    return row?.id ?? null;
  }

  /* ---------------- create ---------------- */

  app.post("/characters", async (c) => {
    let body: { description?: unknown; sceneId?: unknown } = {};
    try {
      body = (await c.req.json()) as { description?: unknown; sceneId?: unknown };
    } catch {
      /* Handled by the emptiness check. */
    }
    if (typeof body.description !== "string" || body.description.trim() === "") {
      return c.json(badRequest("A description is required."), 400);
    }

    let scene: SceneRow | null = null;
    let transcript: string | null = null;
    if (typeof body.sceneId === "string") {
      const found = findScene(ctx.db, body.sceneId);
      if (found === null) return c.json(badRequest("No such scene."), 404);
      scene = found;
      transcript = transcriptOf(ctx.db, found.id);
    }

    const ran = await run(
      CREATE_CHARACTER,
      buildCreateCharacterPrompt({ description: body.description.trim(), transcript }, tokenizer),
      scene,
    );
    if (!ran.ok) return c.json({ error: { code: "unavailable", message: ran.detail } }, 502);

    const parsed = parseCreateCharacter(ran.text);
    if (!parsed.ok) return c.json(unreadable(parsed.problem), 422);

    const card = normalisedCardOf(parsed.card);
    const row = insertCharacter(ctx.db, {
      card,
      rawCard: buildCardDocument(card, null),
      format: "native",
      avatarPath: null,
      sourceFilename: null,
      sourceHash: null,
      voiceNotes: parsed.card.voiceNotes,
    });
    return c.json(toCharacterDto(ctx.db, row), 201);
  });

  /* ---------------- revise ---------------- */

  app.post("/characters/:characterId/revise", async (c) => {
    const row = findCharacter(ctx.db, c.req.param("characterId"));
    if (row === null) {
      return c.json({ error: { code: "not_found", message: "No such character." } }, 404);
    }
    let instructions = "";
    try {
      const body = (await c.req.json()) as { instructions?: unknown };
      if (typeof body.instructions === "string") instructions = body.instructions.trim();
    } catch {
      /* Handled by the emptiness check. */
    }
    if (instructions === "") return c.json(badRequest("Say what to change."), 400);

    const ran = await run(
      REVISE_CHARACTER,
      buildReviseCharacterPrompt({ card: cardOf(row), instructions }, tokenizer),
      null,
    );
    if (!ran.ok) return c.json({ error: { code: "unavailable", message: ran.detail } }, 502);

    const parsed = parseReviseCharacter(ran.text);
    if (!parsed.ok) return c.json(unreadable(parsed.problem), 422);

    // Only the fields the model named are patched — everything else stays as
    // it was, which is the "preserving the rest" half of the spec.
    const patch: Record<string, unknown> = {};
    const card = parsed.card;
    if (card.name !== "") patch.name = card.name;
    if (card.description !== null) patch.description = card.description;
    if (card.personality !== null) patch.personality = card.personality;
    if (card.scenario !== null) patch.scenario = card.scenario;
    if (card.firstMessage !== null) patch.firstMessage = card.firstMessage;
    if (card.exampleDialogue !== null) patch.exampleDialogue = card.exampleDialogue;
    if (card.creatorNotes !== null) patch.creatorNotes = card.creatorNotes;
    if (card.tags.length > 0) patch.tags = card.tags;
    if (card.voiceNotes !== null) patch.voiceNotes = card.voiceNotes;
    if (Object.keys(patch).length === 0) {
      return c.json(unreadable("The reply changed nothing."), 422);
    }

    return c.json(toCharacterDto(ctx.db, updateCharacter(ctx.db, row.id, patch)));
  });

  /* ---------------- voice notes ---------------- */

  app.post("/characters/:characterId/voice-notes", async (c) => {
    const row = findCharacter(ctx.db, c.req.param("characterId"));
    if (row === null) {
      return c.json({ error: { code: "not_found", message: "No such character." } }, 404);
    }
    const ran = await run(
      SUGGEST_VOICE,
      buildVoiceNotesPrompt({ card: cardOf(row), dialogue: null }, tokenizer),
      null,
    );
    if (!ran.ok) return c.json({ error: { code: "unavailable", message: ran.detail } }, 502);
    const parsed = parseVoiceNotes(ran.text);
    if (!parsed.ok) return c.json(unreadable(parsed.problem), 422);
    return c.json({ voiceNotes: parsed.voiceNotes });
  });

  /* ---------------- extract ---------------- */

  app.post("/scenes/:sceneId/extract-character", async (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }
    let name = "A character from this scene";
    try {
      const body = (await c.req.json()) as { name?: unknown };
      if (typeof body.name === "string" && body.name.trim() !== "") name = body.name.trim();
    } catch {
      /* The default name stands. */
    }
    const transcript = transcriptOf(ctx.db, scene.id);
    if (transcript === null) return c.json(badRequest("The scene has no history to read."), 400);

    const ran = await run(
      EXTRACT_CHARACTER,
      buildExtractCharacterPrompt({ transcript, name }, tokenizer),
      scene,
    );
    if (!ran.ok) return c.json({ error: { code: "unavailable", message: ran.detail } }, 502);

    const parsed = parseExtractCharacter(ran.text);
    if (!parsed.ok) return c.json(unreadable(parsed.problem), 422);

    const card = normalisedCardOf(parsed.card);
    const row = insertCharacter(ctx.db, {
      card,
      rawCard: buildCardDocument(card, null),
      format: "native",
      avatarPath: null,
      sourceFilename: null,
      sourceHash: null,
      voiceNotes: parsed.card.voiceNotes,
    });
    return c.json(toCharacterDto(ctx.db, row), 201);
  });

  /* ---------------- suggest lore ---------------- */

  app.post("/scenes/:sceneId/suggest-lore", async (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }
    const transcript = transcriptOf(ctx.db, scene.id);
    if (transcript === null) return c.json(badRequest("The scene has no history to read."), 400);

    const ran = await run(
      SUGGEST_LORE,
      buildSuggestLorePrompt({ transcript }, tokenizer),
      scene,
    );
    if (!ran.ok) return c.json({ error: { code: "unavailable", message: ran.detail } }, 502);
    const parsed = parseLoreProposals(ran.text);
    if (!parsed.ok) return c.json(unreadable(parsed.problem), 422);
    return c.json({ entries: parsed.entries });
  });

  /* ---------------- revise lore ---------------- */

  app.post("/lore/:entryId/revise", async (c) => {
    const entry = findEntry(ctx.db, c.req.param("entryId"));
    if (entry === null) {
      return c.json({ error: { code: "not_found", message: "No such lore entry." } }, 404);
    }
    let scene: SceneRow | null = null;
    let transcript: string | null = null;
    try {
      const body = (await c.req.json()) as { sceneId?: unknown };
      if (typeof body.sceneId === "string") {
        const found = findScene(ctx.db, body.sceneId);
        if (found !== null) {
          scene = found;
          transcript = transcriptOf(ctx.db, found.id);
        }
      }
    } catch {
      /* No scene context is acceptable: the entry is cleaned up, not updated. */
    }

    const current = {
      title: entry.title,
      content: entry.content,
      keys: parseArray(entry.keys),
    };
    const ran = await run(
      REVISE_LORE,
      buildReviseLorePrompt({ entry: current, transcript: transcript ?? "" }, tokenizer),
      scene,
    );
    if (!ran.ok) return c.json({ error: { code: "unavailable", message: ran.detail } }, 502);
    const parsed = parseReviseLore(ran.text);
    if (!parsed.ok) return c.json(unreadable(parsed.problem), 422);

    const updated = updateEntry(ctx.db, entry.id, {
      title: parsed.entry.title,
      content: parsed.entry.content,
      keys: JSON.stringify(parsed.entry.keys),
    });
    const book = ctx.db.query("SELECT ulid FROM lorebooks WHERE id = $id").get({ id: entry.lorebook_id }) as
      | { ulid: string }
      | null;
    return c.json(toEntryDto(updated, book?.ulid ?? ""));
  });

  return app;
}

function cardOf(row: CharacterRow): AuthoringCard {
  return {
    name: row.name,
    description: row.description,
    personality: row.personality,
    scenario: row.scenario,
    firstMessage: row.first_message,
    exampleDialogue: row.example_dialogue,
    creatorNotes: row.creator_notes,
    tags: parseArray(row.tags),
    voiceNotes: row.voice_notes,
  };
}

function parseArray(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}
