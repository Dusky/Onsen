import { afterEach, describe, expect, test } from "bun:test";
import { ScriptedAdapter, completeSetup, createHarness, until, type TestHarness } from "./helpers.ts";
import { V2_CARD_SILENT, pngCard } from "./card-fixtures.ts";
import { SceneChannel, sceneChannel, withOrigin, originOfRequest } from "../server/sync/channel.ts";
import type { CharacterDto, ConnectionProfileDto, MessageDto, SceneDto } from "../shared/types.ts";

/**
 * Multi-device head sync (SPEC §5, §20 phase 36).
 *
 * The property that matters: two devices with the same scene open converge, and
 * where they cannot converge silently the one that did not write finds out.
 * That needs the channel to say *who* moved the head — without an origin,
 * last-write-wins has no loser and every client prompts itself about its own
 * writes.
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
  client?: string,
): Promise<T> {
  const response = await t.fetch(path, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(client === undefined ? {} : { "X-Onsen-Client": client }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return (await response.json()) as T;
}

async function scene(t: TestHarness): Promise<string> {
  const form = new FormData();
  form.append("file", new File([pngCard({ chara: V2_CARD_SILENT }) as unknown as BlobPart], "bell.png"));
  const { character } = (await (
    await t.fetch("/api/characters/import", { method: "POST", body: form })
  ).json()) as { character: CharacterDto };
  const profiles = await json<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
  const created = await json<SceneDto>(t, "POST", "/api/scenes", {
    title: "The pass",
    connectionProfileId: profiles[0]!.id,
  });
  await json<SceneDto>(t, "PUT", `/api/scenes/${created.id}/cast/${character.id}`);
  return created.id;
}

/** Listen the way the SSE route does, and collect what arrives. */
function listen(sceneId: string) {
  const events: {
    type: string;
    origin?: string | null;
    messageId?: string | null;
    parentId?: string | null;
    state?: string;
  }[] = [];
  const stop = sceneChannel.subscribe(sceneId, (event) => events.push(event));
  return { events, stop };
}

describe("the channel itself", () => {
  test("delivers to every listener and stops on unsubscribe", () => {
    const channel = new SceneChannel();
    const a: string[] = [];
    const b: string[] = [];
    const stopA = channel.subscribe("s", (event) => a.push(event.type));
    channel.subscribe("s", (event) => b.push(event.type));
    channel.publish("s", { type: "history", origin: null });
    stopA();
    channel.publish("s", { type: "history", origin: null });
    expect(a).toEqual(["history"]);
    expect(b).toEqual(["history", "history"]);
  });

  test("a scene with no listeners costs nothing, and other scenes hear nothing", () => {
    const channel = new SceneChannel();
    const heard: string[] = [];
    channel.subscribe("mine", (event) => heard.push(event.type));
    channel.publish("theirs", { type: "history", origin: null });
    expect(heard).toEqual([]);
    expect(channel.countFor("theirs")).toBe(0);
  });

  test("one listener throwing does not stop the others", () => {
    const channel = new SceneChannel();
    const heard: string[] = [];
    channel.subscribe("s", () => {
      throw new Error("this socket is gone");
    });
    channel.subscribe("s", (event) => heard.push(event.type));
    channel.publish("s", { type: "history", origin: null });
    expect(heard).toEqual(["history"]);
  });
});

describe("the origin", () => {
  test("survives an await, which a module-level variable would not", async () => {
    const seen: (string | null)[] = [];
    await Promise.all([
      withOrigin("phone", async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        seen.push(originOfRequest());
      }),
      withOrigin("desktop", async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        seen.push(originOfRequest());
      }),
    ]);
    // Whichever finished first, neither read the other's value. An origin that
    // leaked between requests makes a client ignore an echo that was not its own.
    expect(new Set(seen)).toEqual(new Set(["phone", "desktop"]));
  });

  test("is null outside a request", () => {
    expect(originOfRequest()).toBeNull();
  });
});

describe("what moves the head", () => {
  test("a message names the client that sent it", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    const { events, stop } = listen(sceneId);

    const message = await json<MessageDto>(
      t,
      "POST",
      `/api/scenes/${sceneId}/messages`,
      { kind: "user", authorType: "user", content: "is the pass open?" },
      "phone",
    );
    stop();

    const leaf = events.find((event) => event.type === "leaf");
    expect(leaf?.origin).toBe("phone");
    expect(leaf?.messageId).toBe(message.id);
  });

  test("a turn names what it hangs off, so the other device can take it silently", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    const first = await json<MessageDto>(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "first",
    });
    const { events, stop } = listen(sceneId);

    await json(
      t,
      "POST",
      `/api/scenes/${sceneId}/messages`,
      { kind: "user", authorType: "user", content: "second" },
      "phone",
    );
    stop();

    // This is what lets the other device take the turn silently rather than
    // prompting: it is showing `first`, and the new head hangs off `first`.
    expect(events.find((event) => event.type === "leaf")).toMatchObject({
      parentId: first.id,
    });
  });

  test("a rewind does not name the reader's head, so it prompts instead", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    const first = await json<MessageDto>(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "first",
    });
    await json<MessageDto>(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "second",
    });
    const { events, stop } = listen(sceneId);

    await json(
      t,
      "PUT",
      `/api/scenes/${sceneId}/leaf`,
      { messageId: first.id, descend: false },
      "phone",
    );
    stop();

    // A rewind starts where the reader is too, which is why the signal is the
    // new head's parent and not the old head: `first` hangs off nothing here,
    // so a device showing `second` is moved off its branch and finds out.
    const leaf = events.find((event) => event.type === "leaf");
    expect(leaf?.messageId).toBe(first.id);
    expect(leaf?.parentId).toBeNull();
  });

  test("an edit announces the change without moving the head", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    const message = await json<MessageDto>(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "first",
    });
    const { events, stop } = listen(sceneId);

    await json(
      t,
      "PATCH",
      `/api/scenes/${sceneId}/messages/${message.id}`,
      { content: "second" },
      "desktop",
    );
    stop();

    // The reader on the other device is looking at the same turn; it now says
    // something else. There is nothing to prompt about, only to refetch.
    const history = events.find((event) => event.type === "history");
    expect(history?.origin).toBe("desktop");
    expect(events.some((event) => event.type === "leaf")).toBe(false);
  });

  test("a delete that takes the head with it moves the leaf", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    const first = await json<MessageDto>(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "first",
    });
    const second = await json<MessageDto>(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "second",
    });
    const { events, stop } = listen(sceneId);

    await t.fetch(`/api/scenes/${sceneId}/messages/${second.id}`, { method: "DELETE" });
    stop();

    // This is the one the routes could not have announced on their own: the
    // head moved as a consequence, not as a request.
    const leaf = events.find((event) => event.type === "leaf");
    expect(leaf?.messageId).toBe(first.id);
  });

  test("switching branches announces the new head", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    const root = await json<MessageDto>(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "root",
    });
    const sibling = await json<MessageDto>(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "a branch",
      parentId: null,
    });
    const { events, stop } = listen(sceneId);

    await json(t, "PUT", `/api/scenes/${sceneId}/leaf`, { messageId: root.id }, "desktop");
    stop();

    expect(events.at(-1)).toMatchObject({ type: "leaf", messageId: root.id, origin: "desktop" });
    expect(sibling.id).not.toBe(root.id);
  });
});

describe("a generation", () => {
  test("announces itself starting and finishing, for the other device", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    await json(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "go on",
    });
    const { events, stop } = listen(sceneId);

    const snapshot = await json<{ id: string }>(t, "POST", `/api/scenes/${sceneId}/generate`, {});
    await adapter.started;
    adapter.push("She looked up.");
    adapter.end();
    await until(() => t.generation.get(snapshot.id)?.status === "complete");
    stop();

    const states = events.filter((e) => e.type === "generation").map((e) => e.state);
    expect(states).toEqual(["started", "finished"]);
  });

  test("a turn that failed still announces the end", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    await json(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "go on",
    });
    const { events, stop } = listen(sceneId);

    const snapshot = await json<{ id: string }>(t, "POST", `/api/scenes/${sceneId}/generate`, {});
    await adapter.started;
    adapter.fail(new Error("the model went away"));
    await until(() => t.generation.get(snapshot.id)?.status === "error");
    stop();

    // An indicator that only cleared on success would leave the other device
    // showing "still writing" for a turn that stopped.
    expect(events.filter((e) => e.type === "generation").map((e) => e.state)).toEqual([
      "started",
      "finished",
    ]);
  });
});

describe("the stream", () => {
  test("opens with the current head, so a late device is not left stale", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    const message = await json<MessageDto>(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "already here",
    });

    const response = await t.fetch(`/api/scenes/${sceneId}/events`);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    await reader.cancel();

    expect(first).toContain("event: leaf");
    expect(first).toContain(message.id);
  });

  test("a scene that does not exist has no channel", async () => {
    const t = await signedIn();
    const response = await t.fetch("/api/scenes/01NOTREAL/events");
    expect(response.status).toBe(404);
  });
});

describe("the chime preference", () => {
  test("is off until asked for, and survives a reload because it is server-side", async () => {
    const t = await signedIn();
    // toMatchObject, not toEqual: preferences is a growing payload and an
    // exact match here fails every time a new one lands, which says nothing
    // about the chime.
    expect(await json(t, "GET", "/api/system/preferences")).toMatchObject({
      completionChime: false,
    });
    await json(t, "PATCH", "/api/system/preferences", { completionChime: true });
    expect(await json(t, "GET", "/api/system/preferences")).toMatchObject({
      completionChime: true,
    });
  });
});

/**
 * The chat layout (SPEC §16, §20 phase 52).
 *
 * Server-side for the same reason the chime is: there is no browser storage in
 * this app, and a layout that lived in one browser would be the wrong shape
 * anyway — the phone and the desktop are two views of one install.
 */
describe("the layout preference", () => {
  test("is Instrument until somebody changes it", async () => {
    const t = await signedIn();
    expect(await json(t, "GET", "/api/system/preferences")).toMatchObject({
      layout: {
        preset: "instrument",
        readouts: true,
        cast: "segments",
        dek: false,
        attribution: "stacked",
      },
    });
  });

  test("a preset name sets all four switches", async () => {
    const t = await signedIn();
    await json(t, "PATCH", "/api/system/preferences", { layout: { preset: "broadsheet" } });
    expect(await json(t, "GET", "/api/system/preferences")).toMatchObject({
      layout: { preset: "broadsheet", readouts: false, cast: "line", dek: true, attribution: "inline" },
    });
  });

  test("a switch sent alongside a preset wins", async () => {
    // "Start from Quiet, but keep the readouts" is one request, not two.
    const t = await signedIn();
    await json(t, "PATCH", "/api/system/preferences", {
      layout: { preset: "quiet", readouts: true },
    });
    expect(await json(t, "GET", "/api/system/preferences")).toMatchObject({
      layout: { preset: "custom", readouts: true, cast: "line" },
    });
  });

  test("changing one switch off a preset says so rather than lying about the name", async () => {
    const t = await signedIn();
    await json(t, "PATCH", "/api/system/preferences", { layout: { preset: "instrument" } });
    await json(t, "PATCH", "/api/system/preferences", { layout: { dek: true } });
    const after = await json<{ layout: { preset: string; dek: boolean } }>(
      t,
      "GET",
      "/api/system/preferences",
    );
    expect(after.layout).toMatchObject({ preset: "custom", dek: true });
  });

  test("landing back on a preset's exact switches names it again", async () => {
    const t = await signedIn();
    await json(t, "PATCH", "/api/system/preferences", { layout: { preset: "instrument" } });
    await json(t, "PATCH", "/api/system/preferences", { layout: { dek: true } });
    await json(t, "PATCH", "/api/system/preferences", { layout: { dek: false } });
    expect(await json(t, "GET", "/api/system/preferences")).toMatchObject({
      layout: { preset: "instrument" },
    });
  });

  test("nonsense is ignored rather than stored", async () => {
    const t = await signedIn();
    await json(t, "PATCH", "/api/system/preferences", {
      layout: { preset: "wingding", cast: "hexagons", attribution: 7 },
    });
    expect(await json(t, "GET", "/api/system/preferences")).toMatchObject({
      layout: { preset: "instrument", cast: "segments", attribution: "stacked" },
    });
  });
});
