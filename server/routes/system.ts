import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import { applyUpdate, checkForUpdates, readUpdateStatus } from "../updates.ts";
import { getSetting, setSetting } from "../db/queries/settings.ts";
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

  app.get("/preferences", (c) => c.json(preferences()));

  app.patch("/preferences", async (c) => {
    let body: Record<string, unknown> = {};
    try {
      const parsed: unknown = await c.req.json();
      if (typeof parsed === "object" && parsed !== null) body = parsed as Record<string, unknown>;
    } catch {
      /* An empty body changes nothing. */
    }
    if (typeof body["completionChime"] === "boolean") {
      setSetting(ctx.db, "completion_chime", body["completionChime"] ? "1" : "0");
    }

    const asked = body["layout"];
    if (typeof asked === "object" && asked !== null) {
      const patch = asked as Record<string, unknown>;
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

    const asReader = body["reader"];
    if (typeof asReader === "object" && asReader !== null) {
      // Merged onto what is stored rather than onto the defaults, so a request
      // carrying one switch does not reset the other seven — the same rule the
      // layout's per-side merge and `reading`'s clamp both follow.
      const next = readReader({ ...reader(), ...(asReader as Record<string, unknown>) });
      setSetting(ctx.db, "reader_send", next.send);
      setSetting(ctx.db, "reader_marks", next.marks ? "1" : "0");
      setSetting(ctx.db, "reader_timestamps", next.timestamps ? "1" : "0");
      setSetting(ctx.db, "reader_motion", next.motion);
      setSetting(ctx.db, "reader_auto_scroll", next.autoScroll ? "1" : "0");
      setSetting(ctx.db, "reader_drafts", next.drafts ? "1" : "0");
      setSetting(ctx.db, "reader_click_to_edit", next.clickToEdit ? "1" : "0");
      setSetting(ctx.db, "reader_media", next.media);
    }

    const wanted = body["reading"];
    if (typeof wanted === "object" && wanted !== null) {
      // Merged onto what is stored rather than onto the defaults, so a request
      // carrying one slider does not reset the other two.
      const next = clampReading({ ...reading(), ...(wanted as Record<string, unknown>) });
      setSetting(ctx.db, "reading_scale", String(next.scale));
      setSetting(ctx.db, "reading_measure", String(next.measure));
      setSetting(ctx.db, "reading_leading", String(next.leading));
      setSetting(ctx.db, "reading_window", String(next.window));
    }

    return c.json(preferences());
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
