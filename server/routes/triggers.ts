import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import { findScene } from "../db/queries/history.ts";
import {
  deleteTrigger,
  findTrigger,
  insertTrigger,
  listTriggerRows,
  updateTrigger,
  type TriggerPatch,
} from "../db/queries/triggers.ts";
import { listScripts } from "../db/queries/scripts.ts";
import { TRIGGER_ACTIONS, TRIGGER_EVENTS } from "../triggers/select.ts";
import type { TriggerRunner } from "../triggers/runner.ts";
import { GUIDE_KINDS, isGuideKind } from "../../shared/types.ts";
import { TRACKER_KINDS, guideOpKey, taskKind, trackerOpKey } from "../tasks/registry.ts";

/**
 * The HTTP surface for §14's event triggers.
 *
 * The validation here is the interesting part. A trigger names an action by a
 * bare string — a guide kind, a tracker kind, a script's id — and a trigger
 * pointing at something that does not exist is a piece of automation that
 * silently never works. So the name is checked against the thing it names
 * before the row is written, which is the same argument as validating a regex
 * at save time rather than on the turn that needed it.
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

function text(value: unknown, max = 200): string | undefined {
  return typeof value === "string" ? value.slice(0, max) : undefined;
}

export function triggerRoutes(ctx: AppContext, runner: TriggerRunner): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  /**
   * What an action can point at, so the editor does not have to guess.
   *
   * Labelled here rather than in the client, because the guides and trackers
   * already have names the rest of the app shows - they are ops in §7's
   * registry, and the settings screen has been printing `Clothes` and `Scene
   * tracker` since phase 13. Sending the bare kinds would put `situational` on
   * screen next to `Clothes` for the same thing.
   */
  app.get("/actions", (c) =>
    c.json({
      events: TRIGGER_EVENTS,
      guide: GUIDE_KINDS.map((kind) => ({
        value: kind,
        label: taskKind(guideOpKey(kind))?.label ?? kind,
      })),
      tracker: TRACKER_KINDS.map((kind) => ({
        value: kind,
        label: taskKind(trackerOpKey(kind))?.label ?? kind,
      })),
      script: listScripts(ctx.db).map((script) => ({ value: script.id, label: script.name })),
    }),
  );

  app.get("/", (c) => c.json(listTriggerRows(ctx.db)));

  app.post("/", async (c) => {
    const input = await body(c);

    const name = text(input["name"], 120)?.trim() ?? "";
    if (name === "") return c.json(badRequest("A trigger needs a name."), 400);

    const event = text(input["event"]);
    if (event === undefined || !(TRIGGER_EVENTS as readonly string[]).includes(event)) {
      return c.json(badRequest("That is not an event."), 400);
    }
    const action = text(input["action"]);
    if (action === undefined || !(TRIGGER_ACTIONS as readonly string[]).includes(action)) {
      return c.json(badRequest("That is not an action."), 400);
    }

    const actionRef = text(input["actionRef"], 64) ?? "";
    const refProblem = problemWithRef(action, actionRef);
    if (refProblem !== null) return c.json(badRequest(refProblem), 400);

    // §10's other end. Without an id a lore trigger would fire on every
    // activation, which is not what "a named action" means.
    const isLore = event === "lore_activation";
    const automationId = text(input["automationId"], 64)?.trim() ?? "";
    if (isLore && automationId === "") {
      return c.json(badRequest("A lore trigger needs the automation id it answers to."), 400);
    }

    const scope = text(input["scope"]) ?? "global";
    if (scope !== "global" && scope !== "scene") {
      return c.json(badRequest("That is not a scope."), 400);
    }
    let sceneId: number | null = null;
    if (scope === "scene") {
      const scene = findScene(ctx.db, String(input["sceneId"] ?? ""));
      if (scene === null) return c.json(notFound("roleplay"), 404);
      sceneId = scene.id;
    }

    const row = insertTrigger(ctx.db, {
      name,
      event: event as (typeof TRIGGER_EVENTS)[number],
      action: action as (typeof TRIGGER_ACTIONS)[number],
      actionRef,
      automationId: isLore ? automationId : null,
      scope,
      sceneId,
      enabled: input["enabled"] !== false,
      runOrder: typeof input["runOrder"] === "number" ? Math.trunc(input["runOrder"]) : null,
    });
    return c.json(one(row.ulid), 201);
  });

  app.patch("/:triggerId", async (c) => {
    const row = findTrigger(ctx.db, c.req.param("triggerId"));
    if (row === null) return c.json(notFound("trigger"), 404);
    const input = await body(c);

    const patch: TriggerPatch = {};
    const name = text(input["name"], 120)?.trim();
    if (name !== undefined && name !== "") patch.name = name;
    if (typeof input["enabled"] === "boolean") patch.enabled = input["enabled"];
    if (typeof input["runOrder"] === "number") patch.runOrder = Math.trunc(input["runOrder"]);

    const actionRef = text(input["actionRef"], 64);
    if (actionRef !== undefined) {
      const problem = problemWithRef(row.action, actionRef);
      if (problem !== null) return c.json(badRequest(problem), 400);
      patch.actionRef = actionRef;
    }

    // The event decides whether an automation id may be set at all, and the
    // event is not editable, so this needs no second check.
    const automationId = text(input["automationId"], 64);
    if (automationId !== undefined && row.event === "lore_activation") {
      if (automationId.trim() === "") {
        return c.json(badRequest("A lore trigger needs the automation id it answers to."), 400);
      }
      patch.automationId = automationId.trim();
    }

    updateTrigger(ctx.db, row.id, patch);
    return c.json(one(row.ulid));
  });

  app.delete("/:triggerId", (c) => {
    const row = findTrigger(ctx.db, c.req.param("triggerId"));
    if (row === null) return c.json(notFound("trigger"), 404);
    deleteTrigger(ctx.db, row.id);
    return c.body(null, 204);
  });

  /**
   * Fire one trigger by hand, against a named roleplay.
   *
   * The counterpart to the scripts' test panel, and needed for the same reason:
   * a trigger bound to `lore_activation` may not fire for days, and "did I wire
   * this up correctly" should not be a question only the scene can answer.
   * Unlike the script panel this one is not a dry run — a guide refresh has
   * nowhere to happen but the scene — so the response says what it did.
   */
  app.post("/:triggerId/run", async (c) => {
    const row = findTrigger(ctx.db, c.req.param("triggerId"));
    if (row === null) return c.json(notFound("trigger"), 404);
    const input = await body(c);
    const scene = findScene(ctx.db, String(input["sceneId"] ?? ""));
    if (scene === null) return c.json(notFound("roleplay"), 404);

    const outcomes = await runner.fire(row.event, {
      scene,
      ...(row.event === "lore_activation" && row.automation_id !== null
        ? { automationIds: [row.automation_id] }
        : {}),
    });
    const mine = outcomes.find((outcome) => outcome.triggerId === row.ulid);
    // A trigger scoped to another scene selects nothing, which is the correct
    // answer and a confusing empty response, so it is said out loud.
    return c.json(
      mine ?? {
        triggerId: row.ulid,
        name: row.name,
        action: row.action,
        ran: false,
        detail: "This trigger does not apply to that roleplay.",
      },
    );
  });

  function problemWithRef(action: string, ref: string): string | null {
    if (ref === "") return "An action needs something to act on.";
    switch (action) {
      case "guide":
        return isGuideKind(ref) ? null : `${ref} is not a guide.`;
      case "tracker":
        return (TRACKER_KINDS as readonly string[]).includes(ref) ? null : `${ref} is not a tracker.`;
      case "script":
        return listScripts(ctx.db).some((script) => script.id === ref)
          ? null
          : "No such script.";
      default:
        return "That is not an action.";
    }
  }

  function one(triggerUlid: string) {
    const stored = listTriggerRows(ctx.db).find((trigger) => trigger.id === triggerUlid);
    if (stored === undefined) throw new Error("the trigger vanished after being written");
    return stored;
  }

  return app;
}
