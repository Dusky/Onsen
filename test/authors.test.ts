import { afterEach, describe, expect, test } from "bun:test";
import {
  ScriptedAdapter,
  completeSetup,
  createHarness,
  until,
  type TestHarness,
} from "./helpers.ts";
import { V2_CARD, pngCard } from "./card-fixtures.ts";
import { buildPromptContext } from "../server/generation/context.ts";
import { buildPrompt } from "../server/prompt/index.ts";
import { OPENAI_COMPATIBLE_CAPABILITIES } from "../server/adapters/index.ts";
import { findScene } from "../server/db/queries/history.ts";
import type {
  AuthorDto,
  CharacterDto,
  ConnectionProfileDto,
  MessageDto,
  PersonaDto,
  SceneDto,
} from "../shared/types.ts";

/**
 * Author personas (SPEC §0.2, §2, §3, §20 phase 7).
 *
 * The defining bet: the AI is a co-author, not a character. A single writing
 * partner with its own personality puppets the cast, and the author — not any
 * character — is the identity in the system prompt. These tests are mostly
 * about that showing up in the prompt, because that is the only place it is
 * real.
 */

let harness: TestHarness | null = null;
let adapter: ScriptedAdapter;

async function signedIn(): Promise<TestHarness> {
  if (harness === null) {
    adapter = new ScriptedAdapter();
    harness = createHarness({ adapter });
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

async function status(t: TestHarness, method: string, path: string, body?: unknown) {
  const response = await t.fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  return response.status;
}

/** An author, a persona, a character and a scene wired together. */
async function fullyDressedScene(t: TestHarness) {
  const author = await json<AuthorDto>(t, "POST", "/api/authors", { name: "Kestrel" });
  await json<AuthorDto>(t, "PATCH", `/api/authors/${author.id}`, {
    personality: "A patient collaborator who likes long silences.",
    writingStyle: "Close third person, present tense.",
    directingStyle: "Escalates slowly. Lets a scene breathe.",
    oocVoice: "Direct and a little wry.",
    boundaries: "Steers toward consequence, away from gore.",
  });

  const persona = await json<PersonaDto>(t, "POST", "/api/personas", { name: "Ridge" });
  await json<PersonaDto>(t, "PATCH", `/api/personas/${persona.id}`, {
    description: "A surveyor with a bad knee.",
  });

  const form = new FormData();
  form.append("file", new File([pngCard({ chara: V2_CARD }) as unknown as BlobPart], "bell.png"));
  const imported = (await (
    await t.fetch("/api/characters/import", { method: "POST", body: form })
  ).json()) as { character: CharacterDto };

  const profiles = await json<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
  const scene = await json<SceneDto>(t, "POST", "/api/scenes", {
    title: "Ridge station",
    connectionProfileId: profiles[0]!.id,
  });

  const dressed = await json<SceneDto>(t, "PATCH", `/api/scenes/${scene.id}`, {
    authorId: author.id,
    personaId: persona.id,
  });
  const withCast = await json<SceneDto>(
    t,
    "PUT",
    `/api/scenes/${scene.id}/cast/${imported.character.id}`,
  );

  return { author, persona, character: imported.character, scene: withCast, dressed };
}

describe("authors", () => {
  test("the first author becomes the default, so a fresh install has one", async () => {
    const t = await signedIn();
    const first = await json<AuthorDto>(t, "POST", "/api/authors", { name: "Kestrel" });
    expect(first.isDefault).toBe(true);

    const second = await json<AuthorDto>(t, "POST", "/api/authors", { name: "Wren" });
    expect(second.isDefault).toBe(false);
  });

  test("only one author is ever the default", async () => {
    const t = await signedIn();
    const first = await json<AuthorDto>(t, "POST", "/api/authors", { name: "Kestrel" });
    const second = await json<AuthorDto>(t, "POST", "/api/authors", { name: "Wren" });

    await json<AuthorDto>(t, "PATCH", `/api/authors/${second.id}`, { isDefault: true });
    const list = await json<AuthorDto[]>(t, "GET", "/api/authors");
    expect(list.filter((author) => author.isDefault).map((author) => author.id)).toEqual([
      second.id,
    ]);
    expect(first.isDefault).toBe(true); // as it was when created
  });

  test("carries the five fields that make an author an author", async () => {
    const t = await signedIn();
    const created = await json<AuthorDto>(t, "POST", "/api/authors", { name: "Kestrel" });
    const updated = await json<AuthorDto>(t, "PATCH", `/api/authors/${created.id}`, {
      personality: "Patient.",
      writingStyle: "Present tense.",
      directingStyle: "Slow.",
      oocVoice: "Wry.",
      boundaries: "No gore.",
    });

    expect(updated.personality).toBe("Patient.");
    expect(updated.writingStyle).toBe("Present tense.");
    expect(updated.directingStyle).toBe("Slow.");
    expect(updated.oocVoice).toBe("Wry.");
    expect(updated.boundaries).toBe("No gore.");
    expect(updated.tokens.total).toBeGreaterThan(0);
  });

  test("cross-scene memory is off unless asked for", async () => {
    const t = await signedIn();
    const created = await json<AuthorDto>(t, "POST", "/api/authors", { name: "Kestrel" });
    // SPEC §11: an author that silently accumulates notes about the user is a
    // different product with different expectations.
    expect(created.memoryEnabled).toBe(false);

    const updated = await json<AuthorDto>(t, "PATCH", `/api/authors/${created.id}`, {
      memoryEnabled: true,
    });
    expect(updated.memoryEnabled).toBe(true);
  });

  test("rejects an empty name and 404s for an unknown author", async () => {
    const t = await signedIn();
    const created = await json<AuthorDto>(t, "POST", "/api/authors", { name: "Kestrel" });
    expect(await status(t, "PATCH", `/api/authors/${created.id}`, { name: " " })).toBe(400);
    expect(await status(t, "GET", "/api/authors/NOPE")).toBe(404);
  });

  test("deleting an author leaves its scenes and their history alone", async () => {
    const t = await signedIn();
    const { author, scene } = await fullyDressedScene(t);

    expect(await status(t, "DELETE", `/api/authors/${author.id}`)).toBe(204);

    const after = await json<{ scene: SceneDto }>(t, "GET", `/api/scenes/${scene.id}`);
    // The scene survives and falls back to single-character mode, which is
    // exactly what a null author means (SPEC §3).
    expect(after.scene.authorId).toBeNull();
    expect(after.scene.cast).toHaveLength(1);
  });
});

describe("personas", () => {
  test("create, rename and default like authors do", async () => {
    const t = await signedIn();
    const created = await json<PersonaDto>(t, "POST", "/api/personas", { name: "Ridge" });
    expect(created.isDefault).toBe(true);

    const updated = await json<PersonaDto>(t, "PATCH", `/api/personas/${created.id}`, {
      description: "A surveyor with a bad knee.",
    });
    expect(updated.description).toContain("bad knee");
  });

  test("rejects an empty name", async () => {
    const t = await signedIn();
    const created = await json<PersonaDto>(t, "POST", "/api/personas", { name: "Ridge" });
    expect(await status(t, "PATCH", `/api/personas/${created.id}`, { name: "" })).toBe(400);
  });
});

describe("scene setup", () => {
  test("binds an author, a persona and a cast", async () => {
    const t = await signedIn();
    const { author, persona, character, scene } = await fullyDressedScene(t);

    expect(scene.authorId).toBe(author.id);
    expect(scene.authorName).toBe("Kestrel");
    expect(scene.personaId).toBe(persona.id);
    expect(scene.personaName).toBe("Ridge");
    expect(scene.cast.map((member) => member.characterId)).toEqual([character.id]);
  });

  test("clearing the author is a real choice, not a missing value", async () => {
    const t = await signedIn();
    const { scene } = await fullyDressedScene(t);

    // Explicit null selects single-character mode; an absent field means
    // "leave it alone", and the two must not be confused.
    const cleared = await json<SceneDto>(t, "PATCH", `/api/scenes/${scene.id}`, {
      authorId: null,
    });
    expect(cleared.authorId).toBeNull();
    expect(cleared.personaId).not.toBeNull();

    const renamed = await json<SceneDto>(t, "PATCH", `/api/scenes/${scene.id}`, {
      title: "Renamed",
    });
    expect(renamed.personaId).not.toBeNull();
  });

  test("adding the same character twice is not an error", async () => {
    const t = await signedIn();
    const { character, scene } = await fullyDressedScene(t);
    const again = await json<SceneDto>(
      t,
      "PUT",
      `/api/scenes/${scene.id}/cast/${character.id}`,
    );
    expect(again.cast).toHaveLength(1);
  });

  test("removing a cast member keeps what they already said", async () => {
    const t = await signedIn();
    const { character, scene } = await fullyDressedScene(t);

    await json<MessageDto>(t, "POST", `/api/scenes/${scene.id}/messages`, {
      kind: "user",
      authorType: "user",
      content: "Anyone there?",
    });

    const removed = await json<SceneDto>(
      t,
      "DELETE",
      `/api/scenes/${scene.id}/cast/${character.id}`,
    );
    expect(removed.cast).toHaveLength(0);
    expect(removed.messageCount).toBe(1);
  });

  test("rejects an unknown author, persona or character", async () => {
    const t = await signedIn();
    const { scene } = await fullyDressedScene(t);
    expect(await status(t, "PATCH", `/api/scenes/${scene.id}`, { authorId: "NOPE" })).toBe(400);
    expect(await status(t, "PATCH", `/api/scenes/${scene.id}`, { personaId: "NOPE" })).toBe(400);
    expect(await status(t, "PUT", `/api/scenes/${scene.id}/cast/NOPE`)).toBe(404);
  });
});

describe("author-mode rendering", () => {
  /** Build the prompt a generation would send for this scene. */
  function promptFor(t: TestHarness, sceneUlid: string) {
    const scene = findScene(t.ctx.db, sceneUlid)!;
    return buildPrompt(
      buildPromptContext({
        db: t.ctx.db,
        scene,
        capabilities: OPENAI_COMPATIBLE_CAPABILITIES,
        now: Date.UTC(2026, 2, 14),
        seed: 1,
      }),
    );
  }

  test("an author makes the system prompt about the author, not the character", async () => {
    const t = await signedIn();
    const { scene } = await fullyDressedScene(t);
    const built = promptFor(t, scene.id);

    // SPEC §0.2: the author is the identity in the system prompt; characters
    // are roles it plays.
    expect(built.debug.mode).toBe("author");
    expect(built.system).toContain("You are Kestrel, the author of this story");
    expect(built.system).toContain("Close third person, present tense.");
    expect(built.system).toContain("Escalates slowly.");
    // And the character is still fully present, as a role.
    expect(built.system).toContain("Sister Bell");
    expect(built.system).toContain("Bell keeps the ridge station running.");
  });

  test("the user-lock names the persona, twice", async () => {
    const t = await signedIn();
    const { scene } = await fullyDressedScene(t);
    const built = promptFor(t, scene.id);

    // SPEC §0.5: asserted in the system prompt and re-asserted near the turn.
    expect(built.system).toContain("Ridge belongs to the reader");
    expect(built.messages.at(-1)!.content).toContain("Do not write Ridge's dialogue");
  });

  test("without an author the same scene renders in single-character mode", async () => {
    const t = await signedIn();
    const { scene } = await fullyDressedScene(t);
    await json<SceneDto>(t, "PATCH", `/api/scenes/${scene.id}`, { authorId: null });

    const built = promptFor(t, scene.id);
    expect(built.debug.mode).toBe("single_character");
    expect(built.system).not.toContain("the author of this story");
    // The character is still there; only the framing changed.
    expect(built.system).toContain("Sister Bell");
  });

  test("a scene with no cast still builds a prompt rather than refusing", async () => {
    const t = await signedIn();
    const { character, scene } = await fullyDressedScene(t);
    await json<SceneDto>(t, "DELETE", `/api/scenes/${scene.id}/cast/${character.id}`);

    const built = promptFor(t, scene.id);
    expect(built.system).toContain("You are Kestrel");
    expect(built.messages.at(-1)!.content).toContain("Write the next turn");
  });

  test("a generated message records which cast member voiced it", async () => {
    const t = await signedIn();
    const { character, scene } = await fullyDressedScene(t);

    await json<MessageDto>(t, "POST", `/api/scenes/${scene.id}/messages`, {
      kind: "user",
      authorType: "user",
      content: "Anyone there?",
    });
    const started = await json<{ id: string }>(t, "POST", `/api/scenes/${scene.id}/generate`, {});

    await adapter.started;
    adapter.push("Bell does not look up.");
    adapter.end();
    await until(() => t.generation.get(started.id)?.status === "complete");

    const messages = await json<MessageDto[]>(t, "GET", `/api/scenes/${scene.id}/messages`);
    const reply = messages.at(-1)!;
    expect(reply.characterId).toBe(character.id);
    // Resolved for display, so the log does not need the character list.
    expect(reply.speakerName).toBe("Sister Bell");
  });

  test("naming a character forces who speaks, and 404s for an outsider", async () => {
    const t = await signedIn();
    const { character, scene } = await fullyDressedScene(t);

    const started = await json<{ id: string }>(t, "POST", `/api/scenes/${scene.id}/generate`, {
      characterId: character.id,
    });
    await adapter.started;
    adapter.push("Spoken deliberately.");
    adapter.end();
    await until(() => t.generation.get(started.id)?.status === "complete");

    const messages = await json<MessageDto[]>(t, "GET", `/api/scenes/${scene.id}/messages`);
    expect(messages.at(-1)!.characterId).toBe(character.id);

    expect(
      await status(t, "POST", `/api/scenes/${scene.id}/generate`, { characterId: "NOPE" }),
    ).toBe(404);
  });

  test("voice notes reach the prompt only for the character speaking", async () => {
    const t = await signedIn();
    const { character, scene } = await fullyDressedScene(t);
    await json<CharacterDto>(t, "PATCH", `/api/characters/${character.id}`, {
      voiceNotes: "Short sentences. Never says goodbye.",
    });

    // SPEC §3: voice notes are injected only when that character is
    // spotlighted, which is the main defence against homogenised voices.
    expect(promptFor(t, scene.id).system).toContain("Never says goodbye");
  });
});
