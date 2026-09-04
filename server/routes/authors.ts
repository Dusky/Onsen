import { Hono } from "hono";
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
  toAuthorDto,
  toPersonaDto,
  updateAuthor,
  updatePersona,
} from "../db/queries/authors.ts";
import { ensureMemoryBook } from "../memory/author.ts";
import type { UpdateAuthorRequest, UpdatePersonaRequest } from "../../shared/types.ts";

/**
 * Authors and personas (SPEC §2, §20 phase 7).
 *
 * Two small resources with the same shape, kept in one module because they are
 * two halves of one relationship: the author writes everyone except the
 * persona, and that rule is the most important line in the system prompt.
 */

function badRequest(message: string) {
  return { error: { code: "bad_request", message } } as const;
}

function notFound(what: string) {
  return { error: { code: "not_found", message: `No such ${what}.` } } as const;
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
    deletePersona(ctx.db, row.id);
    return c.body(null, 204);
  });

  return app;
}
