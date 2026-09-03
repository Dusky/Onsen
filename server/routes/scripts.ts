import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import { findScene } from "../db/queries/history.ts";
import { findCharacter } from "../db/queries/characters.ts";
import {
  deleteScript,
  findScript,
  insertScript,
  listScriptRows,
  updateScript,
  type ScriptPatch,
} from "../db/queries/scripts.ts";
import { applyScripts, patternProblem } from "../scripts/apply.ts";
import { runStage, scriptContext, speakerOf } from "../scripts/runtime.ts";
import {
  isApplyStage,
  isScriptScope,
  type RegexScriptDto,
  type ScriptTestDto,
} from "../../shared/types.ts";

/**
 * The HTTP surface for §14's regex scripts.
 *
 * The test panel is the reason this file is more than CRUD. §14 asks for one,
 * and a test that ran anything other than the live engine would be worse than
 * none — it would say a script is safe and then a different code path would
 * rewrite the reader's scene. `POST /test` runs exactly what a turn runs.
 */

function badRequest(message: string) {
  return { error: { code: "bad_request", message } };
}

function notFound(what: string) {
  return { error: { code: "not_found", message: `No such ${what}.` } };
}

async function body(c: { req: { json(): Promise<unknown> } }): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await c.req.json();
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function text(value: unknown, max = 4_000): string | undefined {
  return typeof value === "string" ? value.slice(0, max) : undefined;
}

export function scriptRoutes(ctx: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  app.get("/", (c) => c.json(listScriptRows(ctx.db) satisfies RegexScriptDto[]));

  app.post("/", async (c) => {
    const input = await body(c);

    const name = text(input["name"], 120)?.trim() ?? "";
    if (name === "") return c.json(badRequest("A script needs a name."), 400);

    const pattern = text(input["pattern"], 2_000) ?? "";
    const flags = text(input["flags"], 16) ?? "g";
    const problem = patternProblem(pattern, flags);
    if (problem !== null) return c.json(badRequest(problem), 400);

    const applyTo = input["applyTo"];
    if (!isApplyStage(applyTo)) return c.json(badRequest("That is not a stage."), 400);
    const scope = input["scope"] ?? "global";
    if (!isScriptScope(scope)) return c.json(badRequest("That is not a scope."), 400);

    // A scoped script without its subject would run nowhere while looking like
    // it runs somewhere, which is the worst of the three states.
    let characterId: number | null = null;
    let sceneId: number | null = null;
    if (scope === "character") {
      const character = findCharacter(ctx.db, String(input["characterId"] ?? ""));
      if (character === null) return c.json(notFound("character"), 404);
      characterId = character.id;
    }
    if (scope === "scene") {
      const scene = findScene(ctx.db, String(input["sceneId"] ?? ""));
      if (scene === null) return c.json(notFound("roleplay"), 404);
      sceneId = scene.id;
    }

    const row = insertScript(ctx.db, {
      name,
      pattern,
      replacement: text(input["replacement"], 2_000) ?? "",
      flags,
      applyTo,
      scope,
      characterId,
      sceneId,
      enabled: input["enabled"] !== false,
      runOrder: typeof input["runOrder"] === "number" ? Math.trunc(input["runOrder"]) : null,
    });
    return c.json(one(row.ulid), 201);
  });

  app.patch("/:scriptId", async (c) => {
    const row = findScript(ctx.db, c.req.param("scriptId"));
    if (row === null) return c.json(notFound("script"), 404);
    const input = await body(c);

    // A pattern and its flags are validated together: `\d(?<n>x)` is fine and
    // becomes invalid the moment someone drops the `u` flag beside it, so
    // checking either alone would let the pair through broken.
    const pattern = text(input["pattern"], 2_000) ?? row.pattern;
    const flags = text(input["flags"], 16) ?? row.flags;
    if (input["pattern"] !== undefined || input["flags"] !== undefined) {
      const problem = patternProblem(pattern, flags);
      if (problem !== null) return c.json(badRequest(problem), 400);
    }

    const patch: ScriptPatch = {};
    const name = text(input["name"], 120)?.trim();
    if (name !== undefined && name !== "") patch.name = name;
    if (input["pattern"] !== undefined) patch.pattern = pattern;
    if (input["flags"] !== undefined) patch.flags = flags;
    const replacement = text(input["replacement"], 2_000);
    if (replacement !== undefined) patch.replacement = replacement;
    if (typeof input["enabled"] === "boolean") patch.enabled = input["enabled"];
    if (isApplyStage(input["applyTo"])) patch.applyTo = input["applyTo"];
    if (typeof input["runOrder"] === "number") patch.runOrder = Math.trunc(input["runOrder"]);

    updateScript(ctx.db, row.id, patch);
    return c.json(one(row.ulid));
  });

  app.delete("/:scriptId", (c) => {
    const row = findScript(ctx.db, c.req.param("scriptId"));
    if (row === null) return c.json(notFound("script"), 404);
    deleteScript(ctx.db, row.id);
    return c.body(null, 204);
  });

  /**
   * §14's test panel, server-side.
   *
   * Two modes, and the draft is the important one. Without it this runs the
   * saved scripts for a stage, which answers "what does my setup do to this
   * text". With it, it runs one unsaved pattern instead — which is what a
   * panel is actually for: a pattern is not something anyone gets right first
   * time, and a panel that could only run saved scripts would mean saving one
   * to find out what it does. A saved script is one that has already run over
   * a scene.
   *
   * Writes nothing either way.
   */
  app.post("/test", async (c) => {
    const input = await body(c);
    const sample = text(input["text"], 20_000);
    if (sample === undefined) return c.json(badRequest("Give it some text to run on."), 400);

    const applyTo = input["applyTo"];
    if (!isApplyStage(applyTo)) return c.json(badRequest("That is not a stage."), 400);

    let sceneId: number | null = null;
    if (typeof input["sceneId"] === "string" && input["sceneId"] !== "") {
      const scene = findScene(ctx.db, input["sceneId"]);
      if (scene === null) return c.json(notFound("roleplay"), 404);
      sceneId = scene.id;
    }

    let characterId: number | null = null;
    if (typeof input["characterId"] === "string" && input["characterId"] !== "") {
      const character = findCharacter(ctx.db, input["characterId"]);
      if (character === null) return c.json(notFound("character"), 404);
      characterId = character.id;
    }

    const context = scriptContext(ctx.db, sceneId);
    const speaker = speakerOf(ctx.db, characterId);

    const draft = input["draft"];
    if (typeof draft === "object" && draft !== null) {
      const fields = draft as Record<string, unknown>;
      const pattern = text(fields["pattern"], 2_000) ?? "";
      const flags = text(fields["flags"], 16) ?? "g";
      const problem = patternProblem(pattern, flags);
      if (problem !== null) return c.json(badRequest(problem), 400);

      const result = applyScripts(
        sample,
        [
          {
            id: "draft",
            name: text(fields["name"], 120)?.trim() ?? "This script",
            pattern,
            replacement: text(fields["replacement"], 2_000) ?? "",
            flags,
            enabled: true,
            applyTo,
            scope: "global",
            characterId: null,
            sceneId: null,
            runOrder: 0,
          },
        ],
        { ...context.env, char: speaker.name },
      );
      return c.json({
        before: sample,
        after: result.text,
        runs: result.runs,
      } satisfies ScriptTestDto);
    }

    const result = runStage(context, applyTo, sample, speaker);
    return c.json({
      before: sample,
      after: result.text,
      runs: result.runs,
    } satisfies ScriptTestDto);
  });

  /** Re-read after a write, so the response is the stored row rather than the request. */
  function one(scriptUlid: string): RegexScriptDto {
    const stored = listScriptRows(ctx.db).find((script) => script.id === scriptUlid);
    if (stored === undefined) throw new Error("the script vanished after being written");
    return stored;
  }

  return app;
}
