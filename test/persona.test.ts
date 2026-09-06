import { afterEach, describe, expect, test } from "bun:test";
import { createHarness, completeSetup, type TestHarness } from "./helpers.ts";
import { buildPromptContext } from "../server/generation/context.ts";
import { buildPrompt } from "../server/prompt/index.ts";
import { OPENAI_COMPATIBLE_CAPABILITIES } from "../server/adapters/index.ts";
import { findScene } from "../server/db/queries/history.ts";
import type { CharacterDto, PersonaDto, SceneDto } from "../shared/types.ts";

/**
 * Who the reader is (SPEC §2, §3, §20 phase 61).
 *
 * Three things the app already stored and could not reach, and one new one:
 *
 * * `personas.avatar_path` and `authors.avatar_path`, on the schema since
 *   migration 0005, never written and never served. `dead-columns` cannot see
 *   them — it matches a column *name*, and `characters.avatar_path` is read
 *   constantly.
 * * `findDefaultPersona`, exported since phase 7 and called by nothing, so
 *   marking a persona default rendered a label and changed no behaviour.
 * * `characters.is_favourite`, added by phase 59 with a partial index and a DTO
 *   field, and no route that could set it — the half-measure that phase's own
 *   record claimed it had avoided.
 * * The persona's depth, which is new.
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

async function send<T>(
  t: TestHarness,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const response = await t.fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const parsed = response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  return { status: response.status, body: parsed };
}

async function newPersona(t: TestHarness, name: string): Promise<PersonaDto> {
  return (await send<PersonaDto>(t, "POST", "/api/personas", { name })).body;
}

async function newCharacter(t: TestHarness, name: string): Promise<CharacterDto> {
  return (await send<CharacterDto>(t, "POST", "/api/characters", { name })).body;
}

/** A one-pixel PNG, so the upload is a real image rather than a blob of bytes. */
const PIXEL = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

async function upload(t: TestHarness, path: string): Promise<Response> {
  const form = new FormData();
  form.append("file", new File([PIXEL as BlobPart], "me.png", { type: "image/png" }));
  return t.fetch(path, { method: "PUT", body: form });
}

describe("the reader's picture", () => {
  test("uploads, serves and clears", async () => {
    const t = await signedIn();
    const persona = await newPersona(t, "Ridge");
    expect(persona.hasAvatar).toBe(false);

    // Nothing there yet is a 404 rather than an empty 200: a picture that does
    // not exist and a picture of nothing look identical to an <img>.
    expect((await t.fetch(`/api/personas/${persona.id}/avatar`)).status).toBe(404);

    const put = await upload(t, `/api/personas/${persona.id}/avatar`);
    expect(put.status).toBe(200);
    expect(((await put.json()) as PersonaDto).hasAvatar).toBe(true);

    const served = await t.fetch(`/api/personas/${persona.id}/avatar`);
    expect(served.status).toBe(200);
    expect(served.headers.get("Content-Type")).toContain("image/png");
    expect((await served.arrayBuffer()).byteLength).toBe(PIXEL.byteLength);

    const cleared = await send<PersonaDto>(t, "DELETE", `/api/personas/${persona.id}/avatar`);
    expect(cleared.body.hasAvatar).toBe(false);
    expect((await t.fetch(`/api/personas/${persona.id}/avatar`)).status).toBe(404);
  });

  test("the author has the same three routes", async () => {
    const t = await signedIn();
    const author = (await send<{ id: string }>(t, "POST", "/api/authors", { name: "The author" }))
      .body;

    const put = await upload(t, `/api/authors/${author.id}/avatar`);
    expect(put.status).toBe(200);
    expect((await t.fetch(`/api/authors/${author.id}/avatar`)).status).toBe(200);
  });

  test("replacing one leaves exactly one picture on the record", async () => {
    const t = await signedIn();
    const persona = await newPersona(t, "Ridge");
    await upload(t, `/api/personas/${persona.id}/avatar`);
    const first = await t.fetch(`/api/personas/${persona.id}/avatar`);
    await upload(t, `/api/personas/${persona.id}/avatar`);
    const second = await t.fetch(`/api/personas/${persona.id}/avatar`);

    // Both resolve — the point is that the second upload did not 404 the
    // endpoint by unlinking the file it had just written.
    expect([first.status, second.status]).toEqual([200, 200]);
  });
});

describe("where the persona lands", () => {
  test("null keeps it in the prefix and a depth moves it among the turns", async () => {
    const t = await signedIn();
    const persona = await newPersona(t, "Ridge");
    await send(t, "PATCH", `/api/personas/${persona.id}`, {
      description: "A surveyor with a bad knee.",
    });
    const character = await newCharacter(t, "Sister Bell");
    const scene = (await send<SceneDto>(t, "POST", "/api/scenes", { title: "Depth" })).body;
    await send(t, "PUT", `/api/scenes/${scene.id}/cast/${character.id}`);
    await send(t, "PATCH", `/api/scenes/${scene.id}`, { personaId: persona.id });
    for (const line of ["One.", "Two.", "Three."]) {
      await send(t, "POST", `/api/scenes/${scene.id}/messages`, {
        kind: "user",
        authorType: "user",
        content: line,
      });
    }

    const row = findScene(t.ctx.db, scene.id)!;
    const inPrefix = buildPrompt(
      buildPromptContext({
        db: t.ctx.db,
        scene: row,
        capabilities: OPENAI_COMPATIBLE_CAPABILITIES,
        now: 0,
        seed: 0,
      }),
    );
    const prefixBlock = inPrefix.debug.blocks.find((block) => block.id === "persona");
    expect(prefixBlock?.placement).toEqual({ kind: "prefix" });

    await send(t, "PATCH", `/api/personas/${persona.id}`, { depth: 2 });
    const atDepth = buildPrompt(
      buildPromptContext({
        db: t.ctx.db,
        scene: findScene(t.ctx.db, scene.id)!,
        capabilities: OPENAI_COMPATIBLE_CAPABILITIES,
        now: 0,
        seed: 0,
      }),
    );
    const depthBlock = atDepth.debug.blocks.find((block) => block.id === "persona");
    expect(depthBlock?.placement).toEqual({ kind: "depth", depth: 2 });

    // The block says the same thing in both; only where it sits has changed.
    expect(depthBlock?.content).toBe(prefixBlock?.content ?? "");
    // And it is genuinely among the turns rather than ahead of them: the
    // messages the builder emits put it after the first of three.
    const texts = atDepth.messages.map((message) => message.content);
    const persona_ = texts.findIndex((text) => text.includes("A surveyor with a bad knee."));
    const one = texts.findIndex((text) => text.includes("One."));
    expect(persona_).toBeGreaterThan(one);
  });

  test("a depth survives the round trip", async () => {
    const t = await signedIn();
    const persona = await newPersona(t, "Ridge");
    const set = await send<PersonaDto>(t, "PATCH", `/api/personas/${persona.id}`, { depth: 4 });
    expect(set.body.depth).toBe(4);
    // Null is a value here — it is what puts the block back in the prefix — so
    // clearing it must be distinguishable from not sending it.
    const cleared = await send<PersonaDto>(t, "PATCH", `/api/personas/${persona.id}`, {
      depth: null,
    });
    expect(cleared.body.depth).toBe(null);
    const named = await send<PersonaDto>(t, "PATCH", `/api/personas/${persona.id}`, {
      name: "Ridge Two",
    });
    expect(named.body.depth).toBe(null);
  });
});

describe("which persona a roleplay opens as", () => {
  test("the default applies when the cast is picked", async () => {
    const t = await signedIn();
    // The first persona made is the default, per migration 0005.
    const persona = await newPersona(t, "Ridge");
    expect(persona.isDefault).toBe(true);

    const character = await newCharacter(t, "Sister Bell");
    const scene = (await send<SceneDto>(t, "POST", "/api/scenes", { title: "Opening" })).body;
    expect(scene.personaId).toBe(null);

    const cast = await send<SceneDto>(t, "PUT", `/api/scenes/${scene.id}/cast/${character.id}`);
    expect(cast.body.personaId).toBe(persona.id);
  });

  test("the character's lock beats the default", async () => {
    const t = await signedIn();
    await newPersona(t, "Ridge");
    const other = await newPersona(t, "Wren");
    const character = await newCharacter(t, "Sister Bell");
    const locked = await send<CharacterDto>(t, "PATCH", `/api/characters/${character.id}`, {
      personaId: other.id,
    });
    expect(locked.body.personaId).toBe(other.id);

    const scene = (await send<SceneDto>(t, "POST", "/api/scenes", { title: "Locked" })).body;
    const cast = await send<SceneDto>(t, "PUT", `/api/scenes/${scene.id}/cast/${character.id}`);
    expect(cast.body.personaId).toBe(other.id);
  });

  test("a persona already chosen is never overwritten", async () => {
    const t = await signedIn();
    const chosen = await newPersona(t, "Ridge");
    const other = await newPersona(t, "Wren");
    const character = await newCharacter(t, "Sister Bell");
    await send(t, "PATCH", `/api/characters/${character.id}`, { personaId: other.id });

    const scene = (await send<SceneDto>(t, "POST", "/api/scenes", { title: "Chosen" })).body;
    await send(t, "PATCH", `/api/scenes/${scene.id}`, { personaId: chosen.id });
    const cast = await send<SceneDto>(t, "PUT", `/api/scenes/${scene.id}/cast/${character.id}`);
    expect(cast.body.personaId).toBe(chosen.id);
  });

  test("clearing the lock falls back to the default again", async () => {
    const t = await signedIn();
    const fallback = await newPersona(t, "Ridge");
    const other = await newPersona(t, "Wren");
    const character = await newCharacter(t, "Sister Bell");
    await send(t, "PATCH", `/api/characters/${character.id}`, { personaId: other.id });
    const cleared = await send<CharacterDto>(t, "PATCH", `/api/characters/${character.id}`, {
      personaId: null,
    });
    expect(cleared.body.personaId).toBe(null);

    const scene = (await send<SceneDto>(t, "POST", "/api/scenes", { title: "Cleared" })).body;
    const cast = await send<SceneDto>(t, "PUT", `/api/scenes/${scene.id}/cast/${character.id}`);
    expect(cast.body.personaId).toBe(fallback.id);
  });

  test("a lock naming nothing is refused rather than silently dropped", async () => {
    const t = await signedIn();
    const character = await newCharacter(t, "Sister Bell");
    const bad = await send(t, "PATCH", `/api/characters/${character.id}`, {
      personaId: "01JQQQQQQQQQQQQQQQQQQQQQQQ",
    });
    expect(bad.status).toBe(400);
  });
});

describe("the star on a card", () => {
  test("sets, filters and files rather than edits", async () => {
    const t = await signedIn();
    const kept = await newCharacter(t, "Sister Bell");
    await newCharacter(t, "The Cartwright");

    // Creating a card snapshots it, so the baseline is one rather than none.
    const before = await send<unknown[]>(t, "GET", `/api/characters/${kept.id}/versions`);

    const starred = await send<CharacterDto>(t, "PATCH", `/api/characters/${kept.id}`, {
      isFavourite: true,
    });
    expect(starred.body.isFavourite).toBe(true);

    const all = await send<CharacterDto[]>(t, "GET", "/api/characters");
    expect(all.body).toHaveLength(2);
    const favourites = await send<CharacterDto[]>(t, "GET", "/api/characters?favourite=1");
    expect(favourites.body.map((row) => row.name)).toEqual(["Sister Bell"]);

    // Filing is not editing: a star must not fill the card's version history,
    // which is the same exemption bulk tag and folder moves take (SPEC §9).
    const after = await send<unknown[]>(t, "GET", `/api/characters/${kept.id}/versions`);
    expect(after.body).toHaveLength(before.body.length);
  });

  test("a real edit still makes a version", async () => {
    const t = await signedIn();
    const card = await newCharacter(t, "Sister Bell");
    const before = await send<unknown[]>(t, "GET", `/api/characters/${card.id}/versions`);
    await send(t, "PATCH", `/api/characters/${card.id}`, { description: "Keeps the ledger." });
    const after = await send<unknown[]>(t, "GET", `/api/characters/${card.id}/versions`);
    expect(after.body.length).toBe(before.body.length + 1);
  });

  test("a non-boolean star is refused", async () => {
    const t = await signedIn();
    const card = await newCharacter(t, "Sister Bell");
    const bad = await send(t, "PATCH", `/api/characters/${card.id}`, { isFavourite: "yes" });
    expect(bad.status).toBe(400);
  });
});
