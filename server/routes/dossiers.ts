import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import { findScene } from "../db/queries/history.ts";
import {
  deleteDossier,
  dossierBody,
  findDossier,
  findDossierByName,
  insertDossier,
  listDossiers,
  parseKnowledge,
  updateDossier,
  type DossierRow,
} from "../db/queries/dossiers.ts";
import { insertCharacter, toCharacterDto } from "../db/queries/characters.ts";
import { findEntryById, toEntryDto } from "../db/queries/lore.ts";
import { buildCardDocument } from "../cards/index.ts";

/**
 * Character dossiers (SPEC §11, §20 phase 32).
 *
 * The dossier is the editable truth and the lore entry is how it reaches a
 * prompt, so every write here goes through the storage layer's render step
 * rather than touching the entry — otherwise the two halves drift and the
 * reader edits one while the model reads the other.
 */

function badRequest(message: string) {
  return { error: { code: "bad_request", message } };
}

function notFound(what: string) {
  return { error: { code: "not_found", message: `No such ${what}.` } };
}

function text(value: unknown, max = 4_000): string | undefined {
  return typeof value === "string" ? value.slice(0, max) : undefined;
}

export function toDossierDto(ctx: AppContext, row: DossierRow) {
  const entry = row.lore_entry_id === null ? null : findEntryById(ctx.db, row.lore_entry_id);
  return {
    id: row.ulid,
    name: row.name,
    role: row.role,
    voice: row.voice,
    canonLock: row.canon_lock,
    knowledge: parseKnowledge(row.knowledge),
    standing: row.standing,
    mentions: row.mentions,
    promoted: row.promoted_character_id !== null,
    /** What the prompt actually gets, so the reader can see the buried tier is absent. */
    injected: dossierBody(row),
    /** The entry it renders into, for the activation trace and the token cost. */
    entry: entry === null ? null : toEntryDto(entry, ""),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function dossierRoutes(ctx: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  async function body(c: { req: { json(): Promise<unknown> } }): Promise<Record<string, unknown>> {
    try {
      const parsed: unknown = await c.req.json();
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  app.get("/scenes/:sceneId", (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) return c.json(notFound("scene"), 404);
    return c.json(listDossiers(ctx.db, scene.id).map((row) => toDossierDto(ctx, row)));
  });

  /** Accept a proposal, or write one by hand. */
  app.post("/scenes/:sceneId", async (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) return c.json(notFound("scene"), 404);
    const input = await body(c);
    const name = text(input["name"], 120)?.trim() ?? "";
    if (name === "") return c.json(badRequest("A dossier needs a name."), 400);
    // One per name per scene: two rows for the same innkeeper would both render
    // entries, and the reader would edit one and be confused by the other.
    if (findDossierByName(ctx.db, scene.id, name) !== null) {
      return c.json(badRequest(`${name} already has a dossier in this roleplay.`), 409);
    }

    const knowledge = (input["knowledge"] ?? {}) as Record<string, unknown>;
    const row = insertDossier(ctx.db, scene.id, {
      name,
      ...(text(input["role"]) === undefined ? {} : { role: text(input["role"])! }),
      ...(text(input["voice"]) === undefined ? {} : { voice: text(input["voice"])! }),
      ...(text(input["canonLock"]) === undefined ? {} : { canonLock: text(input["canonLock"])! }),
      ...(text(input["standing"]) === undefined ? {} : { standing: text(input["standing"])! }),
      knowledge: {
        public: text(knowledge["public"]) ?? "",
        private: text(knowledge["private"]) ?? "",
        buried: text(knowledge["buried"]) ?? "",
      },
      ...(typeof input["mentions"] === "number" ? { mentions: input["mentions"] } : {}),
    });
    return c.json(toDossierDto(ctx, row), 201);
  });

  app.patch("/:dossierId", async (c) => {
    const row = findDossier(ctx.db, c.req.param("dossierId"));
    if (row === null) return c.json(notFound("dossier"), 404);
    const input = await body(c);
    const knowledge = (input["knowledge"] ?? undefined) as Record<string, unknown> | undefined;

    const updated = updateDossier(ctx.db, row.id, {
      ...(text(input["name"], 120) === undefined ? {} : { name: text(input["name"], 120)!.trim() }),
      ...(text(input["role"]) === undefined ? {} : { role: text(input["role"])! }),
      ...(text(input["voice"]) === undefined ? {} : { voice: text(input["voice"])! }),
      ...(text(input["canonLock"]) === undefined ? {} : { canonLock: text(input["canonLock"])! }),
      ...(text(input["standing"]) === undefined ? {} : { standing: text(input["standing"])! }),
      ...(knowledge === undefined
        ? {}
        : {
            knowledge: {
              ...(text(knowledge["public"]) === undefined
                ? {}
                : { public: text(knowledge["public"])! }),
              ...(text(knowledge["private"]) === undefined
                ? {}
                : { private: text(knowledge["private"])! }),
              ...(text(knowledge["buried"]) === undefined
                ? {}
                : { buried: text(knowledge["buried"])! }),
            },
          }),
    });
    return c.json(toDossierDto(ctx, updated));
  });

  app.delete("/:dossierId", (c) => {
    const row = findDossier(ctx.db, c.req.param("dossierId"));
    if (row === null) return c.json(notFound("dossier"), 404);
    deleteDossier(ctx.db, row.id);
    return c.json({ ok: true });
  });

  /**
   * Promote a dossier to a character card (§11: "when they earn it").
   *
   * The fields map onto the card rather than being pasted into one blob: role
   * becomes the description, voice becomes the voice notes, and the canon lock
   * and the tiers become personality — the part of a card that is *about* the
   * character rather than how they sound. The buried tier travels too, because
   * a card is the author's own reference and withholding it there would lose
   * the only copy.
   *
   * The dossier stays, disabled, as the record of where the character came
   * from. Deleting it would take the entry with it and leave no trace that this
   * person was ever an accident.
   */
  app.post("/:dossierId/promote", (c) => {
    const row = findDossier(ctx.db, c.req.param("dossierId"));
    if (row === null) return c.json(notFound("dossier"), 404);
    if (row.promoted_character_id !== null) {
      return c.json(badRequest("That dossier is already a character."), 409);
    }

    const knowledge = parseKnowledge(row.knowledge);
    const personality = [
      row.canon_lock.trim() === "" ? null : `Established and not to be contradicted: ${row.canon_lock.trim()}`,
      knowledge.public.trim() === "" ? null : `Known publicly: ${knowledge.public.trim()}`,
      knowledge.private.trim() === "" ? null : `Knows but does not volunteer: ${knowledge.private.trim()}`,
      knowledge.buried.trim() === "" ? null : `Hiding: ${knowledge.buried.trim()}`,
      row.standing.trim() === "" ? null : `With the reader: ${row.standing.trim()}`,
    ]
      .filter((line): line is string => line !== null)
      .join("\n");

    const card = {
      name: row.name,
      description: row.role,
      personality,
      scenario: null,
      firstMessage: null,
      alternateGreetings: [],
      groupGreetings: [],
      exampleDialogue: null,
      systemPrompt: null,
      postHistoryInstructions: null,
      creatorNotes: "Promoted from a dossier written during play.",
      tags: [],
      creator: null,
      characterVersion: null,
      depthPrompt: null,
      depthPromptDepth: 4,
      depthPromptRole: "system" as const,
      extensions: {},
    };
    const character = insertCharacter(ctx.db, {
      card,
      rawCard: buildCardDocument(card, null),
      format: "native",
      avatarPath: null,
      sourceFilename: null,
      sourceHash: null,
      voiceNotes: row.voice,
    });

    const updated = updateDossier(ctx.db, row.id, { promotedCharacterId: character.id });
    return c.json({
      character: toCharacterDto(ctx.db, character),
      dossier: toDossierDto(ctx, updated),
    });
  });

  return app;
}
