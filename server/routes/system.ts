import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import { applyUpdate, checkForUpdates, readUpdateStatus } from "../updates.ts";
import { getSetting, setSetting } from "../db/queries/settings.ts";
import { activeTheme, setActiveTheme } from "../db/queries/themes.ts";
import { badRequest } from "../lib/routes.ts";
import {
  LAYOUT_PRESETS,
  READER_DEFAULTS,
  READING_DEFAULTS,
  clampReading,
  presetOf,
  readReader,
} from "@shared/types.ts";
import type {
  AttributionStyle,
  LayoutDto,
  LayoutPreset,
  ReaderDto,
  ReadingDto,
  TurnStyle,
} from "@shared/types.ts";

/** The stored `layout_attribution` values, so read and write agree on the set. */
const ATTRIBUTIONS: readonly AttributionStyle[] = ["stacked", "inline", "runin"];

/**
 * System endpoints (SPEC §17). The updater's logic lives in `server/updates.ts`;
 * these routes only carry it, so the failure modes arrive as they were decided
 * there: a refusal is a 409 with the reason, never a silently degraded 200.
 */

export function systemRoutes(ctx: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  const repoDir = ctx.config.repoDir;

  // Local facts only — no network, so the settings screen can ask on load.
  /**
   * Reading preferences (SPEC §5, §16 §Density, §20 phase 55).
   *
   * Server-side because there is no browser storage in this app (HANDOFF
   * non-negotiable 8) — and because a preference that lived in one browser
   * would be the wrong shape for a §5 feature anyway: the point of head sync is
   * that the phone and the desktop are two views of one install.
   *
   * Stored per field and clamped on read as well as write, so a value written
   * by an older build, or by hand, cannot render the app unusable — the failure
   * mode of a bad font size is a screen you cannot navigate to fix it on.
   */
  function reading(): ReadingDto {
    return clampReading({
      scale: Number(getSetting(ctx.db, "reading_scale") ?? READING_DEFAULTS.scale),
      measure: Number(getSetting(ctx.db, "reading_measure") ?? READING_DEFAULTS.measure),
      leading: Number(getSetting(ctx.db, "reading_leading") ?? READING_DEFAULTS.leading),
      window: Number(getSetting(ctx.db, "reading_window") ?? READING_DEFAULTS.window),
    });
  }

  /**
   * The chat layout (§20 phase 52).
   *
   * Stored as four settings rather than one blob so a value added later
   * defaults on its own, and read back through `presetOf` so the client is
   * never told a preset name that disagrees with the switches under it.
   */
  function layout(): LayoutDto {
    /** A per-side switch, defaulting to Instrument's rather than to false. */
    const side = (which: "reader" | "author"): TurnStyle => ({
      bubble: getSetting(ctx.db, `layout_${which}_bubble`) === null
        ? LAYOUT_PRESETS.instrument[which].bubble
        : getSetting(ctx.db, `layout_${which}_bubble`) === "1",
      avatar: getSetting(ctx.db, `layout_${which}_avatar`) === "1",
    });
    const values = {
      readouts: getSetting(ctx.db, "layout_readouts") !== "0",
      cast: getSetting(ctx.db, "layout_cast") === "line" ? ("line" as const) : ("segments" as const),
      dek: getSetting(ctx.db, "layout_dek") === "1",
      // Read through the union rather than a two-way ternary: a third value
      // added later (`runin`, phase 165) would otherwise be stored correctly
      // and read back as `stacked`, which is the quietest kind of bug.
      attribution: ATTRIBUTIONS.includes(getSetting(ctx.db, "layout_attribution") as AttributionStyle)
        ? (getSetting(ctx.db, "layout_attribution") as AttributionStyle)
        : ("stacked" as const),
      avatarShape:
        getSetting(ctx.db, "layout_avatar_shape") === "square"
          ? ("square" as const)
          : ("circle" as const),
      reader: side("reader"),
      author: side("author"),
    };
    return { preset: presetOf(values), ...values };
  }

  /**
   * The reader's own controls (§20 phase 166).
   *
   * Stored per field, like the layout and for the same reason: a field added
   * later defaults on its own rather than needing every stored blob rewritten.
   * A boolean absent from the settings table is the shipped default, not
   * `false` — which is why each one asks `=== null` before reading rather than
   * comparing to `"1"` and getting the default wrong half the time.
   *
   * Validated through `readReader` on the way out as well as in: a row written
   * by hand or by an older build cannot put the app into a state its own
   * settings screen does not offer.
   */
  function reader(): ReaderDto {
    const flag = (key: string, fallback: boolean): boolean => {
      const stored = getSetting(ctx.db, key);
      return stored === null ? fallback : stored === "1";
    };
    return readReader({
      send: getSetting(ctx.db, "reader_send") ?? READER_DEFAULTS.send,
      marks: flag("reader_marks", READER_DEFAULTS.marks),
      timestamps: flag("reader_timestamps", READER_DEFAULTS.timestamps),
      motion: getSetting(ctx.db, "reader_motion") ?? READER_DEFAULTS.motion,
      autoScroll: flag("reader_auto_scroll", READER_DEFAULTS.autoScroll),
      drafts: flag("reader_drafts", READER_DEFAULTS.drafts),
      clickToEdit: flag("reader_click_to_edit", READER_DEFAULTS.clickToEdit),
      media: getSetting(ctx.db, "reader_media") ?? READER_DEFAULTS.media,
      notices: getSetting(ctx.db, "reader_notices") ?? READER_DEFAULTS.notices,
    });
  }

  function preferences() {
    return {
      completionChime: getSetting(ctx.db, "completion_chime") === "1",
      layout: layout(),
      reading: reading(),
      reader: reader(),
    };
  }

  /*
   * Applying one group of preferences.
   *
   * Extracted from the PATCH handler when settings export/import became its
   * second caller (§20 phase 168). Not a refactor for tidiness: a second copy
   * of "how a layout patch is applied" is a second answer to "what does
   * `preset: quiet` plus `readouts: true` mean", and the file arriving from
   * another machine is exactly where the two would drift unnoticed.
   *
   * Each one takes unknown input and validates it, so the import path needs no
   * validation of its own — it is the same function, reached from a file
   * instead of from a request body.
   */
  function applyChime(value: unknown): boolean {
    if (typeof value !== "boolean") return false;
    setSetting(ctx.db, "completion_chime", value ? "1" : "0");
    return true;
  }

  function applyReader(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    // Merged onto what is stored rather than onto the defaults, so a request
    // carrying one switch does not reset the other eight — the same rule the
    // layout's per-side merge and `reading`'s clamp both follow.
    const next = readReader({ ...reader(), ...(value as Record<string, unknown>) });
    setSetting(ctx.db, "reader_send", next.send);
    setSetting(ctx.db, "reader_marks", next.marks ? "1" : "0");
    setSetting(ctx.db, "reader_timestamps", next.timestamps ? "1" : "0");
    setSetting(ctx.db, "reader_motion", next.motion);
    setSetting(ctx.db, "reader_auto_scroll", next.autoScroll ? "1" : "0");
    setSetting(ctx.db, "reader_drafts", next.drafts ? "1" : "0");
    setSetting(ctx.db, "reader_click_to_edit", next.clickToEdit ? "1" : "0");
    setSetting(ctx.db, "reader_media", next.media);
    setSetting(ctx.db, "reader_notices", next.notices);
    return true;
  }

  function applyReading(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    // Merged onto what is stored rather than onto the defaults, so a request
    // carrying one slider does not reset the other three.
    const next = clampReading({ ...reading(), ...(value as Record<string, unknown>) });
    setSetting(ctx.db, "reading_scale", String(next.scale));
    setSetting(ctx.db, "reading_measure", String(next.measure));
    setSetting(ctx.db, "reading_leading", String(next.leading));
    setSetting(ctx.db, "reading_window", String(next.window));
    return true;
  }

  function applyLayout(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    {
      const patch = value as Record<string, unknown>;
      // A preset named on its own sets all four; individual switches sent
      // alongside it win, which is what makes "start from Quiet, but keep the
      // readouts" one request rather than two.
      const named = patch["preset"];
      if (typeof named === "string" && named in LAYOUT_PRESETS) {
        const values = LAYOUT_PRESETS[named as LayoutPreset];
        setSetting(ctx.db, "layout_readouts", values.readouts ? "1" : "0");
        setSetting(ctx.db, "layout_cast", values.cast);
        setSetting(ctx.db, "layout_dek", values.dek ? "1" : "0");
        setSetting(ctx.db, "layout_attribution", values.attribution);
        setSetting(ctx.db, "layout_avatar_shape", values.avatarShape);
        for (const which of ["reader", "author"] as const) {
          setSetting(ctx.db, `layout_${which}_bubble`, values[which].bubble ? "1" : "0");
          setSetting(ctx.db, `layout_${which}_avatar`, values[which].avatar ? "1" : "0");
        }
      }
      if (typeof patch["readouts"] === "boolean") {
        setSetting(ctx.db, "layout_readouts", patch["readouts"] ? "1" : "0");
      }
      if (patch["cast"] === "segments" || patch["cast"] === "line") {
        setSetting(ctx.db, "layout_cast", patch["cast"]);
      }
      if (typeof patch["dek"] === "boolean") {
        setSetting(ctx.db, "layout_dek", patch["dek"] ? "1" : "0");
      }
      if (ATTRIBUTIONS.includes(patch["attribution"] as AttributionStyle)) {
        setSetting(ctx.db, "layout_attribution", patch["attribution"] as AttributionStyle);
      }
      if (patch["avatarShape"] === "circle" || patch["avatarShape"] === "square") {
        setSetting(ctx.db, "layout_avatar_shape", patch["avatarShape"]);
      }
      // Each side is merged onto what is stored, so a request carrying only
      // `reader.avatar` does not silently switch that side's bubble off.
      for (const which of ["reader", "author"] as const) {
        const asked = patch[which];
        if (typeof asked !== "object" || asked === null) continue;
        const fields = asked as Record<string, unknown>;
        for (const field of ["bubble", "avatar"] as const) {
          if (typeof fields[field] === "boolean") {
            setSetting(ctx.db, `layout_${which}_${field}`, fields[field] ? "1" : "0");
          }
        }
      }
    }
    return true;
  }

  app.get("/preferences", (c) => c.json(preferences()));

  app.patch("/preferences", async (c) => {
    let body: Record<string, unknown> = {};
    try {
      const parsed: unknown = await c.req.json();
      if (typeof parsed === "object" && parsed !== null) body = parsed as Record<string, unknown>;
    } catch {
      /* An empty body changes nothing. */
    }
    applyChime(body["completionChime"]);
    applyLayout(body["layout"]);
    applyReader(body["reader"]);
    applyReading(body["reading"]);
    return c.json(preferences());
  });

  /* ------------------------------------------------------------------ */
  /* The whole setup as one file (§20 phase 168)                         */
  /* ------------------------------------------------------------------ */

  /**
   * Packs carry content — characters, lorebooks, presets, authors, options,
   * regex, triggers, the banlist. Themes export on their own. What travelled
   * nowhere was the shape of the app itself: the layout, the reading surface,
   * the reader's controls, which theme is on. There was no "my whole setup as
   * one file", which is exactly what is wanted when moving machines.
   *
   * Beside those two exporters rather than inside either: a pack is content,
   * and a theme is a palette. This is neither — it is every decision the
   * reader has made about how the app behaves, and none about what is in it.
   *
   * The theme travels **by name**, not by value. A theme is already portable
   * on its own, and inlining one here would mean an import silently creating a
   * theme — an import of *settings* is not the place to find a new palette in
   * your list. A name the importing install does not have is reported as
   * skipped rather than guessed at.
   */
  const SETTINGS_MARKER = "onsen-settings";
  /** Bumped when a group is added, so an older file still imports. */
  const SETTINGS_VERSION = 1;

  app.get("/settings/export", (c) => {
    const theme = activeTheme(ctx.db);
    return c.json({
      onsen: SETTINGS_MARKER,
      version: SETTINGS_VERSION,
      exportedAt: Date.now(),
      ...preferences(),
      // The name, and null where the install has never had a theme seeded.
      theme: theme?.name ?? null,
    });
  });

  /**
   * The other direction.
   *
   * Each group goes through the same `apply*` function the PATCH uses, so
   * there is one answer to "what does this value mean" and a hostile file gets
   * exactly the validation a hostile request body does: `clampReading` pins a
   * slider, `readReader` falls back per field, and the layout's switches are
   * checked against their own unions. Nothing here writes a value the settings
   * screen could not have produced.
   *
   * The report says what was applied and what was skipped rather than
   * answering 200-and-silence. An import that quietly did four of five things
   * is the failure mode `SPEC §18` is written against — and a theme named in
   * the file but missing here is the ordinary case, not an error.
   */
  app.post("/settings/import", async (c) => {
    let raw: unknown;
    try {
      const form = await c.req.formData();
      const file = form.get("file");
      raw = JSON.parse(file instanceof File ? await file.text() : String(form.get("settings") ?? ""));
    } catch {
      try {
        raw = await c.req.json();
      } catch {
        // A truncated file lands here: `JSON.parse` threw and there is no body
        // to fall back to. Refused whole rather than half-applied.
        return c.json(badRequest("That file is not readable JSON."), 400);
      }
    }

    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return c.json(badRequest("That is not a settings file."), 400);
    }
    const doc = raw as Record<string, unknown>;
    if (doc["onsen"] !== SETTINGS_MARKER) {
      // A theme file and a pack are both JSON objects with a `name`. Without
      // the marker, importing the wrong one would apply nothing and say it
      // worked.
      return c.json(badRequest("That is not a settings file."), 400);
    }
    const version = doc["version"];
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
      return c.json(badRequest("That settings file has no version."), 400);
    }
    if (version > SETTINGS_VERSION) {
      // Refused rather than partially applied: a newer file's groups are not
      // just unknown fields, they may be a group this build would silently
      // drop, and a reader would have no way to know what did not arrive.
      return c.json(
        badRequest("That file is from a newer version of Onsen than this one."),
        400,
      );
    }

    const applied: string[] = [];
    const skipped: string[] = [];
    for (const [name, apply] of [
      ["layout", applyLayout],
      ["reading", applyReading],
      ["reader", applyReader],
      ["completionChime", applyChime],
    ] as const) {
      (apply(doc[name]) ? applied : skipped).push(name);
    }

    const wantedTheme = doc["theme"];
    if (typeof wantedTheme !== "string" || wantedTheme.trim() === "") {
      skipped.push("theme");
    } else {
      const row = ctx.db
        .query("SELECT ulid FROM themes WHERE name = $name COLLATE NOCASE")
        .get({ name: wantedTheme.trim().slice(0, 120) }) as { ulid: string } | null;
      if (row === null) skipped.push("theme");
      else {
        setActiveTheme(ctx.db, row.ulid);
        applied.push("theme");
      }
    }

    return c.json({ applied, skipped, preferences: preferences() });
  });

  app.get("/update", async (c) => c.json(await readUpdateStatus(repoDir)));

  // Fetches the remote, then reports against it. Network failures are a field,
  // not a status code: the local half of the answer is still true.
  app.post("/update/check", async (c) => c.json(await checkForUpdates(repoDir)));

  app.post("/update/apply", async (c) => {
    const result = await applyUpdate(repoDir);
    if (!result.applied) {
      return c.json({ error: { code: "update_refused", message: result.message } }, 409);
    }
    return c.json(result.status);
  });

  return app;
}
