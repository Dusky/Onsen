import { afterEach, describe, expect, test } from "bun:test";
import { ScriptedAdapter, completeSetup, createHarness, type TestHarness } from "./helpers.ts";
import { pngCard, V2_CARD } from "./card-fixtures.ts";
import type {
  CharacterDto,
  ConnectionProfileDto,
  LorebookDto,
  LoreEntryDto,
  SceneDto,
} from "../shared/types.ts";

/**
 * AI-assisted authoring (SPEC §9, §20 phase 27).
 *
 * The thing the spec is loudest about — structured output enforced server-side
 * rather than trusted — is what these tests read first: a malformed reply is a
 * 422 with a reason, never a card assembled from whatever the JSON happened to
 * contain.
 */

let harness: TestHarness | null = null;
let adapter: ScriptedAdapter;

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

async function req<T>(t: TestHarness, method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const response = await t.fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as T };
}

async function json<T>(t: TestHarness, method: string, path: string, body?: unknown): Promise<T> {
  return (await req<T>(t, method, path, body)).body;
}

async function signedIn(): Promise<TestHarness> {
  harness = createHarness({ adapter: (adapter = new ScriptedAdapter()) });
  await completeSetup(harness);
  return harness;
}

/** Answer the next authoring side call (by its block label) with `reply`. */
function answer(label: string, reply: string): void {
  adapter.taskReplyFor = (prompt) =>
    prompt.debug.blocks[0]?.label === label ? reply : null;
}

const CARD_JSON = JSON.stringify({
  name: "Kestrel",
  description: "A watchful falconer on the ridge.",
  personality: "Dry, patient, slow to trust.",
  scenario: "A night watch at the end of a closed road.",
  firstMessage: "\"You're early.\"",
  tags: ["falconer", "ridge"],
  voiceNotes: "Short sentences. Calls people by their trade.",
});

async function sceneWithHistory(t: TestHarness): Promise<string> {
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
  await json(t, "POST", `/api/scenes/${created.id}/messages`, {
    kind: "user",
    authorType: "user",
    content: "Bell, who else works this station?",
  });
  await json(t, "POST", `/api/scenes/${created.id}/messages`, {
    kind: "character",
    authorType: "character",
    content: "The falconer, mostly. Keeps to herself.",
  });
  return created.id;
}

describe("AI-assisted authoring (SPEC §9)", () => {
  test("creates a card from a description", async () => {
    const t = await signedIn();
    answer("Create character", CARD_JSON);

    const { status, body } = await req<CharacterDto>(t, "POST", "/api/authoring/characters", {
      description: "A falconer who keeps to herself.",
    });
    expect(status).toBe(201);
    expect(body.name).toBe("Kestrel");
    expect(body.description).toBe("A watchful falconer on the ridge.");
    expect(body.tags).toContain("falconer");
  });

  test("refuses a card the JSON cannot describe", async () => {
    const t = await signedIn();
    answer("Create character", `Sure! Here's your card: {"name": 42}`);

    const { status, body } = await req<{ error: { code: string } }>(
      t,
      "POST",
      "/api/authoring/characters",
      { description: "Someone." },
    );
    expect(status).toBe(422);
    expect(body.error.code).toBe("unreadable");
  });

  test("refuses a description-less request", async () => {
    const t = await signedIn();
    const { status } = await req(t, "POST", "/api/authoring/characters", { description: "  " });
    expect(status).toBe(400);
  });

  test("revises only the fields the reply names", async () => {
    const t = await signedIn();
    const form = new FormData();
    form.append("file", new File([pngCard({ chara: V2_CARD }) as unknown as BlobPart], "bell.png"));
    const { character } = (await (
      await t.fetch("/api/characters/import", { method: "POST", body: form })
    ).json()) as { character: CharacterDto };
    expect(character.description).toBe("Bell keeps the ridge station running.");

    answer("Revise character", `{"description": "Bell keeps the lamps and the ledger."}`);
    const { status, body } = await req<CharacterDto>(
      t,
      "POST",
      `/api/authoring/characters/${character.id}/revise`,
      { instructions: "She keeps the lamps too." },
    );
    expect(status).toBe(200);
    expect(body.description).toBe("Bell keeps the lamps and the ledger.");
    // Untouched fields stayed untouched.
    expect(body.name).toBe("Sister Bell");
  });

  test("extracts a card from scene history", async () => {
    const t = await signedIn();
    const sceneId = await sceneWithHistory(t);
    answer("Extract character", CARD_JSON);

    const { status, body } = await req<CharacterDto>(
      t,
      "POST",
      `/api/authoring/scenes/${sceneId}/extract-character`,
      { name: "The falconer" },
    );
    expect(status).toBe(201);
    expect(body.name).toBe("Kestrel");
  });

  test("extract needs history to read", async () => {
    const t = await signedIn();
    const created = await json<SceneDto>(t, "POST", "/api/scenes", { title: "Empty" });
    const { status } = await req(t, "POST", `/api/authoring/scenes/${created.id}/extract-character`, {
      name: "Anyone",
    });
    expect(status).toBe(400);
  });

  test("suggests voice notes as a proposal, not an edit", async () => {
    const t = await signedIn();
    const form = new FormData();
    form.append("file", new File([pngCard({ chara: V2_CARD }) as unknown as BlobPart], "bell.png"));
    const { character } = (await (
      await t.fetch("/api/characters/import", { method: "POST", body: form })
    ).json()) as { character: CharacterDto };

    answer("Suggest voice notes", `{"voiceNotes": "Flat, laconic, ends sentences on a downbeat."}`);
    const { status, body } = await req<{ voiceNotes: string }>(
      t,
      "POST",
      `/api/authoring/characters/${character.id}/voice-notes`,
    );
    expect(status).toBe(200);
    expect(body.voiceNotes).toContain("laconic");
  });

  test("proposes lore entries from a scene", async () => {
    const t = await signedIn();
    const sceneId = await sceneWithHistory(t);
    answer("Suggest lore", `[{"title":"The flood","content":"The tunnel has been sealed since the flood.","keys":["flood","tunnel"]}]`);

    const { status, body } = await req<{ entries: { title: string; keys: string[] }[] }>(
      t,
      "POST",
      `/api/authoring/scenes/${sceneId}/suggest-lore`,
    );
    expect(status).toBe(200);
    expect(body.entries[0]!.title).toBe("The flood");
    expect(body.entries[0]!.keys).toContain("flood");
  });

  test("revises a lore entry in place", async () => {
    const t = await signedIn();
    const book = await json<LorebookDto>(t, "POST", "/api/lorebooks", { name: "The ridge" });
    const entry = await json<LoreEntryDto>(t, "POST", `/api/lorebooks/${book.id}/entries`, {
      content: "The tunnel has been sealed.",
    });
    answer("Revise lore", `{"title":"The sealed tunnel","content":"The tunnel has been sealed since the flood of 1902.","keys":["tunnel","flood"]}`);

    const { status, body } = await req<LoreEntryDto>(
      t,
      "POST",
      `/api/authoring/lore/${entry.id}/revise`,
      {},
    );
    expect(status).toBe(200);
    expect(body.title).toBe("The sealed tunnel");
    expect(body.content).toContain("1902");
  });
});
