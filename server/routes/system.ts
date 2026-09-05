import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import { applyUpdate, checkForUpdates, readUpdateStatus } from "../updates.ts";
import { getSetting, setSetting } from "../db/queries/settings.ts";
import { LAYOUT_PRESETS, READING_DEFAULTS, clampReading, presetOf } from "@shared/types.ts";
import type { LayoutDto, LayoutPreset, ReadingDto } from "@shared/types.ts";

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
    const values = {
      readouts: getSetting(ctx.db, "layout_readouts") !== "0",
      cast: getSetting(ctx.db, "layout_cast") === "line" ? ("line" as const) : ("segments" as const),
      dek: getSetting(ctx.db, "layout_dek") === "1",
      attribution:
        getSetting(ctx.db, "layout_attribution") === "inline"
          ? ("inline" as const)
          : ("stacked" as const),
    };
    return { preset: presetOf(values), ...values };
  }

  function preferences() {
    return {
      completionChime: getSetting(ctx.db, "completion_chime") === "1",
      layout: layout(),
      reading: reading(),
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
      if (patch["attribution"] === "stacked" || patch["attribution"] === "inline") {
        setSetting(ctx.db, "layout_attribution", patch["attribution"]);
      }
    }

    const wanted = body["reading"];
    if (typeof wanted === "object" && wanted !== null) {
      // Merged onto what is stored rather than onto the defaults, so a request
      // carrying one slider does not reset the other two.
      const next = clampReading({ ...reading(), ...(wanted as Record<string, unknown>) });
      setSetting(ctx.db, "reading_scale", String(next.scale));
      setSetting(ctx.db, "reading_measure", String(next.measure));
      setSetting(ctx.db, "reading_leading", String(next.leading));
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
