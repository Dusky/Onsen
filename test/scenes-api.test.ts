import { afterEach, describe, expect, test } from "bun:test";
import { createHarness, completeSetup, type TestHarness } from "./helpers.ts";
import type {
  CheckpointDto,
  MessageDto,
  SceneDto,
  SceneWithHistoryDto,
} from "../shared/types.ts";

/**
 * The tree over HTTP. SPEC §20 phase 2 says API first, tested, before any UI —
 * the chat screen in phase 5 is a client of exactly these routes.
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

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

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
  const parsed = response.status === 204 ? (undefined as T) : await json<T>(response);
  return { status: response.status, body: parsed };
}

async function newScene(t: TestHarness, title = "A scene"): Promise<SceneDto> {
  const { body } = await send<SceneDto>(t, "POST", "/api/scenes", { title });
  return body;
}

async function post(
  t: TestHarness,
  scene: SceneDto,
  content: string,
  parentId?: string | null,
): Promise<MessageDto> {
  const { body } = await send<MessageDto>(t, "POST", `/api/scenes/${scene.id}/messages`, {
    kind: "user",
    authorType: "user",
    content,
    ...(parentId === undefined ? {} : { parentId }),
  });
  return body;
}

async function pathOf(t: TestHarness, scene: SceneDto): Promise<string[]> {
  const { body } = await send<MessageDto[]>(t, "GET", `/api/scenes/${scene.id}/messages`);
  return body.map((message) => message.content);
}

describe("scenes", () => {
  test("the whole surface is behind the session", async () => {
    const t = await signedIn();
    const scene = await newScene(t);
    t.cookie = null;

    for (const path of ["/api/scenes", `/api/scenes/${scene.id}`, `/api/scenes/${scene.id}/messages`]) {
      expect((await t.fetch(path)).status).toBe(401);
    }
  });

  test("creates, lists, reads, renames and deletes", async () => {
    const t = await signedIn();
    const created = await newScene(t, "The ridge station");
    expect(created.title).toBe("The ridge station");
    expect(created.activeLeafId).toBeNull();
    expect(created.messageCount).toBe(0);

    const listed = await send<SceneDto[]>(t, "GET", "/api/scenes");
    expect(listed.body.map((scene) => scene.id)).toEqual([created.id]);

    const read = await send<SceneWithHistoryDto>(t, "GET", `/api/scenes/${created.id}`);
    expect(read.body.scene.id).toBe(created.id);
    expect(read.body.messages).toEqual([]);

    const renamed = await send<SceneDto>(t, "PATCH", `/api/scenes/${created.id}`, {
      title: "Renamed",
    });
    expect(renamed.body.title).toBe("Renamed");

    expect((await send(t, "DELETE", `/api/scenes/${created.id}`)).status).toBe(204);
    expect((await send(t, "GET", `/api/scenes/${created.id}`)).status).toBe(404);
  });

  test("defaults an untitled scene rather than rejecting it", async () => {
    const t = await signedIn();
    const { status, body } = await send<SceneDto>(t, "POST", "/api/scenes", {});
    expect(status).toBe(201);
    expect(body.title).toBe("Untitled");
  });

  test("rejects a reference to a preset or profile that does not exist", async () => {
    const t = await signedIn();
    expect(
      (await send(t, "POST", "/api/scenes", { title: "x", presetId: "NOPE" })).status,
    ).toBe(400);
    expect(
      (await send(t, "POST", "/api/scenes", { title: "x", connectionProfileId: "NOPE" })).status,
    ).toBe(400);
  });

  test("accepts the default profile and preset created by the wizard", async () => {
    const t = await signedIn();
    const profiles = await send<{ id: string; presetId: string | null }[]>(
      t,
      "GET",
      "/api/connections/profiles",
    );
    const profile = profiles.body[0]!;

    const { body } = await send<SceneDto>(t, "POST", "/api/scenes", {
      title: "Bound",
      connectionProfileId: profile.id,
      presetId: profile.presetId,
    });
    expect(body.connectionProfileId).toBe(profile.id);
    expect(body.presetId).toBe(profile.presetId);
  });

  test("lists most recently touched first", async () => {
    const t = await signedIn();
    const first = await newScene(t, "first");
    const second = await newScene(t, "second");

    // Posting into the older scene should bring it back to the top.
    await post(t, first, "something happens");
    const listed = await send<SceneDto[]>(t, "GET", "/api/scenes");
    expect(listed.body.map((scene) => scene.title)).toEqual(["first", "second"]);
    expect(second.title).toBe("second");
  });
});

describe("messages", () => {
  test("append builds the active path and moves the leaf", async () => {
    const t = await signedIn();
    const scene = await newScene(t);

    const first = await post(t, scene, "one");
    expect(first.parentId).toBeNull();
    expect(first.siblingCount).toBe(1);

    const second = await post(t, scene, "two");
    expect(second.parentId).toBe(first.id);

    expect(await pathOf(t, scene)).toEqual(["one", "two"]);
    const read = await send<SceneWithHistoryDto>(t, "GET", `/api/scenes/${scene.id}`);
    expect(read.body.scene.activeLeafId).toBe(second.id);
    expect(read.body.scene.messageCount).toBe(2);
  });

  test("rejects an unknown kind, author type, or non-string content", async () => {
    const t = await signedIn();
    const scene = await newScene(t);
    const base = { kind: "user", authorType: "user", content: "x" };

    for (const body of [
      { ...base, kind: "monologue" },
      { ...base, authorType: "director" },
      { ...base, content: 42 },
    ]) {
      expect((await send(t, "POST", `/api/scenes/${scene.id}/messages`, body)).status).toBe(400);
    }
  });

  test("an explicit null parent starts a second root, which is how alternate greetings work", async () => {
    const t = await signedIn();
    const scene = await newScene(t);
    const first = await post(t, scene, "greeting one", null);
    const second = await post(t, scene, "greeting two", null);

    expect(second.parentId).toBeNull();
    expect(second.siblingCount).toBe(2);
    expect(await pathOf(t, scene)).toEqual(["greeting two"]);

    await send(t, "PUT", `/api/scenes/${scene.id}/leaf`, { messageId: first.id });
    expect(await pathOf(t, scene)).toEqual(["greeting one"]);
  });

  test("editing in place invalidates the token count and stamps the edit", async () => {
    const t = await signedIn();
    const scene = await newScene(t);
    const message = await post(t, scene, "original");
    expect(message.editedAt).toBeNull();

    const { body } = await send<MessageDto>(
      t,
      "PATCH",
      `/api/scenes/${scene.id}/messages/${message.id}`,
      { content: "revised" },
    );
    expect(body.content).toBe("revised");
    expect(body.tokenCount).toBeNull();
    expect(body.editedAt).not.toBeNull();
  });

  test("hiding excludes a message from the prompt but leaves it in the log", async () => {
    const t = await signedIn();
    const scene = await newScene(t);
    const message = await post(t, scene, "an aside");

    const { body } = await send<MessageDto>(
      t,
      "PATCH",
      `/api/scenes/${scene.id}/messages/${message.id}`,
      { isHidden: true },
    );
    expect(body.isHidden).toBe(true);
    // Still on the active path — hidden is a prompt concern, not a UI one.
    expect(await pathOf(t, scene)).toEqual(["an aside"]);
  });

  test("delete removes the subtree and reports the new leaf", async () => {
    const t = await signedIn();
    const scene = await newScene(t);
    const first = await post(t, scene, "one");
    const second = await post(t, scene, "two");
    await post(t, scene, "three");

    const { status, body } = await send<SceneDto>(
      t,
      "DELETE",
      `/api/scenes/${scene.id}/messages/${second.id}`,
    );
    expect(status).toBe(200);
    expect(body.activeLeafId).toBe(first.id);
    expect(body.messageCount).toBe(1);
    expect(await pathOf(t, scene)).toEqual(["one"]);
  });

  test("a message cannot be reached through another scene", async () => {
    const t = await signedIn();
    const mine = await newScene(t, "mine");
    const other = await newScene(t, "other");
    const message = await post(t, mine, "private");

    for (const [method, path] of [
      ["GET", `/api/scenes/${other.id}/messages/${message.id}/siblings`],
      ["PATCH", `/api/scenes/${other.id}/messages/${message.id}`],
      ["DELETE", `/api/scenes/${other.id}/messages/${message.id}`],
    ] as const) {
      const response = await send(t, method, path, method === "PATCH" ? { content: "x" } : undefined);
      expect(response.status).toBe(404);
    }
  });
});

describe("swiping and rewinding", () => {
  test("the carousel lists every version of a turn in order", async () => {
    const t = await signedIn();
    const scene = await newScene(t);
    const prompt = await post(t, scene, "prompt");
    await post(t, scene, "reply A", prompt.id);
    await post(t, scene, "reply B", prompt.id);
    const third = await post(t, scene, "reply C", prompt.id);

    const { body } = await send<MessageDto[]>(
      t,
      "GET",
      `/api/scenes/${scene.id}/messages/${third.id}/siblings`,
    );
    expect(body.map((message) => message.content)).toEqual(["reply A", "reply B", "reply C"]);
    expect(body.map((message) => message.siblingIndex)).toEqual([0, 1, 2]);
    expect(body.every((message) => message.siblingCount === 3)).toBe(true);
  });

  test("swiping carries that version's continuation with it", async () => {
    const t = await signedIn();
    const scene = await newScene(t);
    const prompt = await post(t, scene, "prompt");
    const a = await post(t, scene, "reply A", prompt.id);
    await post(t, scene, "A continues", a.id);
    const b = await post(t, scene, "reply B", prompt.id);
    await post(t, scene, "B continues", b.id);

    const back = await send<SceneWithHistoryDto>(t, "PUT", `/api/scenes/${scene.id}/leaf`, {
      messageId: a.id,
    });
    expect(back.body.messages.map((message) => message.content)).toEqual([
      "prompt",
      "reply A",
      "A continues",
    ]);

    const forward = await send<SceneWithHistoryDto>(t, "PUT", `/api/scenes/${scene.id}/leaf`, {
      messageId: b.id,
    });
    expect(forward.body.messages.map((message) => message.content)).toEqual([
      "prompt",
      "reply B",
      "B continues",
    ]);
  });

  test("rewinding without descending forks at exactly that point", async () => {
    const t = await signedIn();
    const scene = await newScene(t);
    const first = await post(t, scene, "one");
    await post(t, scene, "two");
    await post(t, scene, "three");

    await send(t, "PUT", `/api/scenes/${scene.id}/leaf`, { messageId: first.id, descend: false });
    expect(await pathOf(t, scene)).toEqual(["one"]);

    await post(t, scene, "two, differently");
    expect(await pathOf(t, scene)).toEqual(["one", "two, differently"]);

    // The abandoned branch is still there to swipe back to.
    const { body } = await send<SceneWithHistoryDto>(t, "GET", `/api/scenes/${scene.id}`);
    expect(body.scene.messageCount).toBe(4);
  });

  test("rejects a leaf move to a message in another scene, or to nothing", async () => {
    const t = await signedIn();
    const scene = await newScene(t);
    const other = await newScene(t, "other");
    const message = await post(t, other, "elsewhere");

    expect(
      (await send(t, "PUT", `/api/scenes/${scene.id}/leaf`, { messageId: message.id })).status,
    ).toBe(404);
    expect((await send(t, "PUT", `/api/scenes/${scene.id}/leaf`, {})).status).toBe(400);
  });
});

describe("checkpoints", () => {
  test("bookmark, restore, and fork from the bookmark", async () => {
    const t = await signedIn();
    const scene = await newScene(t);
    await post(t, scene, "one");
    const marked = await post(t, scene, "two");
    await post(t, scene, "three");
    await post(t, scene, "four");

    const created = await send<CheckpointDto>(t, "POST", `/api/scenes/${scene.id}/checkpoints`, {
      name: "before it went wrong",
      messageId: marked.id,
    });
    expect(created.status).toBe(201);
    expect(created.body.messageId).toBe(marked.id);

    const listed = await send<CheckpointDto[]>(t, "GET", `/api/scenes/${scene.id}/checkpoints`);
    expect(listed.body).toHaveLength(1);

    const restored = await send<SceneWithHistoryDto>(
      t,
      "POST",
      `/api/scenes/${scene.id}/checkpoints/${created.body.id}/restore`,
    );
    // Restore does not descend: the bookmark is a place to fork from.
    expect(restored.body.messages.map((m) => m.content)).toEqual(["one", "two"]);

    await post(t, scene, "three, differently");
    expect(await pathOf(t, scene)).toEqual(["one", "two", "three, differently"]);
  });

  test("defaults to the active leaf and needs a name", async () => {
    const t = await signedIn();
    const scene = await newScene(t);
    const leaf = await post(t, scene, "here");

    const created = await send<CheckpointDto>(t, "POST", `/api/scenes/${scene.id}/checkpoints`, {
      name: "the leaf",
    });
    expect(created.body.messageId).toBe(leaf.id);

    expect((await send(t, "POST", `/api/scenes/${scene.id}/checkpoints`, {})).status).toBe(400);
    expect(
      (await send(t, "POST", `/api/scenes/${scene.id}/checkpoints`, { name: "  " })).status,
    ).toBe(400);
  });

  test("an empty scene has nothing to bookmark", async () => {
    const t = await signedIn();
    const scene = await newScene(t);
    expect(
      (await send(t, "POST", `/api/scenes/${scene.id}/checkpoints`, { name: "nothing" })).status,
    ).toBe(400);
  });

  test("deleting a checkpoint leaves the history alone", async () => {
    const t = await signedIn();
    const scene = await newScene(t);
    await post(t, scene, "one");
    const created = await send<CheckpointDto>(t, "POST", `/api/scenes/${scene.id}/checkpoints`, {
      name: "here",
    });

    expect(
      (await send(t, "DELETE", `/api/scenes/${scene.id}/checkpoints/${created.body.id}`)).status,
    ).toBe(204);
    expect((await send<CheckpointDto[]>(t, "GET", `/api/scenes/${scene.id}/checkpoints`)).body)
      .toEqual([]);
    expect(await pathOf(t, scene)).toEqual(["one"]);
  });

  test("a checkpoint from another scene is not reachable", async () => {
    const t = await signedIn();
    const scene = await newScene(t);
    const other = await newScene(t, "other");
    await post(t, other, "one");
    const created = await send<CheckpointDto>(t, "POST", `/api/scenes/${other.id}/checkpoints`, {
      name: "theirs",
    });

    expect(
      (await send(t, "POST", `/api/scenes/${scene.id}/checkpoints/${created.body.id}/restore`))
        .status,
    ).toBe(404);
  });
});
