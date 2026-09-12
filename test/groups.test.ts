import { afterEach, describe, expect, test } from "bun:test";
import { completeSetup, createHarness, type TestHarness } from "./helpers.ts";
import type { CharacterGroupDto, SceneDto } from "../shared/types.ts";

/**
 * Character groups (SPEC §9, §20 phase 158).
 *
 * A named roster plus an optional lorebook. The list and membership endpoints
 * serve the editor; `start` turns the roster into a scene — the cast in order
 * and the lorebook bound at scene scope — which is the feature's whole point.
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

async function makeCharacter(t: TestHarness, name: string) {
  return (await send<{ id: string }>(t, "POST", "/api/characters", { name })).body.id;
}

async function makeLorebook(t: TestHarness, name: string) {
  return (await send<{ id: string }>(t, "POST", "/api/lorebooks", { name })).body.id;
}

describe("character groups", () => {
  test("create, list, rename, add members, and set a lorebook", async () => {
    const t = await signedIn();
    const alice = await makeCharacter(t, "Alice");
    const bob = await makeCharacter(t, "Bob");
    const book = await makeLorebook(t, "The Garden");

    const made = await send<CharacterGroupDto>(t, "POST", "/api/character-groups", {
      name: "The Pair",
      lorebookId: book,
    });
    expect(made.status).toBe(201);
    expect(made.body.name).toBe("The Pair");
    expect(made.body.lorebookName).toBe("The Garden");
    expect(made.body.members).toHaveLength(0);

    const withAlice = await send<CharacterGroupDto>(
      t,
      "PUT",
      `/api/character-groups/${made.body.id}/characters/${alice}`,
    );
    expect(withAlice.body.members.map((m) => m.name)).toEqual(["Alice"]);

    const withBoth = await send<CharacterGroupDto>(
      t,
      "PUT",
      `/api/character-groups/${made.body.id}/characters/${bob}`,
    );
    expect(withBoth.body.members.map((m) => m.name)).toEqual(["Alice", "Bob"]);

    const renamed = await send<CharacterGroupDto>(t, "PATCH", `/api/character-groups/${made.body.id}`, {
      name: "The Duo",
    });
    expect(renamed.body.name).toBe("The Duo");

    const listed = await send<CharacterGroupDto[]>(t, "GET", "/api/character-groups");
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0]!.members).toHaveLength(2);
  });

  test("a group needs a name, and a bad lorebook is refused", async () => {
    const t = await signedIn();
    expect((await send(t, "POST", "/api/character-groups", { name: "  " })).status).toBe(400);
    expect(
      (await send(t, "POST", "/api/character-groups", { name: "X", lorebookId: "NOPE" })).status,
    ).toBe(400);
  });

  test("start turns the roster into a scene with the cast and the lorebook bound", async () => {
    const t = await signedIn();
    const alice = await makeCharacter(t, "Alice");
    const bob = await makeCharacter(t, "Bob");
    const book = await makeLorebook(t, "The Garden");

    const group = await send<CharacterGroupDto>(t, "POST", "/api/character-groups", {
      name: "The Pair",
      lorebookId: book,
    });
    await send(t, "PUT", `/api/character-groups/${group.body.id}/characters/${alice}`);
    await send(t, "PUT", `/api/character-groups/${group.body.id}/characters/${bob}`);

    const started = await send<SceneDto>(t, "POST", `/api/character-groups/${group.body.id}/start`);
    expect(started.status).toBe(201);
    expect(started.body.title).toBe("The Pair");
    expect(started.body.cast.map((member) => member.name)).toEqual(["Alice", "Bob"]);

    const binding = t.ctx.db
      .query("SELECT scope FROM lorebook_bindings WHERE scene_id = (SELECT id FROM scenes WHERE ulid = $ulid)")
      .get({ ulid: started.body.id }) as { scope: string } | null;
    expect(binding?.scope).toBe("scene");
  });

  test("starting an empty group is refused", async () => {
    const t = await signedIn();
    const group = await send<CharacterGroupDto>(t, "POST", "/api/character-groups", {
      name: "Nobody",
    });
    expect((await send(t, "POST", `/api/character-groups/${group.body.id}/start`)).status).toBe(400);
  });

  test("remove a member, then delete the group", async () => {
    const t = await signedIn();
    const alice = await makeCharacter(t, "Alice");
    const group = await send<CharacterGroupDto>(t, "POST", "/api/character-groups", {
      name: "Solo",
    });
    await send(t, "PUT", `/api/character-groups/${group.body.id}/characters/${alice}`);

    const without = await send<CharacterGroupDto>(
      t,
      "DELETE",
      `/api/character-groups/${group.body.id}/characters/${alice}`,
    );
    expect(without.body.members).toHaveLength(0);

    expect((await send(t, "DELETE", `/api/character-groups/${group.body.id}`)).status).toBe(200);
    const listed = await send<CharacterGroupDto[]>(t, "GET", "/api/character-groups");
    expect(listed.body).toHaveLength(0);
  });
});
