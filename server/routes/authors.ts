import { Hono } from "hono";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import {
  deleteAuthor,
  deletePersona,
  findAuthor,
  findPersona,
  insertAuthor,
  insertPersona,
  listAuthors,
  listPersonas,
  setAvatarPath,
  toAuthorDto,
  toPersonaDto,
  updateAuthor,
  updatePersona,
  type AuthorRow,
  type PersonaRow,
} from "../db/queries/authors.ts";
import { ulid } from "../lib/ulid.ts";
import { ensureMemoryBook } from "../memory/author.ts";
import type { UpdateAuthorRequest, UpdatePersonaRequest } from "../../shared/types.ts";
import { badRequest, notFound } from "../lib/routes.ts";

/**
 * Authors and personas (SPEC §2, §20 phase 7).
 *
 * Two small resources with the same shape, kept in one module because they are
 * two halves of one relationship: the author writes everyone except the
 * persona, and that rule is the most important line in the system prompt.
 */

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  const extension = dot === -1 ? "png" : name.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(extension) ? extension : "png";
}

/**
 * Serve, set and clear the avatar of an author or a persona (§20 phase 61).
 *
 * `avatar_path` has been on both tables since migration 0005 and nothing has
 * ever written or read either one — the pair `dead-columns` cannot see, because
 * it matches a column *name* and `characters.avatar_path` is read constantly.
 * A card brings a character's picture with it; nobody ever brings one for the
 * reader, so these two needed an upload rather than an importer, and that is
 * the whole reason they went unbuilt.
 *
 * Written once for both because the column, the directory and the lifetime are
 * identical. `table` is a literal union, never a request value.
 */
function mountAvatar<Row extends { id: number; ulid: string; avatar_path: string | null }>(
  app: Hono<AppEnv>,
  ctx: AppContext,
  table: "personas" | "authors",
  find: (value: string) => Row | null,
  toDto: (row: Row) => unknown,
) {
  const fileOf = (row: Row) =>
    row.avatar_path === null ? null : join(ctx.config.avatarsDir, row.avatar_path);

  app.get("/:id/avatar", async (c) => {
    const row = find(c.req.param("id"));
    const path = row === null ? null : fileOf(row);
    if (path === null) return c.json(notFound(table === "personas" ? "persona" : "author"), 404);
    const file = Bun.file(path);
    if (!(await file.exists())) return c.json(notFound("avatar"), 404);
    // Named with a ULID per upload, so replacing one changes the URL and no
    // cache has to be told anything.
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    return c.body(file.stream(), 200, { "Content-Type": file.type });
  });

  app.put("/:id/avatar", async (c) => {
    const row = find(c.req.param("id"));
    if (row === null) return c.json(notFound(table === "personas" ? "persona" : "author"), 404);

    let file: File | null = null;
    try {
      const candidate = (await c.req.formData()).get("file");
      if (candidate instanceof File) file = candidate;
    } catch {
      return c.json(badRequest("Expected an image."), 400);
    }
    if (file === null) return c.json(badRequest("No image was uploaded."), 400);
    if (file.size > 8 * 1024 * 1024) return c.json(badRequest("That image is too large."), 413);

    const previous = fileOf(row);
    const path = `${table}-${row.id}-${ulid()}.${extensionOf(file.name)}`;
    await Bun.write(join(ctx.config.avatarsDir, path), new Uint8Array(await file.arrayBuffer()));
    setAvatarPath(ctx.db, table, row.id, path);
    // After the write, so a failed upload leaves the old picture in place
    // rather than nothing at all.
    if (previous !== null) removeQuietly(previous);

    const updated = find(row.ulid);
    return c.json(updated === null ? null : toDto(updated));
  });

  app.delete("/:id/avatar", (c) => {
    const row = find(c.req.param("id"));
    if (row === null) return c.json(notFound(table === "personas" ? "persona" : "author"), 404);
    const path = fileOf(row);
    setAvatarPath(ctx.db, table, row.id, null);
    if (path !== null) removeQuietly(path);
    const updated = find(row.ulid);
    return c.json(updated === null ? null : toDto(updated));
  });
}

/** A picture two records shared, or one already gone, is not an error here. */
function removeQuietly(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    /* nothing to remove */
  }
}

async function readName(c: { req: { json: () => Promise<unknown> } }, fallback: string) {
  try {
    const body = (await c.req.json()) as { name?: unknown };
    return typeof body.name === "string" && body.name.trim() !== "" ? body.name.trim() : fallback;
  } catch {
    return fallback;
  }
}

export function authorRoutes(ctx: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  app.get("/", (c) => c.json(listAuthors(ctx.db).map(toAuthorDto)));

  app.post("/", async (c) => {
    const name = await readName(c, "New author");
    return c.json(toAuthorDto(insertAuthor(ctx.db, name)), 201);
  });

  app.get("/:authorId", (c) => {
    const row = findAuthor(ctx.db, c.req.param("authorId"));
    return row === null ? c.json(notFound("author"), 404) : c.json(toAuthorDto(row));
  });

  app.patch("/:authorId", async (c) => {
    const row = findAuthor(ctx.db, c.req.param("authorId"));
    if (row === null) return c.json(notFound("author"), 404);

    let patch: UpdateAuthorRequest;
    try {
      patch = (await c.req.json()) as UpdateAuthorRequest;
    } catch {
      return c.json(badRequest("Expected a JSON body."), 400);
    }
    if (typeof patch !== "object" || patch === null) {
      return c.json(badRequest("Expected a JSON object."), 400);
    }
    if ("name" in patch && (typeof patch.name !== "string" || patch.name.trim() === "")) {
      return c.json(badRequest("An author needs a name."), 400);
    }

    const updated = updateAuthor(ctx.db, row.id, { ...patch });
    // §11: switching memory on is what makes the book, rather than the first
    // note. The reader has to be able to see the token cap and the link to the
    // entries before there is anything in them — and a budget of 0 shown for a
    // book that does not exist yet reads as "uncapped", which is its opposite.
    if (patch.memoryEnabled === true) ensureMemoryBook(ctx.db, updated);
    return c.json(toAuthorDto(updated));
  });

  app.delete("/:authorId", (c) => {
    const row = findAuthor(ctx.db, c.req.param("authorId"));
    if (row === null) return c.json(notFound("author"), 404);
    // Scenes keep their history; they simply fall back to single-character
    // mode, which is what a null author means (SPEC §3).
    deleteAuthor(ctx.db, row.id);
    return c.body(null, 204);
  });

  mountAvatar<AuthorRow>(app, ctx, "authors", (value) => findAuthor(ctx.db, value), toAuthorDto);

  return app;
}

export function personaRoutes(ctx: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  app.get("/", (c) => c.json(listPersonas(ctx.db).map(toPersonaDto)));

  app.post("/", async (c) => {
    const name = await readName(c, "You");
    return c.json(toPersonaDto(insertPersona(ctx.db, name)), 201);
  });

  app.patch("/:personaId", async (c) => {
    const row = findPersona(ctx.db, c.req.param("personaId"));
    if (row === null) return c.json(notFound("persona"), 404);

    let patch: UpdatePersonaRequest;
    try {
      patch = (await c.req.json()) as UpdatePersonaRequest;
    } catch {
      return c.json(badRequest("Expected a JSON body."), 400);
    }
    if ("name" in patch && (typeof patch.name !== "string" || patch.name.trim() === "")) {
      return c.json(badRequest("A persona needs a name."), 400);
    }

    return c.json(toPersonaDto(updatePersona(ctx.db, row.id, { ...patch })));
  });

  app.delete("/:personaId", (c) => {
    const row = findPersona(ctx.db, c.req.param("personaId"));
    if (row === null) return c.json(notFound("persona"), 404);
    const path = row.avatar_path;
    deletePersona(ctx.db, row.id);
    if (path !== null) removeQuietly(join(ctx.config.avatarsDir, path));
    return c.body(null, 204);
  });

  mountAvatar<PersonaRow>(app, ctx, "personas", (value) => findPersona(ctx.db, value), toPersonaDto);

  return app;
}
