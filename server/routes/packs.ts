import { Hono } from "hono";
import { mkdtempSync, rmSync, readdirSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { zipSync } from "fflate";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import { readPack } from "../packs/archive.ts";
import { installExtensionCode } from "../extensions/install.ts";
import { removePackExtension } from "../extensions/remove.ts";
import { HOST_API_VERSION, PackError, type PackManifest } from "../packs/manifest.ts";
import { installPack, planInstall, uninstallPack, uninstallPreview } from "../packs/install.ts";
import { buildPack, emptySelection, type PackSelection } from "../packs/build.ts";
import { safeName } from "../packs/archive.ts";
import { badRequest, notFound } from "../lib/routes.ts";

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

const MAX_PACK_BYTES = 200 * 1024 * 1024;

/**
 * Told apart from the other refusals so it can answer 413 rather than riding
 * the shared 400. Every upload path in the app answers 413 for a file that is
 * too big; they used to disagree, 400 or 413 by which was written first.
 */
const TOO_LARGE = "That pack is larger than this app will read.";

/**
 * `git clone` treats its source argument as more than a location — the
 * `ext::` transport runs an arbitrary shell command as part of "cloning",
 * and `file://` reaches the local disk. Both are reachable through a plain
 * string here, and installing a pack from a shared link is an explicitly
 * encouraged workflow, so an attacker only needs a URL for someone to paste,
 * not a valid pack. Restricting to http(s) (the same rule webhooks already
 * apply to outbound URLs, `webhooks/sender.ts`'s `urlProblem`) closes that
 * off without needing to allowlist or parse every safe git transport.
 */
function gitUrlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "That is not a URL.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "Only http and https repository URLs are supported.";
  }
  return null;
}

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
  if (file.size > MAX_PACK_BYTES) return TOO_LARGE;
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

  /**
   * What is here that a pack could carry.
   *
   * One endpoint rather than the export sheet fetching seven lists, because
   * this is the only place that wants all seven — and one of them, the prompt
   * option groups, has no global listing anywhere else in the API.
   */
  app.get("/exportable", (c) => {
    const rows = (sql: string) =>
      ctx.db.query(sql).all() as { ulid: string; name: string }[];
    return c.json({
      characters: rows("SELECT ulid, name FROM characters ORDER BY name COLLATE NOCASE"),
      // A dossier book is written by the app, not the reader, and is bound to
      // one scene (§11, phase 32). Packing one would ship a book that reaches
      // nothing on the other side, so it is not offered.
      lorebooks: rows(
        `SELECT b.ulid, b.name FROM lorebooks b
          WHERE NOT EXISTS (
            SELECT 1 FROM dossiers d
              JOIN lore_entries e ON e.id = d.lore_entry_id
             WHERE e.lorebook_id = b.id
          )
          ORDER BY b.name COLLATE NOCASE`,
      ),
      presets: rows("SELECT ulid, name FROM presets ORDER BY name COLLATE NOCASE"),
      authors: rows("SELECT ulid, name FROM authors ORDER BY name COLLATE NOCASE"),
      // Built-ins are excluded: every install already has them, so packing one
      // would install a duplicate under a fresh key on the other side.
      options: rows(
        "SELECT ulid, name FROM option_groups WHERE is_builtin = 0 ORDER BY sort_order, name",
      ),
      regex: rows("SELECT ulid, name FROM regex_scripts ORDER BY run_order, name"),
      triggers: rows("SELECT ulid, name FROM event_triggers ORDER BY run_order, name"),
      banlist: (
        ctx.db
          .query(
            "SELECT count(*) AS n FROM ban_phrases WHERE scene_id IS NULL AND origin <> 'proposed'",
          )
          .get() as { n: number }
      ).n,
    });
  });

  /** What installing this archive would do. Writes nothing. */
  app.post("/preview", async (c) => {
    const bytes = await archiveOf(c);
    if (typeof bytes === "string") {
      return c.json(badRequest(bytes), bytes === TOO_LARGE ? 413 : 400);
    }
    try {
      return c.json(planInstall(ctx.db, readPack(bytes)));
    } catch (caught) {
      if (caught instanceof PackError) return c.json(badRequest(caught.message), 400);
      throw caught;
    }
  });

  app.post("/install", async (c) => {
    const bytes = await archiveOf(c);
    if (typeof bytes === "string") {
      return c.json(badRequest(bytes), bytes === TOO_LARGE ? 413 : 400);
    }
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

  app.post("/install-url", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { url?: unknown } | null;
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    if (url === "") return c.json(badRequest("A repository URL is required."), 400);
    const problem = gitUrlProblem(url);
    if (problem !== null) return c.json(badRequest(problem), 400);

    const dir = mkdtempSync(join(tmpdir(), "onsen-ext-"));
    try {
      const cloned = Bun.spawnSync(["git", "clone", "--depth", "1", "--quiet", url, dir]);
      if (cloned.exitCode !== 0) {
        return c.json(badRequest("Could not clone that repository. Check the URL."), 400);
      }

      // An extension is a directory in the pack layout; zip it and read it the
      // same way an uploaded archive is read.
      const files: Record<string, Uint8Array> = {};
      const walk = (path: string) => {
        for (const entry of readdirSync(path)) {
          const full = join(path, entry);
          if (statSync(full).isDirectory()) {
            if (entry === ".git") continue;
            walk(full);
          } else {
            files[relative(dir, full)] = new Uint8Array(readFileSync(full));
          }
        }
      };
      walk(dir);
      const contents = readPack(zipSync(files));
      const result = await installPack(
        { db: ctx.db, avatarsDir: ctx.config.avatarsDir },
        contents,
      );
      const code = await installExtensionCode({
        db: ctx.db,
        extensionsDir: ctx.config.extensionsDir,
        sourceDir: dir,
        name: contents.manifest.name,
        version: contents.manifest.version,
        author: contents.manifest.author,
      });
      return c.json({ ...result, extension: code }, 201);
    } catch (caught) {
      if (caught instanceof PackError) return c.json(badRequest(caught.message), 400);
      throw caught;
    } finally {
      rmSync(dir, { recursive: true, force: true });
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
    // The code half of the same uninstall (phase 113): the pack's data rows are
    // gone above; this removes its extension's directory, rows and callbacks.
    const extensionRemoved =
      preview.extension === null
        ? false
        : removePackExtension(ctx.db, ctx.config.extensionsDir, {
            name: preview.name,
            version: preview.version,
          });
    return c.json({
      removed: removed + (extensionRemoved ? 1 : 0),
      of: preview.rows.length + (extensionRemoved ? 1 : 0),
    });
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
