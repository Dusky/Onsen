import { afterEach, describe, expect, test } from "bun:test";
import {
  completeSetup,
  createHarness,
  ScriptedAdapter,
  type TestHarness,
} from "./helpers.ts";
import type { CharacterDto, MessageDto, SceneDto } from "../shared/types.ts";

/**
 * Display-only translation (SPEC §20 phase 78).
 *
 * The decision was display-only: the stored text and the prompt keep the
 * language the author writes in, and a translation is a viewing layer stored
 * beside the message. This pins the whole path — a translate call stores the
 * rendering beside the message, the DTO carries it, and the stored content is
 * untouched (which is what keeps the prompt untouched).
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

async function json<T>(
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

describe("display-only translation", () => {
  test("stores the rendering beside the message and leaves the text alone", async () => {
    const t = await signedIn();
    adapter.taskReply = "Estación en la cresta, tres días de escasez.";

    const character = await json<CharacterDto>(t, "POST", "/api/characters", { name: "Bell" });
    const profiles = await json<{ id: string; isDefault?: boolean }[]>(
      t,
      "GET",
      "/api/connections/profiles",
    );
    const scene = await json<SceneDto>(t, "POST", "/api/scenes", {
      title: "Ridge station",
      connectionProfileId: profiles.body[0]!.id,
    });
    await json(t, "PUT", `/api/scenes/${scene.body.id}/cast/${character.body.id}`);
    await json(t, "PATCH", `/api/scenes/${scene.body.id}`, { translateTo: "Spanish" });

    const original = "A relay station on the ridge, three days into a shortage.";
    await json<MessageDto>(t, "POST", `/api/scenes/${scene.body.id}/messages`, {
      kind: "user",
      authorType: "user",
      content: original,
    });

    const path = await json<MessageDto[]>(t, "GET", `/api/scenes/${scene.body.id}/messages`);
    const message = path.body[0]!;
    expect(message.translation).toBe(null);

    const translated = await json<MessageDto>(
      t,
      "POST",
      `/api/scenes/${scene.body.id}/messages/${message.id}/translate`,
      {},
    );
    expect(translated.status).toBe(200);
    expect(translated.body.translation).toBe("Estación en la cresta, tres días de escasez.");

    // The stored text is the author's original — the prompt keeps it.
    const stored = t.ctx.db
      .query("SELECT content FROM messages WHERE ulid = $u")
      .get({ u: message.id }) as { content: string };
    expect(stored.content).toBe(original);

    // And the path DTO now carries the rendering.
    const after = await json<MessageDto[]>(t, "GET", `/api/scenes/${scene.body.id}/messages`);
    expect(after.body[0]!.content).toBe(original);
    expect(after.body[0]!.translation).toBe("Estación en la cresta, tres días de escasez.");
  });

  test("no language set is refused rather than guessed", async () => {
    const t = await signedIn();
    const character = await json<CharacterDto>(t, "POST", "/api/characters", { name: "Bell" });
    const profiles = await json<{ id: string }[]>(t, "GET", "/api/connections/profiles");
    const scene = await json<SceneDto>(t, "POST", "/api/scenes", {
      title: "No language",
      connectionProfileId: profiles.body[0]!.id,
    });
    await json(t, "PUT", `/api/scenes/${scene.body.id}/cast/${character.body.id}`);
    const message = await json<MessageDto>(t, "POST", `/api/scenes/${scene.body.id}/messages`, {
      kind: "user",
      authorType: "user",
      content: "Hello.",
    });

    const result = await json(
      t,
      "POST",
      `/api/scenes/${scene.body.id}/messages/${message.body.id}/translate`,
      {},
    );
    expect(result.status).toBe(400);
  });
});
