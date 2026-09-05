/**
 * Migrating in from SillyTavern (SPEC §20 phase 44).
 *
 * One endpoint, one pass over a data folder. The client filters before it
 * uploads — a real install is hundreds of megabytes of avatars, thumbnails and
 * backups, and almost none of it is something this can read — and sends each
 * surviving file under the path it had inside SillyTavern, because the folder
 * is what says whether a bare JSON object is an instruct template, a context
 * template or a sampler preset.
 */
import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import { listCharacters } from "../db/queries/characters.ts";
import { importSillyTavern, type IncomingFile } from "../sillytavern/index.ts";
import type { MigrationReportDto } from "../../shared/types.ts";

/** Matches the card importer: the largest thing here is a CharX bundle. */
const MAX_FILE_BYTES = 32 * 1024 * 1024;

function badRequest(message: string) {
  return { error: { code: "bad_request", message } };
}

export function migrateRoutes(ctx: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  app.post("/sillytavern", async (c) => {
    let entries: File[] = [];
    try {
      const form = await c.req.formData();
      entries = form.getAll("files").filter((value): value is File => value instanceof File);
    } catch {
      return c.json(badRequest("Expected a folder upload."), 400);
    }
    if (entries.length === 0) return c.json(badRequest("No files were uploaded."), 400);

    const files: IncomingFile[] = [];
    for (const entry of entries) {
      // Oversized files are dropped rather than refused: the folder is the unit
      // being imported, and one enormous stray must not cost the rest of it.
      if (entry.size > MAX_FILE_BYTES) continue;
      // The client puts the SillyTavern-relative path in the filename slot,
      // which is the only field a multipart part carries for it.
      files.push({ path: entry.name, bytes: new Uint8Array(await entry.arrayBuffer()) });
    }

    const result = await importSillyTavern(ctx, files, listCharacters(ctx.db));
    return c.json(result satisfies MigrationReportDto, 201);
  });

  return app;
}
