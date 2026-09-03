import { afterEach, describe, expect, test } from "bun:test";
import { zipSync } from "fflate";
import { completeSetup, createHarness, type TestHarness } from "./helpers.ts";
import { V2_CARD, pngCard } from "./card-fixtures.ts";
import { readManifest, satisfiesHost, PackError } from "../server/packs/manifest.ts";
import { readPack, safeName } from "../server/packs/archive.ts";
import { addBan } from "../server/db/queries/options.ts";

/**
 * Packs (SPEC §15 tier 2, §20 phase 34).
 *
 * §23 names two things this must prove: transactional rollback on a malformed
 * pack, and that uninstall removes exactly what install added and nothing else.
 * Both are here, and the second is the harder one — it is why ownership is
 * recorded by row id rather than by name.
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

/** Build a pack archive in memory, the way a real one arrives. */
function pack(
  files: Record<string, string | Uint8Array>,
  manifest: Record<string, unknown> = {},
): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    "pack.json": new TextEncoder().encode(
      JSON.stringify({ name: "The ridge", version: "1.0.0", ...manifest }),
    ),
  };
  for (const [path, body] of Object.entries(files)) {
    entries[path] = typeof body === "string" ? new TextEncoder().encode(body) : body;
  }
  return zipSync(entries);
}

async function send(
  t: TestHarness,
  path: string,
  bytes: Uint8Array,
): Promise<{ status: number; body: unknown }> {
  const form = new FormData();
  form.append("file", new File([bytes as unknown as BlobPart], "pack.onsenpack"));
  const response = await t.fetch(path, { method: "POST", body: form });
  return { status: response.status, body: await response.json() };
}

const LOREBOOK = JSON.stringify({
  name: "The ridge",
  description: "What the station knows.",
  entries: [
    {
      title: "Lamp oil",
      content: "The station runs on lamp oil.",
      keys: ["oil", "lamp"],
      sticky: 3,
      cooldown: 2,
      insertionOrder: 42,
      isConstant: false,
      automationId: "storm",
    },
  ],
});

const SCRIPT = JSON.stringify({
  name: "Em dashes",
  pattern: "--",
  replacement: "—",
  flags: "g",
  applyTo: "ai_output",
  enabled: true,
});

describe("the manifest", () => {
  test("a pack with no name or version cannot be uninstalled, so it is refused", () => {
    expect(() => readManifest(JSON.stringify({ version: "1" }))).toThrow(PackError);
    expect(() => readManifest(JSON.stringify({ name: "x" }))).toThrow(PackError);
    expect(() => readManifest("not json")).toThrow(PackError);
  });

  test("host ranges in the forms that mean something", () => {
    expect(satisfiesHost(null)).toBeNull();
    expect(satisfiesHost("1.x")).toBeNull();
    expect(satisfiesHost("1.0.x")).toBeNull();
    expect(satisfiesHost(">=1.0 <2")).toBeNull();
    expect(satisfiesHost("2.x")).not.toBeNull();
    expect(satisfiesHost(">=2.0")).not.toBeNull();
    // A range this cannot read is refused rather than assumed compatible: a
    // pack that asked for something and got silence has been misread.
    expect(satisfiesHost("^1.2.3")).not.toBeNull();
  });

  test("snake_case and camelCase both read, since packs come from elsewhere", () => {
    expect(readManifest(JSON.stringify({ name: "a", version: "1", host_api_range: "1.x" }))
      .hostApiRange).toBe("1.x");
    expect(readManifest(JSON.stringify({ name: "a", version: "1", hostApiRange: "2.x" }))
      .hostApiRange).toBe("2.x");
  });
});

describe("the archive", () => {
  test("an archive with no pack.json is not a pack", () => {
    expect(() => readPack(zipSync({ "characters/a.json": new Uint8Array() }))).toThrow(PackError);
  });

  test("a directory this version has never heard of is ignored, not refused", () => {
    const contents = readPack(pack({ "sounds/bell.json": "{}", "regex/a.json": SCRIPT }));
    expect(contents.documents.regex).toHaveLength(1);
  });

  test("a file name cannot escape its directory", () => {
    expect(safeName("../../etc/passwd", "x")).not.toContain("/");
    expect(safeName("...", "fallback")).toBe("fallback");
    expect(safeName("The ridge", "x")).toBe("The-ridge");
  });
});

describe("previewing", () => {
  test("says what would be added, without writing any of it", async () => {
    const t = await signedIn();
    const { status, body } = await send(
      t,
      "/api/packs/preview",
      pack({ "lorebooks/ridge.json": LOREBOOK, "regex/dashes.json": SCRIPT }),
    );
    expect(status).toBe(200);
    const plan = body as { items: { name: string; action: string }[]; problem: string | null };
    expect(plan.problem).toBeNull();
    expect(plan.items.map((item) => [item.name, item.action])).toEqual([
      ["The ridge", "add"],
      ["Em dashes", "add"],
    ]);
    expect((await json<{ packs: unknown[] }>(t, "GET", "/api/packs")).packs).toHaveLength(0);
    expect(t.ctx.db.query("SELECT count(*) AS n FROM lorebooks").get()).toEqual({ n: 0 });
  });

  test("a name already in use is reported and left alone", async () => {
    const t = await signedIn();
    await json(t, "POST", "/api/lorebooks", { name: "The ridge" });
    const { body } = await send(t, "/api/packs/preview", pack({ "lorebooks/r.json": LOREBOOK }));
    const plan = body as { items: { action: string; detail: string }[] };
    expect(plan.items[0]?.action).toBe("skip");
    expect(plan.items[0]?.detail).toContain("Already here");
  });

  test("a card is named by the card, not by the file it arrived in", async () => {
    const t = await signedIn();
    const card = pngCard({ chara: V2_CARD }) as unknown as Uint8Array;
    const { body } = await send(t, "/api/packs/preview", pack({ "characters/whatever.png": card }));
    const plan = body as { items: { kind: string; name: string }[] };
    expect(plan.items[0]?.kind).toBe("characters");
    expect(plan.items[0]?.name).not.toContain("whatever");
  });

  test("a pack for a later host is refused before anything is read", async () => {
    const t = await signedIn();
    const { body } = await send(
      t,
      "/api/packs/preview",
      pack({ "regex/a.json": SCRIPT }, { host_api_range: "9.x" }),
    );
    expect((body as { problem: string | null }).problem).toContain("9.x");
  });
});

describe("installing", () => {
  test("brings everything the archive carries, with every field intact", async () => {
    const t = await signedIn();
    const { status } = await send(
      t,
      "/api/packs/install",
      pack({ "lorebooks/ridge.json": LOREBOOK, "regex/dashes.json": SCRIPT }),
    );
    expect(status).toBe(201);

    const entry = t.ctx.db.query("SELECT * FROM lore_entries").get() as Record<string, unknown>;
    // A pack that carried an entry's keys and dropped its sticky window would
    // install something that looks right and behaves differently.
    expect(entry["sticky"]).toBe(3);
    expect(entry["cooldown"]).toBe(2);
    expect(entry["insertion_order"]).toBe(42);
    expect(entry["automation_id"]).toBe("storm");
    expect(JSON.parse(String(entry["keys"]))).toEqual(["oil", "lamp"]);
  });

  test("the same pack and version twice is refused", async () => {
    const t = await signedIn();
    const archive = pack({ "regex/a.json": SCRIPT });
    expect((await send(t, "/api/packs/install", archive)).status).toBe(201);
    const second = await send(t, "/api/packs/install", archive);
    expect(second.status).toBe(400);
  });

  test("a trigger is rebound to the script this pack brought", async () => {
    const t = await signedIn();
    const trigger = JSON.stringify({
      name: "Tidy up",
      event: "after_generation",
      action: "script",
      actionRef: "an-id-from-another-install",
      actionRefName: "Em dashes",
    });
    const { status } = await send(
      t,
      "/api/packs/install",
      pack({ "regex/dashes.json": SCRIPT, "triggers/tidy.json": trigger }),
    );
    expect(status).toBe(201);

    const script = t.ctx.db.query("SELECT ulid FROM regex_scripts").get() as { ulid: string };
    const row = t.ctx.db.query("SELECT action_ref FROM event_triggers").get() as {
      action_ref: string;
    };
    expect(row.action_ref).toBe(script.ulid);
  });
});

describe("transactional install", () => {
  test("a malformed document takes the whole install with it", async () => {
    const t = await signedIn();
    // The trigger names a script the pack does not carry, which is refused —
    // and the lorebook beside it must not survive.
    const orphan = JSON.stringify({
      name: "Orphan",
      event: "after_generation",
      action: "script",
      actionRef: "nothing",
      actionRefName: "A script that is not here",
    });
    const { status } = await send(
      t,
      "/api/packs/install",
      pack({ "lorebooks/ridge.json": LOREBOOK, "triggers/orphan.json": orphan }),
    );
    // Refused, not crashed: the pack is coherent JSON that names something it
    // does not carry, which is the caller's problem to be told about.
    expect(status).toBe(400);

    expect(t.ctx.db.query("SELECT count(*) AS n FROM lorebooks").get()).toEqual({ n: 0 });
    expect(t.ctx.db.query("SELECT count(*) AS n FROM lore_entries").get()).toEqual({ n: 0 });
    expect(t.ctx.db.query("SELECT count(*) AS n FROM packs").get()).toEqual({ n: 0 });
    expect(t.ctx.db.query("SELECT count(*) AS n FROM pack_rows").get()).toEqual({ n: 0 });
  });

  test("a card that will not parse is one skipped item, not a failed pack", async () => {
    const t = await signedIn();
    const { status, body } = await send(
      t,
      "/api/packs/install",
      pack({
        "characters/broken.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
        "regex/dashes.json": SCRIPT,
      }),
    );
    expect(status).toBe(201);
    const result = body as { added: number; skipped: number };
    expect(result.added).toBe(1);
    expect(result.skipped).toBe(1);
    expect(t.ctx.db.query("SELECT count(*) AS n FROM regex_scripts").get()).toEqual({ n: 1 });
  });
});

describe("uninstalling", () => {
  test("removes exactly what install added, and nothing else", async () => {
    const t = await signedIn();
    // Things the user already had, which must survive.
    await json(t, "POST", "/api/lorebooks", { name: "Mine" });
    await json(t, "POST", "/api/scripts", {
      name: "Also mine",
      pattern: "x",
      replacement: "y",
      applyTo: "prompt",
    });
    // The global ban list is reached through a scene in the API, and this test
    // is about ownership rather than about that route, so it is seeded directly.
    addBan(t.ctx.db, { sceneId: null, phrase: "a knot in her stomach" });

    const { body } = await send(
      t,
      "/api/packs/install",
      pack({
        "lorebooks/ridge.json": LOREBOOK,
        "regex/dashes.json": SCRIPT,
        // The same phrase the user already listed: adding it must not make it
        // the pack's, or uninstalling would take theirs.
        "banlists/list.json": JSON.stringify({
          name: "Ban list",
          phrases: ["a knot in her stomach", "a beat of silence"],
        }),
      }),
    );
    const installed = body as { packId: string };

    expect(t.ctx.db.query("SELECT count(*) AS n FROM lorebooks").get()).toEqual({ n: 2 });
    expect(t.ctx.db.query("SELECT count(*) AS n FROM regex_scripts").get()).toEqual({ n: 2 });

    const preview = await json<{ rows: { table: string; label: string }[] }>(
      t,
      "GET",
      `/api/packs/${installed.packId}/preview`,
    );
    expect(preview.rows.map((row) => row.label)).toEqual([
      "The ridge",
      "Em dashes",
      "a beat of silence",
    ]);

    await t.fetch(`/api/packs/${installed.packId}`, { method: "DELETE" });

    const books = t.ctx.db.query("SELECT name FROM lorebooks").all() as { name: string }[];
    expect(books.map((row) => row.name)).toEqual(["Mine"]);
    const scripts = t.ctx.db.query("SELECT name FROM regex_scripts").all() as { name: string }[];
    expect(scripts.map((row) => row.name)).toEqual(["Also mine"]);
    const bans = t.ctx.db.query("SELECT phrase FROM ban_phrases WHERE scene_id IS NULL").all() as {
      phrase: string;
    }[];
    expect(bans.map((row) => row.phrase)).toContain("a knot in her stomach");
    expect(bans.map((row) => row.phrase)).not.toContain("a beat of silence");
    expect(t.ctx.db.query("SELECT count(*) AS n FROM packs").get()).toEqual({ n: 0 });
  });

  test("a row the user renamed is still the pack's", async () => {
    const t = await signedIn();
    const { body } = await send(t, "/api/packs/install", pack({ "regex/dashes.json": SCRIPT }));
    const installed = body as { packId: string };

    const script = t.ctx.db.query("SELECT ulid FROM regex_scripts").get() as { ulid: string };
    await json(t, "PATCH", `/api/scripts/${script.ulid}`, { name: "Renamed by me" });

    await t.fetch(`/api/packs/${installed.packId}`, { method: "DELETE" });
    expect(t.ctx.db.query("SELECT count(*) AS n FROM regex_scripts").get()).toEqual({ n: 0 });
  });

  test("entries and options go with their parent, not twice", async () => {
    const t = await signedIn();
    const { body } = await send(t, "/api/packs/install", pack({ "lorebooks/r.json": LOREBOOK }));
    const installed = body as { packId: string };
    expect(t.ctx.db.query("SELECT count(*) AS n FROM lore_entries").get()).toEqual({ n: 1 });

    const result = await json<{ removed: number; of: number }>(
      t,
      "DELETE",
      `/api/packs/${installed.packId}`,
    );
    expect(result.removed).toBe(1);
    expect(t.ctx.db.query("SELECT count(*) AS n FROM lore_entries").get()).toEqual({ n: 0 });
  });
});

describe("exporting", () => {
  test("round-trips: what is built here installs there", async () => {
    const t = await signedIn();
    await json(t, "POST", "/api/scripts", {
      name: "Em dashes",
      pattern: "--",
      replacement: "—",
      flags: "g",
      applyTo: "ai_output",
    });
    const books = await json<{ id: string }>(t, "POST", "/api/lorebooks", { name: "The ridge" });
    await json(t, "POST", `/api/lorebooks/${books.id}/entries`, {
      content: "The station runs on lamp oil.",
    });

    const scripts = await json<{ id: string }[]>(t, "GET", "/api/scripts");
    const response = await t.fetch("/api/packs/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Ridge station",
        version: "2.1.0",
        author: "someone",
        lorebooks: [books.id],
        regex: [scripts[0]!.id],
      }),
    });
    expect(response.status).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer());

    const contents = readPack(bytes);
    expect(contents.manifest.name).toBe("Ridge station");
    expect(contents.manifest.version).toBe("2.1.0");
    // Written rather than asked for: a pack built here works on a host that
    // reads this version of the tree.
    expect(contents.manifest.hostApiRange).toBe("1.x");
    expect(contents.documents.lorebooks).toHaveLength(1);
    expect(contents.documents.regex).toHaveLength(1);

    // And it installs into a fresh install.
    const other = createHarness();
    try {
      await completeSetup(other);
      const { status } = await send(other, "/api/packs/install", bytes);
      expect(status).toBe(201);
      const entry = other.ctx.db.query("SELECT content FROM lore_entries").get() as {
        content: string;
      };
      expect(entry.content).toBe("The station runs on lamp oil.");
    } finally {
      other.cleanup();
    }
  });

  test("a book the app writes for itself is not offered", async () => {
    const t = await signedIn();
    await json(t, "POST", "/api/lorebooks", { name: "Mine" });
    // A dossier book is created by §11's dossiers and bound to one scene;
    // packing it would ship a book that reaches nothing on the other side.
    const book = t.ctx.db
      .query("INSERT INTO lorebooks (ulid, name, created_at, updated_at) VALUES ('01D','Dossiers',0,0) RETURNING id")
      .get() as { id: number };
    const entry = t.ctx.db
      .query(
        "INSERT INTO lore_entries (ulid, lorebook_id, content, created_at, updated_at) VALUES ('01E', $b, '', 0, 0) RETURNING id",
      )
      .get({ b: book.id }) as { id: number };
    const profiles = await json<{ id: string }[]>(t, "GET", "/api/connections/profiles");
    await json(t, "POST", "/api/scenes", {
      title: "The pass",
      connectionProfileId: profiles[0]!.id,
    });
    const scene = t.ctx.db.query("SELECT id FROM scenes LIMIT 1").get() as { id: number };
    t.ctx.db
      .query(
        `INSERT INTO dossiers (ulid, scene_id, name, lore_entry_id, created_at, updated_at)
         VALUES ('01F', $s, 'Hollis', $e, 0, 0)`,
      )
      .run({ s: scene.id, e: entry.id });

    const here = await json<{ lorebooks: { name: string }[] }>(t, "GET", "/api/packs/exportable");
    expect(here.lorebooks.map((row) => row.name)).toEqual(["Mine"]);
  });

  test("a pack needs a name", async () => {
    const t = await signedIn();
    const response = await t.fetch("/api/packs/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "  " }),
    });
    expect(response.status).toBe(400);
  });
});
