import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import { LORE_POSITIONS, type UpdateLoreEntryRequest } from "../../shared/types.ts";
import {
  bind,
  bindingsOf,
  deleteEntry,
  deleteLorebook,
  findEntry,
  findLorebook,
  insertEntry,
  insertLorebook,
  listEntries,
  listLorebooks,
  toBookDto,
  toEntryDto,
  unbind,
  updateEntry,
  updateLorebook,
  type LoreEntryRow,
} from "../db/queries/lore.ts";
import { parseWorldInfo } from "../lore/import.ts";

/**
 * Lorebooks over HTTP (SPEC §10).
 *
 * Books, entries, bindings, import, and the activation test tool §16 asks for
 * ("shows what would fire against the current scene"). That last one is the
 * reason the engine is pure and shared: a test tool running its own second
 * implementation would be a tool that lies.
 */
export function loreRoutes(ctx: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  const notFound = (what: string) => ({ error: { code: "not_found", message: `No such ${what}.` } });
  const badRequest = (message: string) => ({ error: { code: "bad_request", message } });

  async function body(c: { req: { json(): Promise<unknown> } }): Promise<Record<string, unknown>> {
    try {
      const parsed: unknown = await c.req.json();
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  app.get("/", (c) => c.json(listLorebooks(ctx.db).map((row) => toBookDto(ctx.db, row))));

  app.post("/", async (c) => {
    const input = await body(c);
    const name = typeof input["name"] === "string" ? input["name"].trim() : "";
    if (name === "") return c.json(badRequest("A lorebook needs a name."), 400);
    const row = insertLorebook(ctx.db, {
      name,
      description: typeof input["description"] === "string" ? input["description"] : null,
    });
    return c.json(toBookDto(ctx.db, row), 201);
  });

  /**
   * Import SillyTavern world info (§10 interop).
   *
   * The whole file is kept on the book and each source object on its entry, so
   * an export can re-emit fields this app has never heard of. Lossy round-trips
   * are this ecosystem's standard failure and the reason `raw_card` exists.
   */
  app.post("/import", async (c) => {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return c.json(badRequest("Send a world info file."), 400);

    const parsed = parseWorldInfo(await file.text(), file.name.replace(/\.json$/i, ""));
    if (parsed === null) {
      return c.json(badRequest("That does not look like a world info file."), 400);
    }

    const book = insertLorebook(ctx.db, { name: parsed.name, rawImport: parsed.raw });
    updateLorebook(ctx.db, book.id, {
      ...(parsed.scanDepth === null ? {} : { scan_depth: parsed.scanDepth }),
      ...(parsed.tokenBudget === null ? {} : { token_budget: parsed.tokenBudget }),
      ...(parsed.recursionDepth === null ? {} : { recursion_depth: parsed.recursionDepth }),
    });
    for (const entry of parsed.entries) {
      const row = insertEntry(ctx.db, book.id, String(entry.columns.content ?? ""));
      updateEntry(ctx.db, row.id, entry.columns);
    }

    const stored = findLorebook(ctx.db, book.ulid)!;
    return c.json({ lorebook: toBookDto(ctx.db, stored), entries: parsed.entries.length }, 201);
  });

  app.get("/:bookId", (c) => {
    const book = findLorebook(ctx.db, c.req.param("bookId"));
    if (book === null) return c.json(notFound("lorebook"), 404);
    return c.json({
      lorebook: toBookDto(ctx.db, book),
      entries: listEntries(ctx.db, book.id).map((row) => toEntryDto(row, book.ulid)),
    });
  });

  app.patch("/:bookId", async (c) => {
    const book = findLorebook(ctx.db, c.req.param("bookId"));
    if (book === null) return c.json(notFound("lorebook"), 404);
    const input = await body(c);

    const patch: Parameters<typeof updateLorebook>[2] = {};
    if (typeof input["name"] === "string" && input["name"].trim() !== "") {
      patch.name = input["name"].trim();
    }
    if ("description" in input) {
      patch.description = typeof input["description"] === "string" ? input["description"] : null;
    }
    for (const [field, column, min, max] of [
      ["tokenBudget", "token_budget", 0, 100_000],
      ["scanDepth", "scan_depth", 0, 200],
      ["recursionDepth", "recursion_depth", 0, 10],
    ] as const) {
      if (!(field in input)) continue;
      const value = input[field];
      if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
        return c.json(badRequest(`${field} must be a whole number between ${min} and ${max}.`), 400);
      }
      patch[column] = value;
    }
    return c.json(toBookDto(ctx.db, updateLorebook(ctx.db, book.id, patch)));
  });

  app.delete("/:bookId", (c) => {
    const book = findLorebook(ctx.db, c.req.param("bookId"));
    if (book === null) return c.json(notFound("lorebook"), 404);
    deleteLorebook(ctx.db, book.id);
    return c.json({ ok: true });
  });

  /* ---------------- entries ---------------- */

  app.post("/:bookId/entries", async (c) => {
    const book = findLorebook(ctx.db, c.req.param("bookId"));
    if (book === null) return c.json(notFound("lorebook"), 404);
    const input = await body(c);
    const content = typeof input["content"] === "string" ? input["content"] : "";
    const row = insertEntry(ctx.db, book.id, content);
    return c.json(toEntryDto(row, book.ulid), 201);
  });

  app.patch("/:bookId/entries/:entryId", async (c) => {
    const book = findLorebook(ctx.db, c.req.param("bookId"));
    if (book === null) return c.json(notFound("lorebook"), 404);
    const entry = findEntry(ctx.db, c.req.param("entryId"));
    if (entry === null || entry.lorebook_id !== book.id) return c.json(notFound("entry"), 404);

    const input = (await body(c)) as UpdateLoreEntryRequest;
    const patch: Partial<LoreEntryRow> = {};

    const text = (field: keyof UpdateLoreEntryRequest, column: keyof LoreEntryRow) => {
      if (!(field in input)) return;
      const value = input[field];
      if (typeof value === "string") (patch[column] as unknown) = value;
    };
    const flag = (field: keyof UpdateLoreEntryRequest, column: keyof LoreEntryRow) => {
      if (!(field in input)) return;
      const value = input[field];
      if (typeof value === "boolean") (patch[column] as unknown) = value ? 1 : 0;
    };
    const whole = (
      field: keyof UpdateLoreEntryRequest,
      column: keyof LoreEntryRow,
      min: number,
      max: number,
    ): string | null => {
      if (!(field in input)) return null;
      const value = input[field];
      if (value === null) {
        (patch[column] as unknown) = null;
        return null;
      }
      if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
        return `${field} must be a whole number between ${min} and ${max}.`;
      }
      (patch[column] as unknown) = value;
      return null;
    };
    const list = (field: keyof UpdateLoreEntryRequest, column: keyof LoreEntryRow) => {
      if (!(field in input)) return;
      const value = input[field];
      if (Array.isArray(value)) {
        (patch[column] as unknown) = JSON.stringify(
          value.filter((item): item is string => typeof item === "string"),
        );
      }
    };

    text("title", "title");
    text("content", "content");
    flag("enabled", "enabled");
    list("keys", "keys");
    list("secondaryKeys", "secondary_keys");
    list("characterFilter", "character_filter");
    flag("caseSensitive", "case_sensitive");
    flag("matchWholeWords", "match_whole_words");
    flag("useRegex", "use_regex");
    flag("isConstant", "is_constant");
    flag("nonRecursable", "non_recursable");
    flag("preventFurtherRecursion", "prevent_further_recursion");

    for (const [field, column, min, max] of [
      ["probability", "probability", 0, 100],
      ["scanDepth", "scan_depth", 0, 200],
      ["sticky", "sticky", 0, 500],
      ["cooldown", "cooldown", 0, 500],
      ["delay", "delay", 0, 5000],
      ["groupWeight", "group_weight", 0, 10_000],
      ["insertionOrder", "insertion_order", 0, 10_000],
      ["insertionDepth", "insertion_depth", 0, 200],
      ["recursionLevel", "recursion_level", 0, 20],
    ] as const) {
      const problem = whole(field, column, min, max);
      if (problem !== null) return c.json(badRequest(problem), 400);
    }

    for (const [field, column, allowed] of [
      ["secondaryLogic", "secondary_logic", ["and_any", "and_all", "not_any", "not_all"]],
      ["delayFrom", "delay_from", ["scene_start", "branch_point"]],
      ["groupSelection", "group_selection", ["weight", "prioritize", "score"]],
      ["insertionRole", "insertion_role", ["system", "user", "assistant"]],
      ["position", "position", LORE_POSITIONS as unknown as string[]],
    ] as const) {
      if (!(field in input)) continue;
      const value: unknown = input[field];
      if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
        return c.json(badRequest(`${field} is not one this app knows.`), 400);
      }
      (patch[column] as unknown) = value;
    }

    for (const [field, column] of [
      ["inclusionGroup", "inclusion_group"],
      ["outletName", "outlet_name"],
      ["automationId", "automation_id"],
    ] as const) {
      if (!(field in input)) continue;
      const value = input[field];
      (patch[column] as unknown) =
        typeof value === "string" && value.trim() !== "" ? value.trim() : null;
    }

    return c.json(toEntryDto(updateEntry(ctx.db, entry.id, patch), book.ulid));
  });

  app.delete("/:bookId/entries/:entryId", (c) => {
    const book = findLorebook(ctx.db, c.req.param("bookId"));
    if (book === null) return c.json(notFound("lorebook"), 404);
    const entry = findEntry(ctx.db, c.req.param("entryId"));
    if (entry === null || entry.lorebook_id !== book.id) return c.json(notFound("entry"), 404);
    deleteEntry(ctx.db, entry.id);
    return c.json({ ok: true });
  });

  /* ---------------- bindings ---------------- */

  app.post("/:bookId/bindings", async (c) => {
    const book = findLorebook(ctx.db, c.req.param("bookId"));
    if (book === null) return c.json(notFound("lorebook"), 404);
    const input = await body(c);
    const scope = input["scope"];
    if (scope !== "global" && scope !== "scene" && scope !== "character" && scope !== "persona") {
      return c.json(badRequest("Bind it globally, or to a roleplay, character or persona."), 400);
    }

    let targetId: number | null = null;
    if (scope !== "global") {
      const table = scope === "scene" ? "scenes" : scope === "character" ? "characters" : "personas";
      const value = input["targetId"];
      const row =
        typeof value === "string"
          ? (ctx.db.query(`SELECT id FROM ${table} WHERE ulid = $ulid`).get({ ulid: value }) as
              | { id: number }
              | null)
          : null;
      if (row === null) return c.json(badRequest(`No such ${scope}.`), 400);
      targetId = row.id;
    }

    // Binding the same book the same way twice is a no-op rather than an error:
    // it is already true, which is what the caller wanted.
    const already = bindingsOf(ctx.db, book.id).some(
      (row) =>
        row.scope === scope &&
        (row.scene_id ?? row.character_id ?? row.persona_id ?? null) === targetId,
    );
    if (!already) bind(ctx.db, book.id, scope, targetId);
    return c.json(toBookDto(ctx.db, book));
  });

  app.delete("/:bookId/bindings/:bindingId", (c) => {
    const book = findLorebook(ctx.db, c.req.param("bookId"));
    if (book === null) return c.json(notFound("lorebook"), 404);
    const id = Number.parseInt(c.req.param("bindingId"), 10);
    if (!Number.isInteger(id)) return c.json(notFound("binding"), 404);
    unbind(ctx.db, id);
    return c.json(toBookDto(ctx.db, book));
  });

  return app;
}
