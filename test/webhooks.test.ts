import { afterEach, describe, expect, test } from "bun:test";
import { ScriptedAdapter, completeSetup, createHarness, until, type TestHarness } from "./helpers.ts";
import { V2_CARD, pngCard } from "./card-fixtures.ts";
import { subscribersOf, type Subscription } from "../server/webhooks/events.ts";
import { signPayload, verifySignature, SIGNATURE_HEADER, EVENT_HEADER } from "../server/webhooks/sign.ts";
import { urlProblem } from "../server/webhooks/sender.ts";
import type { CharacterDto, ConnectionProfileDto, MessageDto, SceneDto } from "../shared/types.ts";

/**
 * Outbound webhooks (SPEC §15, §20 phase 35).
 *
 * Two things matter more than the plumbing. A receiver has to be able to verify
 * a signature — a scheme whose only implementation is the sender is one nobody
 * can be sure they got right — and nothing a receiver does may reach a turn.
 * Both are tested against a `fetch` that never leaves the process.
 */

interface Sent {
  url: string;
  body: string;
  headers: Record<string, string>;
}

let harness: TestHarness | null = null;
let adapter: ScriptedAdapter;
let sent: Sent[] = [];
let answer: () => Response = () => new Response("ok", { status: 200 });

function recordingFetch(): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[key] = value;
    }
    sent.push({ url: String(input), body: String(init?.body ?? ""), headers });
    return answer();
  }) as typeof globalThis.fetch;
}

async function signedIn(): Promise<TestHarness> {
  if (harness === null) {
    adapter = new ScriptedAdapter();
    sent = [];
    answer = () => new Response("ok", { status: 200 });
    harness = createHarness({ adapter, webhookFetch: recordingFetch() });
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

async function statusOf(t: TestHarness, method: string, path: string, body?: unknown) {
  const response = await t.fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  return response.status;
}

interface WebhookDto {
  id: string;
  name: string;
  url: string;
  events: string[];
  enabled: boolean;
  failures: number;
  disabledReason: string | null;
  deliveries: { event: string; status: string; responseCode: number | null; detail: string | null }[];
}

function subscribe(t: TestHarness, over: Record<string, unknown> = {}) {
  return json<WebhookDto & { secret: string }>(t, "POST", "/api/webhooks", {
    name: "Bridge",
    url: "http://localhost:9999/hook",
    events: ["message.created"],
    ...over,
  });
}

async function scene(t: TestHarness): Promise<string> {
  const form = new FormData();
  form.append("file", new File([pngCard({ chara: V2_CARD }) as unknown as BlobPart], "bell.png"));
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

describe("signing", () => {
  const secret = "a-signing-key";
  const body = JSON.stringify({ event: "message.created" });

  test("a receiver can verify what the sender sent", () => {
    const now = Date.UTC(2026, 2, 4, 9, 41);
    const header = signPayload(secret, body, Math.floor(now / 1000));
    expect(verifySignature(secret, body, header, now)).toBe(true);
  });

  test("a different key, a changed body, or a mangled header all fail", () => {
    const now = Date.now();
    const header = signPayload(secret, body, Math.floor(now / 1000));
    expect(verifySignature("another key", body, header, now)).toBe(false);
    expect(verifySignature(secret, `${body} `, header, now)).toBe(false);
    expect(verifySignature(secret, body, "nonsense", now)).toBe(false);
    expect(verifySignature(secret, body, "t=1,v1=zz", now)).toBe(false);
  });

  test("an old signature is refused, because the timestamp is inside it", () => {
    const then = Date.now() - 3_600_000;
    const header = signPayload(secret, body, Math.floor(then / 1000));
    // Replayable forever without this: anyone who captured one delivery could
    // send it again and the receiver could not tell.
    expect(verifySignature(secret, body, header, Date.now())).toBe(false);
    expect(verifySignature(secret, body, header, then)).toBe(true);
  });
});

describe("which subscriptions want an event", () => {
  const all: Subscription[] = [
    { id: "everywhere", events: ["message.created"], sceneId: null, enabled: true },
    { id: "one-scene", events: ["message.created"], sceneId: "scene-1", enabled: true },
    { id: "other-event", events: ["tracker.updated"], sceneId: null, enabled: true },
    { id: "off", events: ["message.created"], sceneId: null, enabled: false },
  ];

  test("by event, by scene, and never one that is switched off", () => {
    expect(subscribersOf(all, "message.created", "scene-1").map((s) => s.id)).toEqual([
      "everywhere",
      "one-scene",
    ]);
    expect(subscribersOf(all, "message.created", "scene-2").map((s) => s.id)).toEqual([
      "everywhere",
    ]);
    expect(subscribersOf(all, "beat.parsed", "scene-1")).toEqual([]);
  });
});

describe("the URL", () => {
  test("http and https only", () => {
    expect(urlProblem("https://example.test/hook")).toBeNull();
    expect(urlProblem("http://localhost:9999/hook")).toBeNull();
    expect(urlProblem("file:///etc/passwd")).not.toBeNull();
    expect(urlProblem("not a url")).not.toBeNull();
  });

  test("credentials in the URL are refused", () => {
    // A signed payload carrying basic-auth in its destination would put a
    // second secret somewhere this app does not encrypt.
    expect(urlProblem("https://user:pass@example.test/hook")).toContain("header");
  });

  test("a loopback address is allowed, because that is the usual receiver", () => {
    expect(urlProblem("http://127.0.0.1:3000/onsen")).toBeNull();
  });
});

describe("the surface", () => {
  test("the signing key is returned once and never again", async () => {
    const t = await signedIn();
    const made = await subscribe(t);
    expect(made.secret).toMatch(/^[0-9a-f]{64}$/);

    const listed = await json<WebhookDto[]>(t, "GET", "/api/webhooks");
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(made.secret);
  });

  test("rotating gives a new key", async () => {
    const t = await signedIn();
    const made = await subscribe(t);
    const rotated = await json<{ secret: string }>(t, "POST", `/api/webhooks/${made.id}/rotate`);
    expect(rotated.secret).not.toBe(made.secret);
  });

  test("a subscription to nothing is refused", async () => {
    const t = await signedIn();
    expect(await statusOf(t, "POST", "/api/webhooks", {
      name: "x",
      url: "https://example.test/h",
      events: [],
    })).toBe(400);
    // And an event this app does not send is not an event.
    expect(await statusOf(t, "POST", "/api/webhooks", {
      name: "x",
      url: "https://example.test/h",
      events: ["something.invented"],
    })).toBe(400);
  });

  test("deleting a scene takes its scene-scoped subscriptions", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    await subscribe(t, { sceneId });
    await t.fetch(`/api/scenes/${sceneId}`, { method: "DELETE" });
    expect(await json<WebhookDto[]>(t, "GET", "/api/webhooks")).toEqual([]);
  });
});

describe("delivering", () => {
  test("a message the reader wrote reaches a subscriber, signed", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    const made = await subscribe(t);

    await json<MessageDto>(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "is the pass open?",
    });
    await t.webhooks.drain();

    expect(sent).toHaveLength(1);
    const delivery = sent[0]!;
    expect(delivery.url).toBe("http://localhost:9999/hook");
    expect(delivery.headers[EVENT_HEADER]).toBe("message.created");

    // Verified exactly as a receiver would, with the key it was handed.
    expect(
      verifySignature(made.secret, delivery.body, delivery.headers[SIGNATURE_HEADER]!, Date.now()),
    ).toBe(true);

    const payload = JSON.parse(delivery.body) as {
      event: string;
      sceneId: string;
      sceneTitle: string;
      data: { content: string };
    };
    expect(payload.event).toBe("message.created");
    expect(payload.sceneId).toBe(sceneId);
    expect(payload.sceneTitle).toBe("The pass");
    expect(payload.data.content).toBe("is the pass open?");
  });

  test("a subscription bound to one roleplay hears nothing from another", async () => {
    const t = await signedIn();
    const mine = await scene(t);
    const theirs = await scene(t);
    await subscribe(t, { sceneId: mine });

    await json(t, "POST", `/api/scenes/${theirs}/messages`, {
      kind: "user",
      authorType: "user",
      content: "elsewhere",
    });
    await t.webhooks.drain();
    expect(sent).toHaveLength(0);
  });

  test("a turn fires generation.complete and the message it wrote", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    await subscribe(t, { events: ["generation.complete", "message.created"] });
    await json(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "go on",
    });
    sent = [];

    const snapshot = await json<{ id: string }>(t, "POST", `/api/scenes/${sceneId}/generate`, {});
    await adapter.started;
    adapter.push("She said the pass was closed.");
    adapter.end();
    await until(() => t.generation.get(snapshot.id)?.status === "complete");
    await t.webhooks.drain();

    const events = sent.map((delivery) => delivery.headers[EVENT_HEADER]);
    expect(events).toContain("generation.complete");
    expect(events).toContain("message.created");

    const complete = sent.find((d) => d.headers[EVENT_HEADER] === "generation.complete")!;
    const payload = JSON.parse(complete.body) as { data: { status: string; content: string } };
    expect(payload.data.status).toBe("complete");
    expect(payload.data.content).toBe("She said the pass was closed.");
  });

  test("nothing is sent when nothing subscribed to that event", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    await subscribe(t, { events: ["tracker.updated"] });
    await json(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "quiet",
    });
    await t.webhooks.drain();
    expect(sent).toHaveLength(0);
  });
});

describe("a receiver that is not answering", () => {
  test("cannot break the turn, and the failure is recorded", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    const made = await subscribe(t);
    answer = () => {
      throw new Error("connection refused");
    };

    // The write still succeeds, and the reply still comes back.
    const message = await json<MessageDto>(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "still fine",
    });
    expect(message.content).toBe("still fine");
    await t.webhooks.drain();

    // Three attempts, all logged. A webhook is the one feature whose failures
    // happen entirely off-screen (§18).
    const listed = await json<WebhookDto[]>(t, "GET", "/api/webhooks");
    const hook = listed.find((row) => row.id === made.id)!;
    expect(hook.deliveries).toHaveLength(3);
    expect(hook.deliveries.every((delivery) => delivery.status === "failed")).toBe(true);
    expect(hook.deliveries[0]?.detail).toContain("connection refused");
    expect(hook.failures).toBe(1);
  });

  test("a non-2xx answer is a failure, and its status is kept", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    const made = await subscribe(t);
    answer = () => new Response("no thanks", { status: 503 });

    await json(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "hello",
    });
    await t.webhooks.drain();

    const listed = await json<WebhookDto[]>(t, "GET", "/api/webhooks");
    const hook = listed.find((row) => row.id === made.id)!;
    expect(hook.deliveries[0]?.responseCode).toBe(503);
    expect(hook.deliveries[0]?.detail).toContain("no thanks");
  });

  test("switching one back on clears the failures that switched it off", async () => {
    const t = await signedIn();
    const made = await subscribe(t);
    t.ctx.db.query("UPDATE webhooks SET failures = 20, enabled = 0, disabled_reason = 'gone'").run();

    const back = await json<WebhookDto>(t, "PATCH", `/api/webhooks/${made.id}`, { enabled: true });
    expect(back.enabled).toBe(true);
    expect(back.failures).toBe(0);
    expect(back.disabledReason).toBeNull();
  });

  test("the test button says what came back", async () => {
    const t = await signedIn();
    const made = await subscribe(t);
    answer = () => new Response("", { status: 204 });
    const result = await json<{ ok: boolean; status: number }>(
      t,
      "POST",
      `/api/webhooks/${made.id}/test`,
    );
    expect(result.ok).toBe(true);
    expect(result.status).toBe(204);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!.body).data.test).toBe(true);
  });
});
