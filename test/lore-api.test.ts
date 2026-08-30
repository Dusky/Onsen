import { afterEach, describe, expect, test } from "bun:test";
import { createHarness, completeSetup, type TestHarness } from "./helpers.ts";
import { V2_CARD, pngCard } from "./card-fixtures.ts";
import { parseWorldInfo } from "../server/lore/import.ts";
import { buildPromptContext } from "../server/generation/context.ts";
import { buildPrompt } from "../server/prompt/index.ts";
import { OPENAI_COMPATIBLE_CAPABILITIES } from "../server/adapters/index.ts";
import { findScene } from "../server/db/queries/history.ts";
import type {
  CharacterDto,
  ConnectionProfileDto,
  LoreActivationDto,
  LoreEntryDto,
  LorebookDto,
  SceneDto,
} from "../shared/types.ts";

/**
 * Lorebooks over HTTP, and the part that decides whether the feature is usable
 * by the audience it is for: the SillyTavern round-trip (SPEC §10 interop).
 */

let harness: TestHarness | null = null;

async function signedIn(): Promise<TestHarness> {
  if (harness === null) {
    harness = createHarness();
    await completeSetup(harness);
  }
  return harness;
}

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

async function json<T>(t: TestHarness, method: string, path: string, body?: unknown): Promise<T> {
  const response = await t.fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  return (await response.json()) as T;
}

async function statusOf(t: TestHarness, method: string, path: string, body?: unknown) {
  const response = await t.fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  return response.status;
}

async function book(t: TestHarness, name = "The ridge"): Promise<LorebookDto> {
  return json<LorebookDto>(t, "POST", "/api/lorebooks", { name });
}

async function entry(
  t: TestHarness,
  bookId: string,
  patch: Partial<LoreEntryDto> = {},
): Promise<LoreEntryDto> {
  const created = await json<LoreEntryDto>(t, "POST", `/api/lorebooks/${bookId}/entries`, {
    content: patch.content ?? "The station runs on lamp oil.",
  });
  if (Object.keys(patch).length === 0) return created;
  return json<LoreEntryDto>(t, "PATCH", `/api/lorebooks/${bookId}/entries/${created.id}`, patch);
}

async function scene(t: TestHarness) {
  const form = new FormData();
  form.append("file", new File([pngCard({ chara: V2_CARD }) as unknown as BlobPart], "bell.png"));
  const { character } = (await (
    await t.fetch("/api/characters/import", { method: "POST", body: form })
  ).json()) as { character: CharacterDto };

  const profiles = await json<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
  const created = await json<SceneDto>(t, "POST", "/api/scenes", {
    title: "Ridge station",
    connectionProfileId: profiles[0]!.id,
  });
  await json<SceneDto>(t, "PUT", `/api/scenes/${created.id}/cast/${character.id}`);
  return { sceneId: created.id, characterId: character.id };
}

function loreBlocks(t: TestHarness, sceneId: string) {
  const built = buildPrompt(
    buildPromptContext({
      db: t.ctx.db,
      scene: findScene(t.ctx.db, sceneId)!,
      capabilities: OPENAI_COMPATIBLE_CAPABILITIES,
      now: Date.now(),
      seed: 1,
    }),
  );
  return built.debug.blocks.filter(
    (block) => block.id === "constant_lore" || block.id === "matched_lore",
  );
}

describe("books and entries", () => {
  test("created, listed, edited and deleted", async () => {
    const t = await signedIn();
    const created = await book(t);
    expect(created.entryCount).toBe(0);

    const patched = await json<LorebookDto>(t, "PATCH", `/api/lorebooks/${created.id}`, {
      scanDepth: 12,
      tokenBudget: 500,
    });
    expect(patched.scanDepth).toBe(12);
    expect(patched.tokenBudget).toBe(500);

    await entry(t, created.id);
    const read = await json<{ lorebook: LorebookDto; entries: LoreEntryDto[] }>(
      t,
      "GET",
      `/api/lorebooks/${created.id}`,
    );
    expect(read.entries.length).toBe(1);
    // §10 prices a book, so an entry has to carry what it costs.
    expect(read.entries[0]!.tokenCount).toBeGreaterThan(0);

    await json(t, "DELETE", `/api/lorebooks/${created.id}`);
    expect((await json<LorebookDto[]>(t, "GET", "/api/lorebooks")).length).toBe(0);
  });

  test("out-of-range settings are refused", async () => {
    const t = await signedIn();
    const created = await book(t);
    expect(await statusOf(t, "PATCH", `/api/lorebooks/${created.id}`, { scanDepth: -1 })).toBe(400);
    const made = await entry(t, created.id);
    expect(
      await statusOf(t, "PATCH", `/api/lorebooks/${created.id}/entries/${made.id}`, {
        probability: 500,
      }),
    ).toBe(400);
    expect(
      await statusOf(t, "PATCH", `/api/lorebooks/${created.id}/entries/${made.id}`, {
        position: "somewhere",
      }),
    ).toBe(400);
  });

  test("an entry from another book is not reachable", async () => {
    const t = await signedIn();
    const one = await book(t, "One");
    const two = await book(t, "Two");
    const made = await entry(t, one.id);
    expect(await statusOf(t, "PATCH", `/api/lorebooks/${two.id}/entries/${made.id}`, {})).toBe(404);
  });
});

describe("bindings", () => {
  test("a book bound to a scene reaches that scene and no other", async () => {
    const t = await signedIn();
    const one = await scene(t);
    const two = await scene(t);
    const created = await book(t);
    await entry(t, created.id, { keys: ["oil"], isConstant: true });

    await json<LorebookDto>(t, "POST", `/api/lorebooks/${created.id}/bindings`, {
      scope: "scene",
      targetId: one.sceneId,
    });

    expect(loreBlocks(t, one.sceneId).length).toBe(1);
    expect(loreBlocks(t, two.sceneId).length).toBe(0);
  });

  test("a global book reaches everything", async () => {
    const t = await signedIn();
    const made = await scene(t);
    const created = await book(t);
    await entry(t, created.id, { isConstant: true });
    await json<LorebookDto>(t, "POST", `/api/lorebooks/${created.id}/bindings`, {
      scope: "global",
    });
    expect(loreBlocks(t, made.sceneId).length).toBe(1);
  });

  test("a character's book comes with them", async () => {
    const t = await signedIn();
    const made = await scene(t);
    const created = await book(t);
    await entry(t, created.id, { isConstant: true });
    await json<LorebookDto>(t, "POST", `/api/lorebooks/${created.id}/bindings`, {
      scope: "character",
      targetId: made.characterId,
    });
    expect(loreBlocks(t, made.sceneId).length).toBe(1);
  });

  test("binding the same way twice is a no-op, not an error", async () => {
    const t = await signedIn();
    const created = await book(t);
    await json<LorebookDto>(t, "POST", `/api/lorebooks/${created.id}/bindings`, { scope: "global" });
    const again = await json<LorebookDto>(t, "POST", `/api/lorebooks/${created.id}/bindings`, {
      scope: "global",
    });
    expect(again.bindings.length).toBe(1);
  });

  test("a book bound two ways contributes its entries once", async () => {
    const t = await signedIn();
    const made = await scene(t);
    const created = await book(t);
    await entry(t, created.id, { isConstant: true });
    await json<LorebookDto>(t, "POST", `/api/lorebooks/${created.id}/bindings`, { scope: "global" });
    await json<LorebookDto>(t, "POST", `/api/lorebooks/${created.id}/bindings`, {
      scope: "scene",
      targetId: made.sceneId,
    });
    // A reader who bound it twice meant "definitely include it", not "twice".
    expect(loreBlocks(t, made.sceneId).length).toBe(1);
  });

  test("an unknown target is refused", async () => {
    const t = await signedIn();
    const created = await book(t);
    expect(
      await statusOf(t, "POST", `/api/lorebooks/${created.id}/bindings`, {
        scope: "scene",
        targetId: "nope",
      }),
    ).toBe(400);
  });
});

describe("what reaches the prompt", () => {
  test("a matched entry lands at its position, a constant one in the prefix", async () => {
    const t = await signedIn();
    const made = await scene(t);
    await json(t, "POST", `/api/scenes/${made.sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "Has anyone counted the lamp oil?",
    });

    const created = await book(t);
    await json<LorebookDto>(t, "POST", `/api/lorebooks/${created.id}/bindings`, { scope: "global" });
    await entry(t, created.id, { keys: ["oil"], position: "at_depth", content: "Oil is short." });
    await entry(t, created.id, { isConstant: true, content: "The ridge is three days from the coast." });

    const blocks = loreBlocks(t, made.sceneId);
    expect(blocks.some((b) => b.id === "matched_lore" && b.content.includes("Oil is short"))).toBe(true);
    expect(blocks.some((b) => b.id === "constant_lore")).toBe(true);
  });

  test("an entry nobody mentioned stays out", async () => {
    const t = await signedIn();
    const made = await scene(t);
    const created = await book(t);
    await json<LorebookDto>(t, "POST", `/api/lorebooks/${created.id}/bindings`, { scope: "global" });
    await entry(t, created.id, { keys: ["ledger"] });
    expect(loreBlocks(t, made.sceneId).length).toBe(0);
  });

  test("editing an entry clears its timed state", async () => {
    const t = await signedIn();
    const made = await scene(t);
    const created = await book(t);
    const row = await entry(t, created.id, { sticky: 5 });

    const stored = t.ctx.db.query("SELECT id FROM lore_entries WHERE ulid = $u").get({ u: row.id }) as { id: number };
    const scene_ = findScene(t.ctx.db, made.sceneId)!;
    const message = await json<{ id: string }>(t, "POST", `/api/scenes/${made.sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "oil",
    });
    const messageRow = t.ctx.db.query("SELECT id FROM messages WHERE ulid = $u").get({ u: message.id }) as { id: number };
    t.ctx.db
      .query(
        `INSERT INTO lore_timed_effects (scene_id, entry_id, message_id, created_at)
         VALUES ($s, $e, $m, 1)`,
      )
      .run({ s: scene_.id, e: stored.id, m: messageRow.id });

    await json<LoreEntryDto>(t, "PATCH", `/api/lorebooks/${created.id}/entries/${row.id}`, {
      content: "Rewritten.",
    });
    // §10: timed effects are forcibly cleared when the entry is edited —
    // otherwise the change appears not to have taken until the window runs out.
    const left = t.ctx.db
      .query("SELECT COUNT(*) AS n FROM lore_timed_effects WHERE entry_id = $e")
      .get({ e: stored.id }) as { n: number };
    expect(left.n).toBe(0);
  });
});

describe("the activation test tool", () => {
  test("reports what fired and what did not, with the reason", async () => {
    const t = await signedIn();
    const made = await scene(t);
    await json(t, "POST", `/api/scenes/${made.sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "Has anyone counted the lamp oil?",
    });
    const created = await book(t);
    await json<LorebookDto>(t, "POST", `/api/lorebooks/${created.id}/bindings`, { scope: "global" });
    await entry(t, created.id, { keys: ["oil"], title: "Oil" });
    await entry(t, created.id, { keys: ["ledger"], title: "Ledger" });

    const trace = await json<LoreActivationDto[]>(t, "GET", `/api/scenes/${made.sceneId}/lore`);
    const oil = trace.find((row) => row.title === "Oil")!;
    const ledger = trace.find((row) => row.title === "Ledger")!;
    expect(oil.skipped).toBeNull();
    expect(oil.matchedKey).toBe("oil");
    expect(ledger.skipped).toBe("no_match");
  });
});

describe("SillyTavern interop", () => {
  /** A world info file in the shape SillyTavern actually exports. */
  const WORLD = JSON.stringify({
    name: "Coldharbour",
    entries: {
      "0": {
        uid: 0,
        key: ["Coldharbour", "the coast"],
        keysecondary: ["ship"],
        selectiveLogic: 3,
        comment: "The port",
        content: "Coldharbour is three days south along the coast road.",
        constant: false,
        order: 42,
        position: 0,
        depth: 6,
        probability: 75,
        group: "places",
        groupWeight: 60,
        sticky: 3,
        cooldown: 5,
        delay: 2,
        caseSensitive: true,
        matchWholeWords: false,
        automationId: "refresh-map",
        // A field this app has never heard of, which must survive the round trip.
        someFutureField: { nested: true },
      },
      "1": { uid: 1, key: "oil", content: "Lamp oil comes up by barge.", disable: true },
    },
  });

  test("the shapes SillyTavern uses are read, including its enums", () => {
    const parsed = parseWorldInfo(WORLD, "fallback")!;
    expect(parsed.name).toBe("Coldharbour");
    expect(parsed.entries.length).toBe(2);

    const port = parsed.entries[0]!.columns;
    expect(JSON.parse(port.keys as string)).toEqual(["Coldharbour", "the coast"]);
    // selectiveLogic 3 is AND ALL in SillyTavern's enum, not the third of ours.
    expect(port.secondary_logic).toBe("and_all");
    // position 0 is before the character definition.
    expect(port.position).toBe("before_character");
    expect(port.probability).toBe(75);
    expect(port.sticky).toBe(3);
    expect(port.case_sensitive).toBe(1);
    expect(port.match_whole_words).toBe(0);
    expect(port.automation_id).toBe("refresh-map");

    // A comma-separated key string, which some exports use instead of an array.
    expect(JSON.parse(parsed.entries[1]!.columns.keys as string)).toEqual(["oil"]);
    // `disable: true` is how SillyTavern turns an entry off.
    expect(parsed.entries[1]!.columns.enabled).toBe(0);
  });

  test("a field this app has never heard of survives the import", () => {
    const parsed = parseWorldInfo(WORLD, "fallback")!;
    const raw = JSON.parse(parsed.entries[0]!.columns.raw_entry as string) as Record<string, unknown>;
    // The lesson of `raw_card`: lossy round-tripping is this ecosystem's
    // standard migration failure, so the source object is kept verbatim.
    expect(raw["someFutureField"]).toEqual({ nested: true });
  });

  test("importing a file makes a usable book", async () => {
    const t = await signedIn();
    const form = new FormData();
    form.append("file", new File([WORLD], "coldharbour.json", { type: "application/json" }));
    const response = await t.fetch("/api/lorebooks/import", { method: "POST", body: form });
    expect(response.status).toBe(201);
    const { lorebook, entries } = (await response.json()) as {
      lorebook: LorebookDto;
      entries: number;
    };
    expect(lorebook.name).toBe("Coldharbour");
    expect(entries).toBe(2);

    const read = await json<{ entries: LoreEntryDto[] }>(t, "GET", `/api/lorebooks/${lorebook.id}`);
    const port = read.entries.find((row) => row.title === "The port")!;
    expect(port.keys).toEqual(["Coldharbour", "the coast"]);
    expect(port.inclusionGroup).toBe("places");
    expect(port.groupWeight).toBe(60);
    expect(port.insertionOrder).toBe(42);
  });

  test("something that is not world info is refused, not thrown", async () => {
    const t = await signedIn();
    const form = new FormData();
    form.append("file", new File(["{}"], "empty.json", { type: "application/json" }));
    const response = await t.fetch("/api/lorebooks/import", { method: "POST", body: form });
    expect(response.status).toBe(400);
    expect(parseWorldInfo("not json at all", "x")).toBeNull();
  });
});
