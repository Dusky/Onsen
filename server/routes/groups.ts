import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import { badRequest, notFound, requiredText, body } from "../lib/routes.ts";
import {
  addGroupMember,
  deleteCharacterGroup,
  findCharacterGroup,
  insertCharacterGroup,
  listCharacterGroups,
  removeGroupMember,
  toGroupDto,
  updateCharacterGroup,
} from "../db/queries/groups.ts";
import { findCharacter, type CharacterRow } from "../db/queries/characters.ts";
import { bind, findLorebook } from "../db/queries/lore.ts";
import { insertScene, sceneDto } from "../db/queries/history.ts";
import { addSceneMember } from "../db/queries/authors.ts";
import { seedGreeting } from "../scenes/greeting.ts";

/**
 * Character groups (SPEC §9, §20 phase 158).
 *
 * A named roster plus an optional lorebook. The list and membership endpoints
 * serve the editor; `start` turns the roster into a scene in one request, which
 * is the point of the feature.
 */

const MAX_NAME = 200;

export function groupRoutes(ctx: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  function group(value: string) {
    return findCharacterGroup(ctx.db, value);
  }

  app.get("/", (c) => c.json(listCharacterGroups(ctx.db)));

  app.post("/", async (c) => {
    const input = await body(c);
    const name = requiredText(input["name"], MAX_NAME);
    if (name === null) return c.json(badRequest("The group needs a name."), 400);

    let lorebookId: number | null = null;
    if (input["lorebookId"] !== undefined && input["lorebookId"] !== null) {
      const book = typeof input["lorebookId"] === "string" ? findLorebook(ctx.db, input["lorebookId"]) : null;
      if (book === null) return c.json(badRequest("No such lorebook."), 400);
      lorebookId = book.id;
    }

    const row = insertCharacterGroup(ctx.db, { name, lorebookId });
    return c.json(toGroupDto(ctx.db, row), 201);
  });

  app.patch("/:id", async (c) => {
    const row = group(c.req.param("id"));
    if (row === null) return c.json(notFound("group"), 404);

    const input = await body(c);
    const patch: { name?: string; lorebookId?: number | null } = {};

    if ("name" in input) {
      const name = requiredText(input["name"], MAX_NAME);
      if (name === null) return c.json(badRequest("The group needs a name."), 400);
      patch.name = name;
    }
    if ("lorebookId" in input) {
      const value = input["lorebookId"];
      if (value === null) {
        patch.lorebookId = null;
      } else if (typeof value === "string") {
        const book = findLorebook(ctx.db, value);
        if (book === null) return c.json(badRequest("No such lorebook."), 400);
        patch.lorebookId = book.id;
      } else {
        return c.json(badRequest("lorebookId is a lorebook id or null."), 400);
      }
    }

    return c.json(toGroupDto(ctx.db, updateCharacterGroup(ctx.db, row.id, patch)));
  });

  app.delete("/:id", (c) => {
    const row = group(c.req.param("id"));
    if (row === null) return c.json(notFound("group"), 404);
    deleteCharacterGroup(ctx.db, row.id);
    return c.json({ ok: true });
  });

  app.put("/:id/characters/:characterId", (c) => {
    const row = group(c.req.param("id"));
    if (row === null) return c.json(notFound("group"), 404);
    const character = findCharacter(ctx.db, c.req.param("characterId"));
    if (character === null) return c.json(notFound("character"), 404);
    addGroupMember(ctx.db, row.id, character.id);
    return c.json(toGroupDto(ctx.db, findCharacterGroup(ctx.db, row.ulid)!));
  });

  app.delete("/:id/characters/:characterId", (c) => {
    const row = group(c.req.param("id"));
    if (row === null) return c.json(notFound("group"), 404);
    const character = findCharacter(ctx.db, c.req.param("characterId"));
    if (character === null) return c.json(notFound("character"), 404);
    removeGroupMember(ctx.db, row.id, character.id);
    return c.json(toGroupDto(ctx.db, findCharacterGroup(ctx.db, row.ulid)!));
  });

  /** The whole point: a roster becomes a roleplay, cast and lore in one tap. */
  app.post("/:id/start", (c) => {
    const row = group(c.req.param("id"));
    if (row === null) return c.json(notFound("group"), 404);

    const members = ctx.db
      .query(
        `SELECT m.character_id, c.ulid FROM character_group_members m
           JOIN characters c ON c.id = m.character_id
          WHERE m.group_id = $groupId ORDER BY m.display_order, m.character_id`,
      )
      .all({ groupId: row.id }) as { character_id: number; ulid: string }[];
    if (members.length === 0) return c.json(badRequest("The group has no characters."), 400);

    const sceneRow = insertScene(ctx.db, { title: row.name });
    let opener: CharacterRow | null = null;
    members.forEach((member, index) => {
      addSceneMember(ctx.db, sceneRow.id, member.character_id);
      if (index === 0) opener = findCharacter(ctx.db, member.ulid);
    });
    if (opener !== null) seedGreeting(ctx.db, sceneRow.id, opener);

    if (row.lorebook_id !== null) bind(ctx.db, row.lorebook_id, "scene", sceneRow.id);

    return c.json(sceneDto(ctx.db, sceneRow), 201);
  });

  return app;
}
