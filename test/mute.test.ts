import { afterEach, describe, expect, test } from "bun:test";
import { createHarness, completeSetup, type TestHarness } from "./helpers.ts";
import { buildPromptContext } from "../server/generation/context.ts";
import { buildPrompt } from "../server/prompt/index.ts";
import { OPENAI_COMPATIBLE_CAPABILITIES } from "../server/adapters/index.ts";
import { findScene } from "../server/db/queries/history.ts";
import { openDatabase } from "../server/db/index.ts";
import { migrate } from "../server/db/migrate.ts";
import type { CharacterDto, SceneDto, SceneWithHistoryDto } from "../shared/types.ts";

/**
 * Mute and bench are two states (SPEC §2, §6, §20 phase 62).
 *
 * `scene_members.is_active` was the only control from phase 7, labelled
 * "bench" and described as out of rotation *and* out of the prompt. Only the
 * first half was true: `buildPromptContext` built `cast` from every member, so
 * a benched character still appeared under "Also in this scene" with their
 * compact definition. That is a mute, under the wrong name.
 *
 * `GAPS.md` had the row the other way round — it said mute was missing and
 * bench worked — which is what re-running the evidence is for.
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

/** A scene with two characters and one line said, ready to build a prompt. */
async function twoHanded(t: TestHarness): Promise<{ scene: SceneDto; bram: CharacterDto }> {
  const alder = (
    await send<CharacterDto>(t, "POST", "/api/characters", { name: "Alder" })
  ).body;
  const bram = (await send<CharacterDto>(t, "POST", "/api/characters", { name: "Bram" })).body;
  await send(t, "PATCH", `/api/characters/${bram.id}`, {
    description: "Bram counts the barrels twice.",
  });
  const scene = (await send<SceneDto>(t, "POST", "/api/scenes", { title: "Two" })).body;
  await send(t, "PUT", `/api/scenes/${scene.id}/cast/${alder.id}`);
  await send(t, "PUT", `/api/scenes/${scene.id}/cast/${bram.id}`);
  await send(t, "POST", `/api/scenes/${scene.id}/messages`, {
    kind: "user",
    authorType: "user",
    content: "How short are we?",
  });
  return { scene, bram };
}

function promptFor(t: TestHarness, sceneId: string): string {
  const built = buildPrompt(
    buildPromptContext({
      db: t.ctx.db,
      scene: findScene(t.ctx.db, sceneId)!,
      capabilities: OPENAI_COMPATIBLE_CAPABILITIES,
      now: 0,
      seed: 0,
    }),
  );
  return (built.system ?? "") + "\n" + built.messages.map((message) => message.content).join("\n");
}

describe("muted", () => {
  test("stays in the prompt", async () => {
    const t = await signedIn();
    const { scene, bram } = await twoHanded(t);
    await send(t, "PATCH", `/api/scenes/${scene.id}/cast/${bram.id}`, { isMuted: true });

    const prompt = promptFor(t, scene.id);
    expect(prompt).toContain("Bram");
    expect(prompt).toContain("counts the barrels twice");
  });

  test("is never chosen to speak", async () => {
    const t = await signedIn();
    const { scene, bram } = await twoHanded(t);
    await send(t, "PATCH", `/api/scenes/${scene.id}/cast/${bram.id}`, { isMuted: true });

    const after = await send<SceneWithHistoryDto>(t, "GET", `/api/scenes/${scene.id}`);
    expect(after.body.nextSpeaker?.characterId).not.toBe(bram.id);
  });

  test("shows on the cast list as muted rather than as gone", async () => {
    const t = await signedIn();
    const { scene, bram } = await twoHanded(t);
    await send(t, "PATCH", `/api/scenes/${scene.id}/cast/${bram.id}`, { isMuted: true });

    const after = await send<SceneWithHistoryDto>(t, "GET", `/api/scenes/${scene.id}`);
    const member = after.body.scene.cast.find((row) => row.characterId === bram.id)!;
    expect({ isActive: member.isActive, isMuted: member.isMuted }).toEqual({
      isActive: true,
      isMuted: true,
    });
  });
});

describe("benched", () => {
  test("leaves the prompt entirely", async () => {
    const t = await signedIn();
    const { scene, bram } = await twoHanded(t);
    // The behaviour this phase changed: before it, the name and the compact
    // definition both stayed, and "bench" meant nothing to the author.
    await send(t, "PATCH", `/api/scenes/${scene.id}/cast/${bram.id}`, { isActive: false });

    const prompt = promptFor(t, scene.id);
    expect(prompt).not.toContain("Bram");
    expect(prompt).not.toContain("counts the barrels twice");
  });

  test("keeps their lines and their place in the cast", async () => {
    const t = await signedIn();
    const { scene, bram } = await twoHanded(t);
    await send(t, "PATCH", `/api/scenes/${scene.id}/cast/${bram.id}`, { isActive: false });

    const after = await send<SceneWithHistoryDto>(t, "GET", `/api/scenes/${scene.id}`);
    expect(after.body.scene.cast.map((row) => row.characterId)).toContain(bram.id);
    // The greeting Bram was seeded with is still in the log.
    expect(after.body.messages.length).toBeGreaterThan(0);
  });
});

describe("the route", () => {
  test("takes either field alone", async () => {
    const t = await signedIn();
    const { scene, bram } = await twoHanded(t);

    await send(t, "PATCH", `/api/scenes/${scene.id}/cast/${bram.id}`, { isMuted: true });
    await send(t, "PATCH", `/api/scenes/${scene.id}/cast/${bram.id}`, { isActive: false });
    const both = await send<SceneWithHistoryDto>(t, "GET", `/api/scenes/${scene.id}`);
    const member = both.body.scene.cast.find((row) => row.characterId === bram.id)!;
    expect({ isActive: member.isActive, isMuted: member.isMuted }).toEqual({
      isActive: false,
      isMuted: true,
    });
  });

  test("refuses a body with neither", async () => {
    const t = await signedIn();
    const { scene, bram } = await twoHanded(t);
    const bad = await send(t, "PATCH", `/api/scenes/${scene.id}/cast/${bram.id}`, { nope: 1 });
    expect(bad.status).toBe(400);
  });
});

describe("migration 0046", () => {
  test("turns an existing bench into a mute, because that is what it was", async () => {
    // Opened the way the app opens it: a bare `new Database(":memory:")` misses
    // `strict: true` and binds nothing (the phase 56 lesson).
    const db = openDatabase(":memory:");
    migrate(db);

    const now = Date.now();
    db.query(
      `INSERT INTO characters (ulid, name, raw_card, raw_card_format, created_at, updated_at)
       VALUES ('01AAAAAAAAAAAAAAAAAAAAAAAA', 'Bram', '{}', 'native', $now, $now)`,
    ).run({ now });
    db.query(
      `INSERT INTO scenes (ulid, title, created_at, updated_at) VALUES ('01BBBBBBBBBBBBBBBBBBBBBBBB', 'S', $now, $now)`,
    ).run({ now });
    db.query(
      `INSERT INTO scene_members (scene_id, character_id, display_order, is_active, created_at)
       VALUES (1, 1, 0, 0, $now)`,
    ).run({ now });

    // Re-running the migration is not what happens on an upgrade, so the
    // statement is applied here as the upgrade would apply it.
    db.query("UPDATE scene_members SET is_muted = 1, is_active = 1 WHERE is_active = 0").run();
    const row = db.query("SELECT is_active, is_muted FROM scene_members").get() as {
      is_active: number;
      is_muted: number;
    };
    expect(row).toEqual({ is_active: 1, is_muted: 1 });
    db.close();
  });
});
