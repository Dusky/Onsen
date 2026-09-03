import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import { readPack } from "../packs/archive.ts";
import { HOST_API_VERSION, PackError, type PackManifest } from "../packs/manifest.ts";
import { installPack, planInstall, uninstallPack, uninstallPreview } from "../packs/install.ts";
import { buildPack, emptySelection, type PackSelection } from "../packs/build.ts";
import { safeName } from "../packs/archive.ts";

/**
 * Packs (SPEC §15 tier 2, §20 phase 34).
 *
 * Four verbs. `preview` reads an archive and says what installing it would do,
 * writing nothing; `install` does it transactionally; `uninstall` removes
 * exactly what an install added; `export` builds an archive out of what is here.
 *
 * Preview takes the file rather than an id on purpose. The alternative is a
 * staging area — upload, then install by handle — which means a place on disk
 * holding half-trusted archives and a rule for when they expire. Sending the
 * file twice is cheaper than owning that.
 */

function badRequest(message: string) {
  return { error: { code: "bad_request", message } };
}

function notFound(what: string) {
  return { error: { code: "not_found", message: `No such ${what}.` } };
}

const MAX_PACK_BYTES = 200 * 1024 * 1024;

async function archiveOf(c: {
  req: { formData(): Promise<FormData> };
}): Promise<Uint8Array | string> {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return "Send the pack as a file.";
  }
  const file = form.get("file");
  if (!(file instanceof File)) return "Send the pack as a file.";
  if (file.size > MAX_PACK_BYTES) return "That pack is larger than this app will read.";
  return new Uint8Array(await file.arrayBuffer());
}

export function packRoutes(ctx: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  app.get("/", (c) => {
    const rows = ctx.db
      .query(
        `SELECT p.ulid, p.name, p.version, p.author, p.description, p.host_api_range,
                p.installed_at,
                (SELECT count(*) FROM pack_rows r WHERE r.pack_id = p.id) AS row_count
           FROM packs p
          ORDER BY p.installed_at DESC`,
      )
      .all() as {
      ulid: string;
      name: string;
      version: string;
      author: string;
      description: string;
      host_api_range: string | null;
      installed_at: number;
      row_count: number;
    }[];
    return c.json({
      hostApiVersion: HOST_API_VERSION,
      packs: rows.map((row) => ({
        id: row.ulid,
        name: row.name,
        version: row.version,
        author: row.author,
        description: row.description,
        hostApiRange: row.host_api_range,
        installedAt: row.installed_at,
        rowCount: row.row_count,
      })),
    });
  });

  /** What installing this archive would do. Writes nothing. */
  app.post("/preview", async (c) => {
    const bytes = await archiveOf(c);
    if (typeof bytes === "string") return c.json(badRequest(bytes), 400);
    try {
      return c.json(planInstall(ctx.db, readPack(bytes)));
    } catch (caught) {
      if (caught instanceof PackError) return c.json(badRequest(caught.message), 400);
      throw caught;
    }
  });

  app.post("/install", async (c) => {
    const bytes = await archiveOf(c);
    if (typeof bytes === "string") return c.json(badRequest(bytes), 400);
    try {
      const result = await installPack(
        { db: ctx.db, avatarsDir: ctx.config.avatarsDir },
        readPack(bytes),
      );
      return c.json(result, 201);
    } catch (caught) {
      if (caught instanceof PackError) return c.json(badRequest(caught.message), 400);
      throw caught;
    }
  });

  /** What uninstalling would remove, by the record of what install added. */
  app.get("/:packId/preview", (c) => {
    const preview = uninstallPreview(ctx.db, c.req.param("packId"));
    return preview === null ? c.json(notFound("pack"), 404) : c.json(preview);
  });

  app.delete("/:packId", (c) => {
    const preview = uninstallPreview(ctx.db, c.req.param("packId"));
    if (preview === null) return c.json(notFound("pack"), 404);
    const removed = uninstallPack(ctx.db, c.req.param("packId"));
    return c.json({ removed, of: preview.rows.length });
  });

  /**
   * Build a pack out of what is installed.
   *
   * Selection is by identifier rather than "everything": a pack is something
   * the user means to share, and an export that swept up every character in the
   * library would be a backup wearing a pack's clothes.
   */
  app.post("/export", async (c) => {
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await c.req.json();
      body = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      body = {};
    }

    const name = typeof body["name"] === "string" ? body["name"].trim().slice(0, 120) : "";
    if (name === "") return c.json(badRequest("A pack needs a name."), 400);

    const manifest: PackManifest = {
      name,
      version:
        typeof body["version"] === "string" && body["version"].trim() !== ""
          ? body["version"].trim().slice(0, 40)
          : "1.0.0",
      author: typeof body["author"] === "string" ? body["author"].slice(0, 120) : "",
      description: typeof body["description"] === "string" ? body["description"].slice(0, 2_000) : "",
      // Written rather than asked for. A pack built here works on a host that
      // reads this version of the tree, and making the user type a range would
      // be asking them to guess at a number they have no way to know.
      hostApiRange: `${HOST_API_VERSION.split(".")[0]}.x`,
    };

    const ids = (key: string): string[] => {
      const value = body[key];
      return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    };
    const selection: PackSelection = {
      ...emptySelection(),
      characters: ids("characters"),
      lorebooks: ids("lorebooks"),
      presets: ids("presets"),
      authors: ids("authors"),
      options: ids("options"),
      regex: ids("regex"),
      triggers: ids("triggers"),
      banlist: body["banlist"] === true,
    };

    const bytes = await buildPack(ctx.db, {
      manifest,
      selection,
      avatarsDir: ctx.config.avatarsDir,
    });
    return c.body(bytes as unknown as ArrayBuffer, 200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${safeName(name, "pack")}.onsenpack"`,
    });
  });

  return app;
}
