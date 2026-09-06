import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import {
  deleteQuickReply,
  findQuickReply,
  insertQuickReply,
  listQuickReplies,
  moveQuickReply,
  updateQuickReply,
} from "../db/queries/quick-replies.ts";
import {
  isQuickReplyDirection,
  type QuickReplyDto,
} from "../../shared/types.ts";

/**
 * The HTTP surface for §7's quick replies (SPEC §20 phase 65).
 *
 * Thin CRUD. The whole point of a quick reply is that firing one is one tap,
 * so nothing here touches the generation service — the client sends the stored
 * prompt through the nudge path it already has, and this module only keeps the
 * rows and their order.
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

function text(value: unknown, max = 2_000): string | undefined {
  return typeof value === "string" ? value.slice(0, max) : undefined;
}

function toDto(row: {
  id: number;
  ulid: string;
  label: string;
  prompt: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
}): QuickReplyDto {
  return {
    id: row.ulid,
    label: row.label,
    prompt: row.prompt,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function quickReplyRoutes(ctx: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  app.get("/", (c) => c.json(listQuickReplies(ctx.db).map(toDto) satisfies QuickReplyDto[]));

  app.post("/", async (c) => {
    const input = await body(c);

    const label = text(input["label"], 120)?.trim() ?? "";
    if (label === "") return c.json(badRequest("A quick reply needs a label."), 400);
    const prompt = text(input["prompt"], 2_000)?.trim() ?? "";
    if (prompt === "") return c.json(badRequest("A quick reply needs a prompt."), 400);

    const row = insertQuickReply(ctx.db, { label, prompt });
    return c.json(toDto(row), 201);
  });

  app.patch("/:replyId", async (c) => {
    const row = findQuickReply(ctx.db, c.req.param("replyId"));
    if (row === null) return c.json(notFound("quick reply"), 404);
    const input = await body(c);

    const patch: { label?: string; prompt?: string } = {};
    const label = text(input["label"], 120)?.trim();
    if (label !== undefined && label !== "") patch.label = label;
    const prompt = text(input["prompt"], 2_000)?.trim();
    if (prompt !== undefined && prompt !== "") patch.prompt = prompt;

    updateQuickReply(ctx.db, row.id, patch);
    const stored = findQuickReply(ctx.db, row.ulid);
    if (stored === null) throw new Error("the quick reply vanished after being written");
    return c.json(toDto(stored));
  });

  /** Reorder one place at a time, the same move the editor offers. */
  app.post("/:replyId/move", async (c) => {
    const row = findQuickReply(ctx.db, c.req.param("replyId"));
    if (row === null) return c.json(notFound("quick reply"), 404);
    const input = await body(c);

    if (!isQuickReplyDirection(input["direction"])) {
      return c.json(badRequest("That is not a direction."), 400);
    }
    moveQuickReply(ctx.db, row.ulid, input["direction"]);
    return c.json(listQuickReplies(ctx.db).map(toDto) satisfies QuickReplyDto[]);
  });

  app.delete("/:replyId", (c) => {
    const row = findQuickReply(ctx.db, c.req.param("replyId"));
    if (row === null) return c.json(notFound("quick reply"), 404);
    deleteQuickReply(ctx.db, row.id);
    return c.body(null, 204);
  });

  return app;
}
