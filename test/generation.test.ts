import { afterEach, describe, expect, test } from "bun:test";
import {
  ScriptedAdapter,
  completeSetup,
  createHarness,
  tick,
  until,
  type TestHarness,
} from "./helpers.ts";
import type { GenerationSnapshot } from "../server/generation/service.ts";
import type { ConnectionProfileDto, MessageDto, SceneDto } from "../shared/types.ts";

/**
 * The generation service and its routes (SPEC §5).
 *
 * The behaviour that matters here is not "it streams" — it is what happens when
 * the client goes away. Mobile browsers suspend backgrounded tabs and drop
 * connections on network handoff, so every test that disconnects mid-stream is
 * testing the normal case, not an edge case.
 */

let harness: TestHarness | null = null;
let adapter: ScriptedAdapter;

async function setup(): Promise<{ t: TestHarness; scene: SceneDto }> {
  adapter = new ScriptedAdapter();
  harness = createHarness({ adapter });
  await completeSetup(harness);

  const profiles = (await (
    await harness.fetch("/api/connections/profiles")
  ).json()) as ConnectionProfileDto[];

  const response = await harness.fetch("/api/scenes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Ridge station", connectionProfileId: profiles[0]!.id }),
  });
  return { t: harness, scene: (await response.json()) as SceneDto };
}

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

async function say(t: TestHarness, scene: SceneDto, content: string): Promise<MessageDto> {
  const response = await t.fetch(`/api/scenes/${scene.id}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "user", authorType: "user", content }),
  });
  return (await response.json()) as MessageDto;
}

async function generate(
  t: TestHarness,
  scene: SceneDto,
  body: Record<string, unknown> = {},
): Promise<{ status: number; snapshot: GenerationSnapshot }> {
  const response = await t.fetch(`/api/scenes/${scene.id}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, snapshot: (await response.json()) as GenerationSnapshot };
}

/** Read an SSE stream until it closes, returning the raw frames. */
async function readStream(response: Response, limit = 50): Promise<string[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const frames: string[] = [];
  let pending = "";
  while (frames.length < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    let index = pending.indexOf("\n\n");
    while (index !== -1) {
      frames.push(pending.slice(0, index));
      pending = pending.slice(index + 2);
      index = pending.indexOf("\n\n");
    }
  }
  reader.releaseLock();
  return frames;
}

function payloads(frames: string[]): Record<string, unknown>[] {
  return frames
    .filter((frame) => frame.includes("data: "))
    .map((frame) => JSON.parse(frame.slice(frame.indexOf("data: ") + 6)) as Record<string, unknown>);
}

describe("starting a generation", () => {
  test("returns an identifier immediately and keeps working in the background", async () => {
    const { t, scene } = await setup();
    await say(t, scene, "Anyone there?");

    // SPEC §5.1: the response comes back before any token does.
    const { status, snapshot } = await generate(t, scene);
    expect(status).toBe(201);
    expect(snapshot.id).toBeTruthy();
    expect(snapshot.buffer).toBe("");

    await adapter.started;
    adapter.push("Bell looks up.");
    await until(() => (t.generation.get(snapshot.id)?.buffer ?? "") !== "");
    expect(t.generation.get(snapshot.id)!.buffer).toBe("Bell looks up.");
  });

  test("writes the message into the tree when it completes", async () => {
    const { t, scene } = await setup();
    const prompt = await say(t, scene, "Anyone there?");
    const { snapshot } = await generate(t, scene);

    await adapter.started;
    adapter.push("Bell looks up. ");
    adapter.push("\"Ridge.\"");
    adapter.end();
    await until(() => t.generation.get(snapshot.id)?.status === "complete");

    const messages = (await (
      await t.fetch(`/api/scenes/${scene.id}/messages`)
    ).json()) as MessageDto[];
    expect(messages).toHaveLength(2);
    expect(messages[1]!.content).toBe('Bell looks up. "Ridge."');
    expect(messages[1]!.parentId).toBe(prompt.id);
    expect(messages[1]!.authorType).toBe("character");
  });

  test("records model, provider, time to first token and speed on the message", async () => {
    const { t, scene } = await setup();
    await say(t, scene, "go");
    const { snapshot } = await generate(t, scene);

    await adapter.started;
    adapter.push("Some prose that is long enough to measure.");
    adapter.end();
    await until(() => t.generation.get(snapshot.id)?.status === "complete");

    const meta = t.generation.get(snapshot.id)!.meta!;
    expect(meta.provider).toBe("llama.cpp");
    expect(meta.model).toBe("llama-3.3-70b");
    expect(meta.ttftMs).not.toBeNull();
    expect(meta.completionTokens).toBeGreaterThan(0);
    // Only the estimator ships, so the number must say it is estimated (§3).
    expect(meta.tokensAreEstimated).toBe(true);

    const stored = t.ctx.db
      .query("SELECT generation_meta FROM messages WHERE generation_meta IS NOT NULL")
      .get() as { generation_meta: string };
    expect(JSON.parse(stored.generation_meta)).toMatchObject({ model: "llama-3.3-70b" });
  });

  test("attaches to a named parent, which is how a reroll asks for a sibling", async () => {
    const { t, scene } = await setup();
    const first = await say(t, scene, "one");
    await say(t, scene, "two");

    const { snapshot } = await generate(t, scene, { parentId: first.id });
    await adapter.started;
    adapter.push("an alternative");
    adapter.end();
    await until(() => t.generation.get(snapshot.id)?.status === "complete");

    const messages = (await (
      await t.fetch(`/api/scenes/${scene.id}/messages`)
    ).json()) as MessageDto[];
    expect(messages.map((m) => m.content)).toEqual(["one", "an alternative"]);
    expect(messages[1]!.siblingCount).toBe(2);
  });

  test("refuses a second generation on a scene already generating", async () => {
    const { t, scene } = await setup();
    await say(t, scene, "go");
    await generate(t, scene);
    await adapter.started;

    // Two in flight would race to attach to the same parent, and the second
    // would silently become a swipe the user never asked for.
    const second = await generate(t, scene);
    expect(second.status).toBe(409);
  });

  test("refuses a scene with no connection profile", async () => {
    const { t } = await setup();
    const unbound = (await (
      await t.fetch("/api/scenes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Unbound" }),
      })
    ).json()) as SceneDto;

    const { status, snapshot } = await generate(t, unbound);
    expect(status).toBe(400);
    expect((snapshot as unknown as { error: { code: string } }).error.code).toBe("no_connection");
  });

  test("404s for an unknown scene, parent, or profile", async () => {
    const { t, scene } = await setup();
    expect((await generate(t, { ...scene, id: "NOPE" })).status).toBe(404);
    expect((await generate(t, scene, { parentId: "NOPE" })).status).toBe(404);
    expect((await generate(t, scene, { connectionProfileId: "NOPE" })).status).toBe(404);
  });

  test("needs a session", async () => {
    const { t, scene } = await setup();
    t.cookie = null;
    expect((await t.fetch(`/api/scenes/${scene.id}/generate`, { method: "POST" })).status).toBe(401);
  });
});

describe("resumable streaming", () => {
  test("replays what was missed, then continues live", async () => {
    const { t, scene } = await setup();
    await say(t, scene, "go");
    const { snapshot } = await generate(t, scene);

    await adapter.started;
    adapter.push("first ");
    adapter.push("second ");
    await until(() => (t.generation.get(snapshot.id)?.offset ?? 0) === 13);

    // A client arriving late asks from zero and gets everything so far.
    const response = await t.fetch(`/api/generations/${snapshot.id}/stream?offset=0`);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reading = readStream(response);
    await tick();
    adapter.push("third");
    adapter.end();

    const events = payloads(await reading);
    const text = events
      .filter((event) => event["type"] === "chunk")
      .map((event) => event["text"])
      .join("");
    expect(text).toBe("first second third");
    expect(events.at(-1)!["type"]).toBe("done");
  });

  test("an offset skips exactly what the client already has", async () => {
    const { t, scene } = await setup();
    await say(t, scene, "go");
    const { snapshot } = await generate(t, scene);

    await adapter.started;
    adapter.push("abcdefghij");
    await until(() => (t.generation.get(snapshot.id)?.offset ?? 0) === 10);

    const response = await t.fetch(`/api/generations/${snapshot.id}/stream?offset=4`);
    const reading = readStream(response);
    await tick();
    adapter.end();

    const chunks = payloads(await reading).filter((event) => event["type"] === "chunk");
    expect(chunks[0]).toMatchObject({ offset: 4, text: "efghij" });
  });

  test("a disconnected client does not stop the generation", async () => {
    const { t, scene } = await setup();
    await say(t, scene, "go");
    const { snapshot } = await generate(t, scene);

    await adapter.started;
    adapter.push("before ");

    // Open a stream and abandon it, exactly as a suspended tab does.
    const response = await t.fetch(`/api/generations/${snapshot.id}/stream?offset=0`);
    await response.body!.cancel();
    await tick();

    adapter.push("after");
    adapter.end();
    await until(() => t.generation.get(snapshot.id)?.status === "complete");

    // SPEC §5.4: nothing was lost while nobody was listening.
    expect(t.generation.get(snapshot.id)!.buffer).toBe("before after");

    // And reconnecting from the offset it had picks up the rest.
    const resumed = await t.fetch(`/api/generations/${snapshot.id}/stream?offset=7`);
    const events = payloads(await readStream(resumed));
    // The stream opens by naming who is speaking (SPEC §6), then replays.
    expect(events.filter((event) => event["type"] === "chunk")[0]).toMatchObject({
      type: "chunk",
      offset: 7,
      text: "after",
    });
  });

  test("a client arriving after the end still gets the terminal event", async () => {
    const { t, scene } = await setup();
    await say(t, scene, "go");
    const { snapshot } = await generate(t, scene);

    await adapter.started;
    adapter.push("all of it");
    adapter.end();
    await until(() => t.generation.get(snapshot.id)?.status === "complete");

    const events = payloads(await readStream(await t.fetch(`/api/generations/${snapshot.id}/stream`)));
    expect(events.filter((event) => event["type"] === "chunk")[0]).toMatchObject({
      type: "chunk",
      text: "all of it",
    });
    expect(events.at(-1)!["type"]).toBe("done");
  });

  test("an offset past the end replays nothing rather than throwing", async () => {
    const { t, scene } = await setup();
    await say(t, scene, "go");
    const { snapshot } = await generate(t, scene);
    await adapter.started;
    adapter.push("short");
    adapter.end();
    await until(() => t.generation.get(snapshot.id)?.status === "complete");

    const events = payloads(
      await readStream(await t.fetch(`/api/generations/${snapshot.id}/stream?offset=9999`)),
    );
    expect(events.filter((event) => event["type"] === "chunk")).toEqual([]);
    expect(events.at(-1)!["type"]).toBe("done");
  });

  test("two clients watching the same generation both receive it", async () => {
    const { t, scene } = await setup();
    await say(t, scene, "go");
    const { snapshot } = await generate(t, scene);
    await adapter.started;

    const phone = readStream(await t.fetch(`/api/generations/${snapshot.id}/stream`));
    const desktop = readStream(await t.fetch(`/api/generations/${snapshot.id}/stream`));
    await tick();
    adapter.push("shared output");
    adapter.end();

    for (const events of [payloads(await phone), payloads(await desktop)]) {
      expect(events.some((event) => event["text"] === "shared output")).toBe(true);
      expect(events.at(-1)!["type"]).toBe("done");
    }
  });

  test("404s for an unknown generation", async () => {
    const { t } = await setup();
    expect((await t.fetch("/api/generations/NOPE/stream")).status).toBe(404);
    expect((await t.fetch("/api/generations/NOPE")).status).toBe(404);
  });
});

describe("cancelling", () => {
  test("aborts upstream and keeps what was already written", async () => {
    const { t, scene } = await setup();
    await say(t, scene, "go");
    const { snapshot } = await generate(t, scene);

    await adapter.started;
    adapter.push("half a sen");
    await until(() => (t.generation.get(snapshot.id)?.offset ?? 0) === 10);

    const response = await t.fetch(`/api/generations/${snapshot.id}/cancel`, { method: "POST" });
    expect(response.status).toBe(200);
    await until(() => t.generation.get(snapshot.id)?.status === "cancelled");

    // The abort has to reach the adapter, or inference keeps running (§4).
    expect(adapter.aborted).toBe(true);

    // Partial output is still the user's text; discarding it loses work they
    // watched arrive (SPEC §5.6).
    const messages = (await (
      await t.fetch(`/api/scenes/${scene.id}/messages`)
    ).json()) as MessageDto[];
    expect(messages.map((m) => m.content)).toEqual(["go", "half a sen"]);
  });

  test("cancelling before any output writes no message", async () => {
    const { t, scene } = await setup();
    await say(t, scene, "go");
    const { snapshot } = await generate(t, scene);
    await adapter.started;

    await t.fetch(`/api/generations/${snapshot.id}/cancel`, { method: "POST" });
    await until(() => t.generation.get(snapshot.id)?.status === "cancelled");

    expect(t.generation.get(snapshot.id)!.messageId).toBeNull();
    const messages = (await (
      await t.fetch(`/api/scenes/${scene.id}/messages`)
    ).json()) as MessageDto[];
    expect(messages).toHaveLength(1);
  });

  test("tells a watching client the generation was cancelled", async () => {
    const { t, scene } = await setup();
    await say(t, scene, "go");
    const { snapshot } = await generate(t, scene);
    await adapter.started;

    const reading = readStream(await t.fetch(`/api/generations/${snapshot.id}/stream`));
    await tick();
    adapter.push("partial");
    await tick();
    await t.fetch(`/api/generations/${snapshot.id}/cancel`, { method: "POST" });

    const events = payloads(await reading);
    expect(events.at(-1)!["type"]).toBe("cancelled");
  });

  test("cancelling a finished generation is harmless", async () => {
    const { t, scene } = await setup();
    await say(t, scene, "go");
    const { snapshot } = await generate(t, scene);
    await adapter.started;
    adapter.push("done already");
    adapter.end();
    await until(() => t.generation.get(snapshot.id)?.status === "complete");

    const response = await t.fetch(`/api/generations/${snapshot.id}/cancel`, { method: "POST" });
    expect(response.status).toBe(200);
    expect(t.generation.get(snapshot.id)!.status).toBe("complete");
  });

  test("404s for an unknown generation", async () => {
    const { t } = await setup();
    expect((await t.fetch("/api/generations/NOPE/cancel", { method: "POST" })).status).toBe(404);
  });
});

describe("failures", () => {
  test("a provider error ends the generation and reaches the client", async () => {
    const { t, scene } = await setup();
    await say(t, scene, "go");
    const { snapshot } = await generate(t, scene);
    await adapter.started;

    const reading = readStream(await t.fetch(`/api/generations/${snapshot.id}/stream`));
    await tick();
    adapter.fail(new Error("upstream exploded"));

    const events = payloads(await reading);
    expect(events.at(-1)!["type"]).toBe("error");
    await until(() => t.generation.get(snapshot.id)?.status === "error");
    expect(t.generation.get(snapshot.id)!.error).toBeTruthy();
  });

  test("a failure writes no message", async () => {
    const { t, scene } = await setup();
    await say(t, scene, "go");
    const { snapshot } = await generate(t, scene);
    await adapter.started;
    adapter.fail(new Error("nope"));
    await until(() => t.generation.get(snapshot.id)?.status === "error");

    const messages = (await (
      await t.fetch(`/api/scenes/${scene.id}/messages`)
    ).json()) as MessageDto[];
    expect(messages).toHaveLength(1);
  });

  test("a failed generation frees the scene for another attempt", async () => {
    const { t, scene } = await setup();
    await say(t, scene, "go");
    const first = await generate(t, scene);
    await adapter.started;
    adapter.fail(new Error("nope"));
    await until(() => t.generation.get(first.snapshot.id)?.status === "error");

    expect((await generate(t, scene)).status).toBe(201);
  });
});

describe("persistence", () => {
  test("the buffer and status survive in the database", async () => {
    const { t, scene } = await setup();
    await say(t, scene, "go");
    const { snapshot } = await generate(t, scene);
    await adapter.started;
    adapter.push("persisted output");
    adapter.end();
    await until(() => t.generation.get(snapshot.id)?.status === "complete");

    const row = t.ctx.db
      .query("SELECT status, buffer, offset, target_message_id FROM generations WHERE ulid = $ulid")
      .get({ ulid: snapshot.id }) as {
      status: string;
      buffer: string;
      offset: number;
      target_message_id: number | null;
    };
    expect(row.status).toBe("complete");
    expect(row.buffer).toBe("persisted output");
    expect(row.offset).toBe("persisted output".length);
    expect(row.target_message_id).not.toBeNull();
  });

  test("a generation evicted from memory is still readable from disk", async () => {
    const { t, scene } = await setup();
    await say(t, scene, "go");
    const { snapshot } = await generate(t, scene);
    await adapter.started;
    adapter.push("still here");
    adapter.end();
    await until(() => t.generation.get(snapshot.id)?.status === "complete");

    // Simulate the in-memory TTL expiring.
    (t.generation as unknown as { active: Map<string, unknown> }).active.delete(snapshot.id);

    const recovered = t.generation.get(snapshot.id);
    expect(recovered).not.toBeNull();
    expect(recovered!.buffer).toBe("still here");
    expect(recovered!.status).toBe("complete");
    expect(recovered!.messageId).toBeTruthy();
  });
});
