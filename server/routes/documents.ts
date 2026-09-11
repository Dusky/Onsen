import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import {
  deleteDocument,
  findDocument,
  ingestDocument,
  listDocuments,
  retrieve,
  type DocumentRow,
} from "../documents/store.ts";
import { findScene } from "../db/queries/history.ts";
import { extractDocumentText, stripExtension } from "../documents/extract.ts";
import type { DocumentDto } from "../../shared/types.ts";
import { badRequest } from "../lib/routes.ts";

/**
 * The data bank (SPEC §11, §20 phase 30): documents, chunked and embedded,
 * recalled into the prompt by similarity. Retrieval is offered as an explicit
 * test tool too, the same way §16's lore test shows what would fire — the
 * difference between "the model never saw it" and "the model ignored it" is
 * the inspector's whole reason to exist.
 */

function documentDto(db: import("bun:sqlite").Database, row: DocumentRow): DocumentDto {
  const count = db
    .query("SELECT COUNT(*) AS n FROM document_chunks WHERE document_id = $id")
    .get({ id: row.id }) as { n: number };
  return {
    id: row.ulid,
    sceneId: row.scene_id === null ? null : sceneUlid(db, row.scene_id),
    title: row.title,
    chunkCount: count.n,
    createdAt: row.created_at,
  };
}

function sceneUlid(db: import("bun:sqlite").Database, id: number): string {
  return (db.query("SELECT ulid FROM scenes WHERE id = $id").get({ id }) as { ulid: string }).ulid;
}

export function documentRoutes(ctx: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  app.get("/", (c) => {
    const sceneId = c.req.query("sceneId");
    let scene: number | null = null;
    if (sceneId !== undefined) {
      const row = findScene(ctx.db, sceneId);
      if (row === null) return c.json(badRequest("No such scene."), 404);
      scene = row.id;
    }
    return c.json(listDocuments(ctx.db, scene).map((row) => documentDto(ctx.db, row)));
  });

  /** Ingest a document: chunk, embed, store. */
  app.post("/", async (c) => {
    let body: { title?: unknown; text?: unknown; sceneId?: unknown } = {};
    try {
      body = (await c.req.json()) as { title?: unknown; text?: unknown; sceneId?: unknown };
    } catch {
      return c.json(badRequest("Expected a JSON body."), 400);
    }
    if (typeof body.title !== "string" || body.title.trim() === "") {
      return c.json(badRequest("A document needs a title."), 400);
    }
    if (typeof body.text !== "string" || body.text.trim() === "") {
      return c.json(badRequest("A document needs text."), 400);
    }

    let sceneId: number | null = null;
    if (body.sceneId !== undefined && body.sceneId !== null) {
      if (typeof body.sceneId !== "string") return c.json(badRequest("A sceneId is a string."), 400);
      const scene = findScene(ctx.db, body.sceneId);
      if (scene === null) return c.json(badRequest("No such scene."), 404);
      sceneId = scene.id;
    }

    const row = await ingestDocument(ctx.db, ctx.keyring, {
      title: body.title.trim(),
      text: body.text,
      sceneId,
    });
    return c.json(documentDto(ctx.db, row), 201);
  });

  /**
   * Ingest a file: txt, markdown or PDF (§20 phase 156). The bytes are read
   * and the text extracted before the ordinary ingest path chunks and embeds
   * it, so a file and a pasted document are one thing after the first step.
   */
  app.post("/file", async (c) => {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return c.json(badRequest("A file is required."), 400);

    const titleField = form.get("title");
    const title =
      typeof titleField === "string" && titleField.trim() !== ""
        ? titleField.trim()
        : stripExtension(file.name);
    if (title === "") return c.json(badRequest("That file has no name to title itself with."), 400);

    let sceneId: number | null = null;
    const sceneField = form.get("sceneId");
    if (sceneField !== null && sceneField !== "") {
      const scene = findScene(ctx.db, String(sceneField));
      if (scene === null) return c.json(badRequest("No such scene."), 404);
      sceneId = scene.id;
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = await extractDocumentText(file.name, bytes);
    if (text === null || text.trim() === "") {
      return c.json(badRequest("That file has no readable text."), 400);
    }

    const row = await ingestDocument(ctx.db, ctx.keyring, { title, text, sceneId });
    return c.json(documentDto(ctx.db, row), 201);
  });

  app.delete("/:documentId", (c) => {
    const row = findDocument(ctx.db, c.req.param("documentId"));
    if (row === null) {
      return c.json({ error: { code: "not_found", message: "No such document." } }, 404);
    }
    deleteDocument(ctx.db, row.id);
    return c.body(null, 204);
  });

  /** The activation-test tool: what would be recalled for a query right now. */
  app.post("/retrieve", async (c) => {
    let body: { sceneId?: unknown; query?: unknown; topK?: unknown } = {};
    try {
      body = (await c.req.json()) as { sceneId?: unknown; query?: unknown; topK?: unknown };
    } catch {
      return c.json(badRequest("Expected a JSON body."), 400);
    }
    if (typeof body.query !== "string" || body.query.trim() === "") {
      return c.json(badRequest("A query is required."), 400);
    }
    let sceneId: number | null = null;
    if (typeof body.sceneId === "string") {
      const scene = findScene(ctx.db, body.sceneId);
      if (scene === null) return c.json(badRequest("No such scene."), 404);
      sceneId = scene.id;
    }
    const topK = typeof body.topK === "number" ? Math.max(1, Math.min(20, body.topK)) : 4;
    const chunks = await retrieve(ctx.db, ctx.keyring, sceneId, body.query.trim(), topK);
    return c.json(chunks);
  });

  return app;
}
