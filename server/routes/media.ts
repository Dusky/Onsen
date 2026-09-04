import { Hono } from "hono";
import { join } from "node:path";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import { encryptSecret, decryptSecret, maskSecret } from "../lib/crypto.ts";
import { findScene, findMessage } from "../db/queries/history.ts";
import {
  deleteAsset,
  deleteService,
  findAsset,
  findService,
  insertAsset,
  insertService,
  listServices,
  makeDefault,
  updateService,
  toMediaAssetDto,
  type MediaServiceRow,
} from "../db/queries/media.ts";
import { MEDIA_KINDS } from "../media/index.ts";
import { MediaRunner, VisionUnsupported, proseToPrompt } from "../media/runner.ts";
import { isSupportedMedia, mimeForPath, store } from "../media/store.ts";
import { AdapterError } from "../adapters/types.ts";

/**
 * Pictures and voices (SPEC §20 phase 41).
 *
 * Three features that share a table and very little else: drawing something for
 * a message, saying one aloud, and reading a picture the reader attached. The
 * first two talk to a media service; the third talks to a language model that
 * can see, because that is what a caption is.
 *
 * Nothing here runs on a turn. §8's "a background task must never block
 * generation" is the rule, and it binds harder for these than for the guides —
 * an image takes seconds and a voice costs by the character.
 */

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

function badRequest(message: string) {
  return { error: { code: "bad_request", message } };
}

function notFound(what: string) {
  return { error: { code: "not_found", message: `No such ${what}.` } };
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.slice(0, max);
}

async function readJson(c: { req: { json(): Promise<unknown> } }): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await c.req.json();
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Never carries the key, only whether there is one and what it looks like. */
function toServiceDto(row: MediaServiceRow, keyring: Parameters<typeof decryptSecret>[0]) {
  return {
    id: row.ulid,
    name: row.name,
    purpose: row.purpose,
    kind: row.kind,
    kindLabel: MEDIA_KINDS.find((k) => k.purpose === row.purpose && k.kind === row.kind)?.label ??
      row.kind,
    baseUrl: row.base_url,
    model: row.model,
    options: safeOptions(row.options),
    hasApiKey: row.api_key_encrypted !== null,
    apiKeyMask:
      row.api_key_encrypted === null
        ? null
        : maskSecret(decryptSecret(keyring, row.api_key_encrypted)),
    enabled: row.enabled === 1,
    isDefault: row.is_default === 1,
  };
}


function safeOptions(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** What went wrong, in words a reader can act on rather than a stack trace. */
function explain(caught: unknown): { message: string; status: number } {
  if (caught instanceof VisionUnsupported) return { message: caught.message, status: 400 };
  if (caught instanceof AdapterError) {
    return {
      message:
        caught.providerMessage === null
          ? caught.message
          : `${caught.message} ${caught.providerMessage}`,
      status: 502,
    };
  }
  if (caught instanceof Error) {
    // A local service that is not running is the single most likely failure
    // here, and "fetch failed" does not say so.
    const isRefused = /ECONNREFUSED|fetch failed|Unable to connect/i.test(caught.message);
    return {
      message: isRefused
        ? "Could not reach the service. Check that it is running and the address is right."
        : caught.message,
      status: 502,
    };
  }
  return { message: "The service failed.", status: 502 };
}

export function mediaRoutes(ctx: AppContext, media: MediaRunner): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  /* ---------------- what can be configured ---------------- */

  /** The kinds, with their labels — so no raw enum ever reaches a screen. */
  app.get("/kinds", (c) => c.json({ kinds: MEDIA_KINDS }));

  /* ---------------- services ---------------- */

  app.get("/services", (c) =>
    c.json({ services: listServices(ctx.db).map((row) => toServiceDto(row, ctx.keyring)) }),
  );

  app.post("/services", async (c) => {
    const body = await readJson(c);
    const purpose = body["purpose"];
    const kind = body["kind"];
    if (purpose !== "image" && purpose !== "speech") {
      return c.json(badRequest("A service is either for pictures or for speech."), 400);
    }
    if (typeof kind !== "string" || !MEDIA_KINDS.some((k) => k.purpose === purpose && k.kind === kind)) {
      return c.json(badRequest("No service of that kind."), 400);
    }
    const known = MEDIA_KINDS.find((k) => k.purpose === purpose && k.kind === kind)!;
    const apiKey = text(body["apiKey"], 400);
    const row = insertService(ctx.db, {
      name: text(body["name"], 200) ?? known.label,
      purpose,
      kind,
      baseUrl: text(body["baseUrl"], 500) ?? known.defaultBaseUrl,
      apiKeyEncrypted: apiKey === null ? null : encryptSecret(ctx.keyring, apiKey),
      model: text(body["model"], 200),
      options: JSON.stringify(
        typeof body["options"] === "object" && body["options"] !== null ? body["options"] : {},
      ),
    });
    return c.json(toServiceDto(row, ctx.keyring), 201);
  });

  app.patch("/services/:serviceId", async (c) => {
    const row = findService(ctx.db, c.req.param("serviceId"));
    if (row === null) return c.json(notFound("service"), 404);
    const body = await readJson(c);

    const patch: Parameters<typeof updateService>[2] = {};
    const name = text(body["name"], 200);
    if (name !== null) patch.name = name;
    if ("baseUrl" in body) patch.base_url = text(body["baseUrl"], 500);
    if ("model" in body) patch.model = text(body["model"], 200);
    if (typeof body["enabled"] === "boolean") patch.enabled = body["enabled"] ? 1 : 0;
    if (typeof body["options"] === "object" && body["options"] !== null) {
      patch.options = JSON.stringify(body["options"]);
    }
    // An empty key means "leave it alone", not "clear it" — a form that
    // round-trips a mask would otherwise erase the key on every save.
    if ("apiKey" in body) {
      const key = text(body["apiKey"], 400);
      if (key !== null) patch.api_key_encrypted = encryptSecret(ctx.keyring, key);
    }
    if (body["clearApiKey"] === true) patch.api_key_encrypted = null;

    const updated = updateService(ctx.db, row.id, patch);
    if (body["isDefault"] === true) makeDefault(ctx.db, row.id, row.purpose);
    return c.json(toServiceDto(findService(ctx.db, updated.ulid)!, ctx.keyring));
  });

  app.delete("/services/:serviceId", (c) => {
    const row = findService(ctx.db, c.req.param("serviceId"));
    if (row === null) return c.json(notFound("service"), 404);
    deleteService(ctx.db, row.id);
    return c.body(null, 204);
  });

  /* ---------------- the files themselves ---------------- */

  app.get("/files/:assetId", async (c) => {
    const asset = findAsset(ctx.db, c.req.param("assetId"));
    if (asset === null) return c.json(notFound("file"), 404);
    const file = Bun.file(join(ctx.config.mediaDir, asset.path));
    if (!(await file.exists())) return c.json(notFound("file"), 404);
    return new Response(file, {
      headers: {
        "Content-Type": mimeForPath(asset.path) ?? asset.mime,
        // Content-addressed, so the bytes behind a name never change.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  });

  app.delete("/files/:assetId", async (c) => {
    const asset = findAsset(ctx.db, c.req.param("assetId"));
    if (asset === null) return c.json(notFound("file"), 404);
    // The row goes first; the bytes only when nothing else points at them.
    if (deleteAsset(ctx.db, asset)) {
      try {
        await Bun.file(join(ctx.config.mediaDir, asset.path)).delete();
      } catch {
        // A missing file is the state we wanted anyway.
      }
    }
    return c.body(null, 204);
  });

  /* ---------------- drawing ---------------- */

  app.post("/messages/:messageId/illustrate", async (c) => {
    const message = findMessage(ctx.db, c.req.param("messageId"));
    if (message === null) return c.json(notFound("message"), 404);
    const body = await readJson(c);

    const service = media.serviceFor("image");
    if (service === null) {
      return c.json(badRequest("No picture service is set up yet. Add one in Settings."), 400);
    }
    // The reader's own words win. Theirs is a prompt; a paragraph of prose is
    // a paragraph of prose, and the difference matters to every image model.
    const prompt = text(body["prompt"], 2_000) ?? proseToPrompt(message.content);
    if (prompt === "") return c.json(badRequest("There is nothing here to draw."), 400);

    try {
      const asset = await media.illustrate({
        service,
        prompt,
        messageId: message.id,
        characterId: message.character_id,
        sceneId: message.scene_id,
      });
      return c.json({ asset: toMediaAssetDto(asset) }, 201);
    } catch (caught) {
      const { message: detail, status } = explain(caught);
      return c.json({ error: { code: "service_failed", message: detail } }, status as 400);
    }
  });

  /* ---------------- speaking ---------------- */

  app.post("/messages/:messageId/speak", async (c) => {
    const message = findMessage(ctx.db, c.req.param("messageId"));
    if (message === null) return c.json(notFound("message"), 404);
    const body = await readJson(c);

    const service = media.serviceFor("speech");
    if (service === null) {
      return c.json(badRequest("No voice service is set up yet. Add one in Settings."), 400);
    }
    const spoken = proseToPrompt(message.content, 4_000);
    if (spoken === "") return c.json(badRequest("There is nothing here to say."), 400);

    try {
      const asset = await media.speak({
        service,
        text: spoken,
        voice: text(body["voice"], 100),
        messageId: message.id,
        sceneId: message.scene_id,
      });
      return c.json({ asset: toMediaAssetDto(asset) }, 201);
    } catch (caught) {
      const { message: detail, status } = explain(caught);
      return c.json({ error: { code: "service_failed", message: detail } }, status as 400);
    }
  });

  /* ---------------- attaching a picture ---------------- */

  /**
   * Upload an image for the author to react to.
   *
   * Captioned on the way in, because the caption is the part that reaches the
   * prompt. A failed caption still stores the picture: the reader can see it in
   * the log, and a picture with no description is a better outcome than an
   * upload that vanished.
   */
  app.post("/scenes/:sceneId/attachments", async (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) return c.json(notFound("roleplay"), 404);

    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json(badRequest("Expected an uploaded file."), 400);
    }
    const file = form.get("file");
    if (!(file instanceof File)) return c.json(badRequest("Expected an uploaded file."), 400);
    if (file.size > MAX_UPLOAD_BYTES) {
      return c.json(badRequest("That picture is larger than 12 MB."), 400);
    }
    const mime = file.type;
    if (!mime.startsWith("image/") || !isSupportedMedia(mime)) {
      return c.json(badRequest("That is not a picture this app can read."), 400);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const written = await store(ctx.config.mediaDir, bytes, mime);
    const asset = insertAsset(ctx.db, {
      kind: "image",
      role: "attachment",
      path: written.path,
      mime,
      bytes: written.bytes,
      sceneId: scene.id,
    });

    let captionError: string | null = null;
    try {
      await media.caption(asset, Buffer.from(bytes).toString("base64"), scene.connection_profile_id);
    } catch (caught) {
      captionError = explain(caught).message;
    }
    const stored = findAsset(ctx.db, asset.ulid)!;
    return c.json({ asset: toMediaAssetDto(stored), captionError }, 201);
  });

  /** Describe it again — the first answer is not always the useful one. */
  app.post("/attachments/:assetId/caption", async (c) => {
    const asset = findAsset(ctx.db, c.req.param("assetId"));
    if (asset === null) return c.json(notFound("picture"), 404);
    const file = Bun.file(join(ctx.config.mediaDir, asset.path));
    if (!(await file.exists())) return c.json(notFound("picture"), 404);

    const scene = asset.scene_id === null ? null : ctx.db
      .query("SELECT connection_profile_id FROM scenes WHERE id = $id")
      .get({ id: asset.scene_id }) as { connection_profile_id: number | null } | null;

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const caption = await media.caption(
        asset,
        Buffer.from(bytes).toString("base64"),
        scene?.connection_profile_id ?? null,
      );
      return c.json({ asset: toMediaAssetDto(findAsset(ctx.db, asset.ulid)!), caption });
    } catch (caught) {
      const { message: detail, status } = explain(caught);
      return c.json({ error: { code: "service_failed", message: detail } }, status as 400);
    }
  });

  return app;
}
