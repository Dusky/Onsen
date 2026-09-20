/**
 * The agent (SPEC §20 phase 46).
 *
 * One SSE endpoint carries a turn, because a turn is a sequence of things
 * happening — a sentence, a tool firing, what it returned, another sentence —
 * and a request that answered only at the end would hide all of it behind a
 * spinner while the library was being edited.
 */
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import {
  appendAgentMessage,
  deleteThread,
  findThread,
  insertThread,
  listThreads,
  renameThread,
  threadMessages,
  toAgentMessageDto,
  toThreadDto,
} from "../db/queries/agent.ts";
import { runAgentTurn, type AgentAdapterFactory } from "../agent/loop.ts";
import { toolSpecs } from "../agent/tools.ts";
import { removeSnapshot, snapshotById, snapshots } from "../agent/snapshot.ts";
import { restoreSnapshot } from "../agent/restore.ts";
import { SettingKey, getSetting, setSetting } from "../db/queries/settings.ts";
import { badRequest, notFound } from "../lib/routes.ts";

const MAX_ASK = 8000;

export function agentRoutes(
  ctx: AppContext,
  createAdapter?: AgentAdapterFactory,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  /** What the agent can do, for the UI to show before anyone asks anything. */
  app.get("/tools", (c) =>
    c.json(toolSpecs().map((tool) => ({ name: tool.name, description: tool.description }))),
  );

  /** What it has overwritten, newest first. */
  app.get("/undo", (c) =>
    c.json(
      snapshots(ctx).map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        subjectId: entry.subjectId,
        label: labelOf(entry),
        at: entry.at,
      })),
    ),
  );

  /**
   * The connection profile the assistant runs on (§7's per-operation routing,
   * applied to the assistant as a whole). Null means the install's default,
   * which is what scenes use unless they say otherwise — so the assistant can
   * be pointed at a cheap model without touching anything else.
   */
  app.get("/profile", (c) =>
    c.json({ connectionProfileId: getSetting(ctx.db, SettingKey.assistantProfile) }),
  );

  app.patch("/profile", async (c) => {
    let body: { connectionProfileId?: unknown } = {};
    try {
      const parsed: unknown = await c.req.json();
      if (typeof parsed === "object" && parsed !== null) {
        body = parsed as { connectionProfileId?: unknown };
      }
    } catch {
      /* An empty body clears the override. */
    }

    if (body.connectionProfileId === null || body.connectionProfileId === undefined) {
      // Delete the key rather than storing null, so an absent profile and a
      // cleared one read the same on every path.
      ctx.db.query("DELETE FROM app_settings WHERE key = $key").run({
        key: SettingKey.assistantProfile,
      });
      return c.json({ connectionProfileId: null });
    }
    if (typeof body.connectionProfileId !== "string") {
      return c.json(badRequest("connectionProfileId must be a profile id, or null."), 400);
    }
    const profile = ctx.db
      .query("SELECT ulid FROM connection_profiles WHERE ulid = $ulid")
      .get({ ulid: body.connectionProfileId }) as { ulid: string } | null;
    if (profile === null) return c.json(badRequest("No such connection profile."), 400);
    setSetting(ctx.db, SettingKey.assistantProfile, body.connectionProfileId);
    return c.json({ connectionProfileId: body.connectionProfileId });
  });

  /**
   * Put one snapshot back.
   *
   * Every write tool records a snapshot before it touches anything, and
   * `server/agent/restore.ts` knows how to walk each kind back — which is what
   * makes "so it can be undone" true rather than a promise the list cannot
   * keep. It was a promise until §20 phase 219: two tools recorded, two kinds
   * restored, and the other seventeen changes were simply gone.
   *
   * What a restore is honest about travels in the response's `note`: a
   * re-created character comes back without its picture or lorebook bindings,
   * a re-created lore entry under a new id.
   */
  app.post("/undo/:id", (c) => {
    const snapshot = snapshotById(ctx, c.req.param("id"));
    if (snapshot === null) return c.json(notFound("snapshot"), 404);

    let restored: Record<string, unknown>;
    try {
      restored = restoreSnapshot(ctx, snapshot);
    } catch (caught) {
      return c.json(
        {
          error: {
            code: "corrupt",
            message: caught instanceof Error ? caught.message : "That snapshot could not be read.",
          },
        },
        500,
      );
    }

    removeSnapshot(ctx, snapshot.id);
    return c.json({ restored, removed: snapshot.id });
  });

  app.get("/threads", (c) => c.json(listThreads(ctx.db).map(toThreadDto)));

  app.post("/threads", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { title?: unknown };
    const title =
      typeof body.title === "string" && body.title.trim() !== ""
        ? body.title.trim().slice(0, 120)
        : "New thread";
    return c.json(toThreadDto(insertThread(ctx.db, title)), 201);
  });

  app.get("/threads/:threadId", (c) => {
    const thread = findThread(ctx.db, c.req.param("threadId"));
    if (thread === null) return c.json(notFound("thread"), 404);
    return c.json({
      thread: toThreadDto(thread),
      // Tool results are not shown as their own turns — they belong to the call
      // above them — but they are sent, so the UI can show what came back.
      messages: threadMessages(ctx.db, thread.id).map(toAgentMessageDto),
    });
  });

  app.patch("/threads/:threadId", async (c) => {
    const thread = findThread(ctx.db, c.req.param("threadId"));
    if (thread === null) return c.json(notFound("thread"), 404);
    const body = (await c.req.json().catch(() => ({}))) as { title?: unknown };
    if (typeof body.title !== "string" || body.title.trim() === "") {
      return c.json(badRequest("A title is required."), 400);
    }
    renameThread(ctx.db, thread.id, body.title.trim().slice(0, 120));
    return c.json(toThreadDto(findThread(ctx.db, thread.ulid)!));
  });

  app.delete("/threads/:threadId", (c) => {
    const thread = findThread(ctx.db, c.req.param("threadId"));
    if (thread === null) return c.json(notFound("thread"), 404);
    deleteThread(ctx.db, thread.id);
    return c.body(null, 204);
  });

  /**
   * Ask something, and watch it happen.
   *
   * The question is stored before the stream opens, so a connection that dies
   * mid-answer leaves a thread that still knows what was asked.
   */
  app.post("/threads/:threadId/messages", async (c) => {
    const thread = findThread(ctx.db, c.req.param("threadId"));
    if (thread === null) return c.json(notFound("thread"), 404);

    const body = (await c.req.json().catch(() => ({}))) as { content?: unknown };
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (content === "") return c.json(badRequest("Say something."), 400);
    if (content.length > MAX_ASK) return c.json(badRequest("That is too long."), 413);

    appendAgentMessage(ctx.db, { threadId: thread.id, role: "user", content });

    // A first question names the thread, so the list is readable without
    // anybody having to title anything.
    if (thread.title === "New thread") {
      renameThread(ctx.db, thread.id, content.slice(0, 60));
    }

    return streamSSE(c, async (stream) => {
      const controller = new AbortController();
      stream.onAbort(() => controller.abort());
      // Awaited, not fired and forgotten: an unawaited write races the stream
      // closing when the turn ends, and loses the whole answer.
      await runAgentTurn(
        ctx,
        thread,
        controller.signal,
        (event) => stream.writeSSE({ event: event.type, data: JSON.stringify(event) }),
        createAdapter,
      );
    });
  });

  return app;
}

/** The name the snapshot's subject had, so the undo list reads without a join. */
function labelOf(entry: { before: string }): string {
  try {
    const before = JSON.parse(entry.before) as { name?: unknown };
    return typeof before.name === "string" ? before.name : "something";
  } catch {
    return "something";
  }
}
