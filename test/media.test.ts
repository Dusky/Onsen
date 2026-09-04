import { afterEach, describe, expect, test } from "bun:test";
import { ScriptedAdapter, completeSetup, createHarness, type TestHarness } from "./helpers.ts";
import { V2_CARD, pngCard } from "./card-fixtures.ts";
import { a1111Adapter } from "../server/media/a1111.ts";
import { openaiImageAdapter } from "../server/media/openai-image.ts";
import { openaiSpeechAdapter } from "../server/media/openai-speech.ts";
import { proseToPrompt, buildCaptionPrompt } from "../server/media/runner.ts";
import { pathFor, extensionFor, mimeForPath } from "../server/media/store.ts";
import { createOpenAiAdapter } from "../server/adapters/openai.ts";
import { createAnthropicAdapter } from "../server/adapters/anthropic.ts";
import type { CharacterDto, ConnectionProfileDto, MessageDto, SceneDto } from "../shared/types.ts";
import type { BuiltPrompt } from "../server/prompt/index.ts";

/**
 * Pictures, voices and captions (SPEC §20 phase 41).
 *
 * The three features share almost nothing, so these are three suites. What ties
 * them together is the one rule §20 states for this phase and §17 restates: the
 * bytes stay on this server, and a picture never reaches a roleplay prompt —
 * only what a vision model said about it does.
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

/** A 1x1 PNG, small enough to inline and real enough to upload. */
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/* ------------------------------------------------------------------ */
/* The adapters, against a stub written from the API docs rather than  */
/* from my own code.                                                   */
/* ------------------------------------------------------------------ */

describe("the image adapters", () => {
  test("OpenAI asks for bytes rather than a link, and gets them", async () => {
    let seen: Record<string, unknown> = {};
    const stub = (async (_url: unknown, init: RequestInit | undefined) => {
      seen = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({ data: [{ b64_json: PNG_BYTES.toString("base64") }] }),
        { headers: { "Content-Type": "application/json" } },
      );
    
    }) as unknown as typeof globalThis.fetch;
    const image = openaiImageAdapter({
      baseUrl: "https://example.test/v1",
      apiKey: "k",
      model: "gpt-image-1",
      options: { size: "512x512" },
      fetch: stub,
    });
    const result = await image.draw({ prompt: "a closed pass" }, new AbortController().signal);

    // A URL would expire, and would mean the reader's browser fetching from the
    // provider — which says who is looking at what.
    expect(seen["response_format"]).toBe("b64_json");
    expect(seen["size"]).toBe("512x512");
    expect(result.mime).toBe("image/png");
    expect(result.bytes.byteLength).toBe(PNG_BYTES.byteLength);
  });

  test("a service that sends a link instead is told apart from one that sends nothing", async () => {
    const stub = (async () =>
      new Response(JSON.stringify({ data: [{ url: "https://example.test/a.png" }] }), {
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof globalThis.fetch;
    const image = openaiImageAdapter({
      baseUrl: "https://example.test/v1",
      apiKey: null,
      model: null,
      options: {},
      fetch: stub,
    });
    await expect(
      image.draw({ prompt: "x" }, new AbortController().signal),
    ).rejects.toThrow(/link rather than the image/);
  });

  test("A1111 sends a real negative prompt and its checkpoint override", async () => {
    let seen: Record<string, unknown> = {};
    const stub = (async (_url: unknown, init: RequestInit | undefined) => {
      seen = JSON.parse(String(init?.body)) as Record<string, unknown>;
      // A1111 does return a bare base64 string, with no data: prefix.
      return new Response(JSON.stringify({ images: [PNG_BYTES.toString("base64")] }), {
        headers: { "Content-Type": "application/json" },
      });
    
    }) as unknown as typeof globalThis.fetch;
    const image = a1111Adapter({
      baseUrl: "http://127.0.0.1:7860",
      apiKey: null,
      model: "someMix.safetensors",
      options: { steps: 30, sampler: "DPM++ 2M", negativePrompt: "blurry" },
      fetch: stub,
    });
    const result = await image.draw({ prompt: "a closed pass" }, new AbortController().signal);

    expect(seen["negative_prompt"]).toBe("blurry");
    expect(seen["steps"]).toBe(30);
    expect(seen["sampler_name"]).toBe("DPM++ 2M");
    expect(seen["override_settings"]).toEqual({ sd_model_checkpoint: "someMix.safetensors" });
    expect(result.bytes.byteLength).toBe(PNG_BYTES.byteLength);
  });

  test("A1111's data-URL form is accepted too", async () => {
    const stub = (async () =>
      new Response(
        JSON.stringify({ images: [`data:image/png;base64,${PNG_BYTES.toString("base64")}`] }),
        { headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof globalThis.fetch;
    const image = a1111Adapter({
      baseUrl: "http://127.0.0.1:7860",
      apiKey: null,
      model: null,
      options: {},
      fetch: stub,
    });
    const result = await image.draw({ prompt: "x" }, new AbortController().signal);
    expect(result.bytes.byteLength).toBe(PNG_BYTES.byteLength);
  });

  test("a refusal carries the service's own words, not just a status", async () => {
    const stub = (async () =>
      new Response(JSON.stringify({ error: { message: "content policy" } }), {
        status: 400,
      })) as unknown as typeof globalThis.fetch;
    const image = openaiImageAdapter({
      baseUrl: "https://example.test/v1",
      apiKey: "k",
      model: null,
      options: {},
      fetch: stub,
    });
    const caught = await image
      .draw({ prompt: "x" }, new AbortController().signal)
      .then(() => null)
      .catch((error: unknown) => error as { providerMessage: string; retryable: boolean });
    expect(caught?.providerMessage).toBe("content policy");
    // A 400 is the request, not the weather. Retrying it changes nothing.
    expect(caught?.retryable).toBe(false);
  });

  test("abort reaches the service", async () => {
    let sawSignal: AbortSignal | null = null;
    const stub = (async (_url: unknown, init: RequestInit | undefined) => {
      sawSignal = init?.signal ?? null;
      return new Response(JSON.stringify({ images: [PNG_BYTES.toString("base64")] }));
    
    }) as unknown as typeof globalThis.fetch;
    const controller = new AbortController();
    const image = a1111Adapter({
      baseUrl: "http://127.0.0.1:7860",
      apiKey: null,
      model: null,
      options: {},
      fetch: stub,
    });
    await image.draw({ prompt: "x" }, controller.signal);
    // §4 requires this of text adapters and asserts it; a drawing request pins
    // a GPU for longer than a chat completion does.
    expect(sawSignal).not.toBeNull();
  });
});

describe("the speech adapter", () => {
  test("reads raw audio bytes and names the format it asked for", async () => {
    let seen: Record<string, unknown> = {};
    const stub = (async (_url: unknown, init: RequestInit | undefined) => {
      seen = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(new Uint8Array([1, 2, 3, 4]).buffer);
    
    }) as unknown as typeof globalThis.fetch;
    const speech = openaiSpeechAdapter({
      baseUrl: "https://example.test/v1",
      apiKey: "k",
      model: "tts-1",
      options: { voice: "nova", format: "wav" },
      fetch: stub,
    });
    const result = await speech.speak({ text: "Say the number." }, new AbortController().signal);

    expect(seen["voice"]).toBe("nova");
    expect(seen["response_format"]).toBe("wav");
    expect(result.mime).toBe("audio/wav");
    expect(result.bytes.byteLength).toBe(4);
  });

  test("a request's own voice beats the service's configured one", async () => {
    let seen: Record<string, unknown> = {};
    const stub = (async (_url: unknown, init: RequestInit | undefined) => {
      seen = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(new Uint8Array([1]).buffer);
    
    }) as unknown as typeof globalThis.fetch;
    const speech = openaiSpeechAdapter({
      baseUrl: "https://example.test/v1",
      apiKey: "k",
      model: null,
      options: { voice: "nova" },
      fetch: stub,
    });
    await speech.speak({ text: "x", voice: "echo" }, new AbortController().signal);
    expect(seen["voice"]).toBe("echo");
  });

  test("long text is truncated rather than refused", async () => {
    let seen: Record<string, unknown> = {};
    const stub = (async (_url: unknown, init: RequestInit | undefined) => {
      seen = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(new Uint8Array([1]).buffer);
    
    }) as unknown as typeof globalThis.fetch;
    const speech = openaiSpeechAdapter({
      baseUrl: "https://example.test/v1",
      apiKey: "k",
      model: null,
      options: {},
      fetch: stub,
    });
    await speech.speak({ text: "a".repeat(9_000) }, new AbortController().signal);
    // A reader who pressed play wants to hear it start, not to be told no.
    expect(String(seen["input"]).length).toBe(4_096);
  });

  test("an empty body is a failure, not silence", async () => {
    const stub = (async () =>
      new Response(new ArrayBuffer(0))) as unknown as typeof globalThis.fetch;
    const speech = openaiSpeechAdapter({
      baseUrl: "https://example.test/v1",
      apiKey: "k",
      model: null,
      options: {},
      fetch: stub,
    });
    await expect(
      speech.speak({ text: "x" }, new AbortController().signal),
    ).rejects.toThrow(/no audio/);
  });
});

/* ------------------------------------------------------------------ */
/* Vision, on the wire                                                 */
/* ------------------------------------------------------------------ */

describe("a picture on the wire", () => {
  const prompt: BuiltPrompt = buildCaptionPrompt("What is in this?", {
    mime: "image/png",
    base64: PNG_BYTES.toString("base64"),
  });

  test("OpenAI sends content parts, and only when there is a picture", async () => {
    let seen: { messages: { role: string; content: unknown }[] } = { messages: [] };
    const stub = (async (_url: unknown, init: RequestInit | undefined) => {
      seen = JSON.parse(String(init?.body)) as typeof seen;
      return new Response('data: {"choices":[{"delta":{"content":"a dot"}}]}\n\ndata: [DONE]\n\n', {
        headers: { "Content-Type": "text/event-stream" },
      });
    
    }) as unknown as typeof globalThis.fetch;
    const chat = createOpenAiAdapter({
      baseUrl: "https://example.test/v1",
      apiKey: "k",
      model: "gpt-4o",
      fetch: stub,
    });
    for await (const _ of chat.generate(prompt, {}, new AbortController().signal)) {
      // drained
    }

    const system = seen.messages.find((m) => m.role === "system")!;
    const user = seen.messages.find((m) => m.role === "user")!;
    // The system turn has no picture, so it stays a plain string: several local
    // servers implement the string and not the array.
    expect(typeof system.content).toBe("string");
    const parts = user.content as { type: string; image_url?: { url: string } }[];
    expect(parts.map((part) => part.type)).toEqual(["text", "image_url"]);
    expect(parts[1]!.image_url!.url).toStartWith("data:image/png;base64,");
  });

  test("Anthropic sends blocks, with the picture first", async () => {
    let seen: { messages: { role: string; content: unknown }[] } = { messages: [] };
    const stub = (async (_url: unknown, init: RequestInit | undefined) => {
      seen = JSON.parse(String(init?.body)) as typeof seen;
      return new Response("event: message_stop\ndata: {}\n\n", {
        headers: { "Content-Type": "text/event-stream" },
      });
    
    }) as unknown as typeof globalThis.fetch;
    const chat = createAnthropicAdapter({
      baseUrl: "https://example.test",
      apiKey: "k",
      model: "claude-sonnet-4-5",
      fetch: stub,
    });
    for await (const _ of chat.generate(prompt, {}, new AbortController().signal)) {
      // drained
    }
    const blocks = seen.messages[0]!.content as { type: string; source?: { media_type: string } }[];
    expect(blocks.map((block) => block.type)).toEqual(["image", "text"]);
    expect(blocks[0]!.source!.media_type).toBe("image/png");
  });

  test("the inspector shows the question and not the payload", () => {
    const block = prompt.debug.blocks.find((b) => b.id === "caption")!;
    // A base64 payload in a debug panel pushes everything readable off screen.
    expect(block.content).not.toContain("base64");
    expect(block.content).toContain("[the attached image]");
  });
});

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

describe("prose as a service prompt", () => {
  test("speaker labels, emphasis and asides come out", () => {
    const result = proseToPrompt(
      "**Mira Vance:** She *set* the ledger down. ((this is an aside)) It was quiet.",
    );
    expect(result).not.toContain("Mira Vance:");
    expect(result).not.toContain("*");
    expect(result).not.toContain("aside");
    expect(result).toContain("She set the ledger down.");
  });

  test("it is trimmed rather than refused", () => {
    expect(proseToPrompt("a".repeat(50), 10)).toHaveLength(10);
  });
});

describe("the store", () => {
  test("the same bytes are the same file, and different bytes are not", () => {
    const a = pathFor(new Uint8Array([1, 2, 3]), "image/png");
    const b = pathFor(new Uint8Array([1, 2, 3]), "image/png");
    const c = pathFor(new Uint8Array([1, 2, 4]), "image/png");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toEndWith(".png");
  });

  test("a mime round-trips through a stored name", () => {
    for (const mime of ["image/png", "image/webp", "audio/mpeg", "audio/wav"]) {
      expect(mimeForPath(`abc.${extensionFor(mime)}`)).toBe(mime);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Through the app                                                     */
/* ------------------------------------------------------------------ */

async function scene(t: TestHarness): Promise<{ sceneId: string; messageId: string }> {
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
  const message = await json<MessageDto>(t, "POST", `/api/scenes/${created.id}/messages`, {
    kind: "user",
    authorType: "user",
    content: "The pass is closed until spring.",
  });
  return { sceneId: created.id, messageId: message.id };
}

async function upload(t: TestHarness, sceneId: string) {
  const form = new FormData();
  form.append("file", new File([PNG_BYTES as unknown as BlobPart], "dot.png", { type: "image/png" }));
  const response = await t.fetch(`/api/media/scenes/${sceneId}/attachments`, {
    method: "POST",
    body: form,
  });
  return {
    status: response.status,
    body: (await response.json()) as {
      asset: { id: string; url: string; caption: string | null };
      captionError: string | null;
    },
  };
}

describe("services", () => {
  test("the kinds arrive with words on them", async () => {
    const t = await signedIn();
    const { kinds } = await json<{ kinds: { kind: string; label: string }[] }>(
      t,
      "GET",
      "/api/media/kinds",
    );
    // Four phases running, a raw enum reached a screen. The labels come from
    // the server so a screen never has to guess what "a1111" is called.
    expect(kinds.every((k) => k.label !== k.kind)).toBe(true);
  });

  test("a key is stored, masked, and never sent back", async () => {
    const t = await signedIn();
    const created = await json<{ id: string; hasApiKey: boolean; apiKeyMask: string | null }>(
      t,
      "POST",
      "/api/media/services",
      { purpose: "image", kind: "openai", name: "Pictures", apiKey: "sk-abcdef123456" },
    );
    expect(created.hasApiKey).toBe(true);
    expect(created.apiKeyMask).not.toContain("abcdef");
    expect(JSON.stringify(created)).not.toContain("sk-abcdef123456");
  });

  test("an empty key on a save leaves the stored one alone", async () => {
    const t = await signedIn();
    const created = await json<{ id: string }>(t, "POST", "/api/media/services", {
      purpose: "image",
      kind: "openai",
      apiKey: "sk-original",
    });
    // A form that round-trips the mask would otherwise wipe the key on every
    // save that did not retype it.
    const after = await json<{ hasApiKey: boolean }>(
      t,
      "PATCH",
      `/api/media/services/${created.id}`,
      { name: "Renamed", apiKey: "" },
    );
    expect(after.hasApiKey).toBe(true);
  });

  test("the first service of a purpose becomes its default", async () => {
    const t = await signedIn();
    const first = await json<{ isDefault: boolean }>(t, "POST", "/api/media/services", {
      purpose: "image",
      kind: "a1111",
    });
    const second = await json<{ isDefault: boolean }>(t, "POST", "/api/media/services", {
      purpose: "image",
      kind: "openai",
    });
    expect(first.isDefault).toBe(true);
    expect(second.isDefault).toBe(false);
  });

  test("choosing a picture default does not unset the voice one", async () => {
    const t = await signedIn();
    await json(t, "POST", "/api/media/services", { purpose: "speech", kind: "openai" });
    const image = await json<{ id: string }>(t, "POST", "/api/media/services", {
      purpose: "image",
      kind: "openai",
    });
    await json(t, "PATCH", `/api/media/services/${image.id}`, { isDefault: true });
    const { services } = await json<{ services: { purpose: string; isDefault: boolean }[] }>(
      t,
      "GET",
      "/api/media/services",
    );
    expect(services.filter((s) => s.isDefault).map((s) => s.purpose).sort()).toEqual([
      "image",
      "speech",
    ]);
  });

  test("drawing with nothing configured says so rather than failing obscurely", async () => {
    const t = await signedIn();
    const { messageId } = await scene(t);
    const response = await t.fetch(`/api/media/messages/${messageId}/illustrate`, {
      method: "POST",
    });
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain("Settings");
  });
});

/**
 * Point the caption op at an endpoint that can actually be shown a picture.
 *
 * The shipped default profile is a text-completion endpoint, which is the right
 * default for prose and the wrong one for this — see the refusal test below.
 */
async function withVision(t: TestHarness): Promise<void> {
  const provider = await json<{ id: string }>(t, "POST", "/api/connections/providers", {
    name: "A model that can see",
    kind: "openai_compatible",
    baseUrl: "http://localhost:8080/v1",
    model: "vision-1",
  });
  const profile = await json<{ id: string }>(t, "POST", "/api/connections/profiles", {
    name: "Vision",
    providerId: provider.id,
    model: "vision-1",
  });
  await json(t, "PATCH", "/api/tasks/caption_image", { connectionProfileId: profile.id });
}

/**
 * The prompt the prose was written from.
 *
 * Neither `prompts.at(-1)` nor the first one after the request: the
 * post-generation pipeline runs trackers and guides through the same adapter
 * and is not awaited, so a straggler from the previous turn lands in either
 * position. Every side call asks exactly one question, so message count is the
 * discriminator that actually holds.
 */
async function roleplayPrompt(t: TestHarness, sceneId: string): Promise<BuiltPrompt> {
  const before = adapter.prompts.length;
  await json(t, "POST", `/api/scenes/${sceneId}/generate`, {});
  await adapter.started;
  adapter.push("She looked.");
  adapter.end();
  const written = adapter.prompts.slice(before).find((sent) => sent.messages.length > 1);
  expect(written).toBeDefined();
  return written!;
}

describe("attachments", () => {
  test("a text-completion endpoint is refused, and told how to fix it", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    adapter.taskReply = "A dot.";

    // The shipped profile is llama.cpp. There is nowhere in a raw completion to
    // put a picture, so sending one would buy a confident description of
    // nothing — checked before the call rather than after.
    const uploaded = await upload(t, sceneId);
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.captionError).toContain("text-completion");
    expect(uploaded.body.captionError).toContain("Settings");
    // Refused, and the picture is still kept.
    expect(uploaded.body.asset.url).toContain("/api/media/files/");
  });

  test("the picture is stored and captioned, and the caption is what reaches the prompt", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await withVision(t);
    adapter.taskReply = "A single dark pixel on a white field.";

    const uploaded = await upload(t, sceneId);
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.asset.caption).toBe("A single dark pixel on a white field.");

    // Sending a line binds the pending picture to it, which is what puts the
    // caption in front of the author.
    await json(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "Look at this.",
    });
    const sent = await roleplayPrompt(t, sceneId);
    const wire = JSON.stringify(sent.messages);
    expect(wire).toContain("[image: A single dark pixel on a white field.]");
    // The whole point: a roleplay prompt carries words about the picture and
    // never the picture. Bytes here would cost the context window every turn.
    expect(wire).not.toContain(PNG_BYTES.toString("base64"));
    expect(sent.messages.every((message) => message.images === undefined)).toBe(true);
  });

  test("a failed caption still keeps the picture", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await withVision(t);
    adapter.taskFails = true;

    const uploaded = await upload(t, sceneId);
    expect(uploaded.status).toBe(201);
    // An upload that vanished because a side call failed would be the worse
    // outcome: the reader can still see it, and can ask again.
    expect(uploaded.body.asset.url).toContain("/api/media/files/");
    expect(uploaded.body.asset.caption).toBeNull();
  });

  test("the bytes come back from this app, with the right type", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await withVision(t);
    adapter.taskReply = "A dot.";
    const uploaded = await upload(t, sceneId);

    const response = await t.fetch(uploaded.body.asset.url);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await response.arrayBuffer()).byteLength).toBe(PNG_BYTES.byteLength);
  });

  test("the two switches are independent, and only one of them touches the prompt", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await withVision(t);
    adapter.taskReply = "A single dark pixel on a white field.";
    const uploaded = await upload(t, sceneId);
    const assetId = uploaded.body.asset.id;

    await json(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "Look at this.",
    });

    const promptFor = async (): Promise<string> =>
      JSON.stringify((await roleplayPrompt(t, sceneId)).messages);

    // Hidden from the log is not hidden from the author. §2 makes the same
    // split for a message, and a single switch would force one on the other.
    const hidden = await json<{ hidden: boolean; inPrompt: boolean }>(
      t,
      "PATCH",
      `/api/media/files/${assetId}`,
      { hidden: true },
    );
    expect(hidden.hidden).toBe(true);
    expect(hidden.inPrompt).toBe(true);
    expect(await promptFor()).toContain("[image: A single dark pixel");

    // Out of the prompt is the switch that changes what the author is told.
    const quiet = await json<{ hidden: boolean; inPrompt: boolean }>(
      t,
      "PATCH",
      `/api/media/files/${assetId}`,
      { inPrompt: false },
    );
    expect(quiet.hidden).toBe(true);
    expect(quiet.inPrompt).toBe(false);
    expect(await promptFor()).not.toContain("[image:");

    // And back: turning it on again returns it to the prompt.
    await json(t, "PATCH", `/api/media/files/${assetId}`, { inPrompt: true, hidden: false });
    expect(await promptFor()).toContain("[image: A single dark pixel");
  });

  test("something that is not a picture is refused", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    const form = new FormData();
    form.append("file", new File(["#!/bin/sh"], "x.sh", { type: "application/x-sh" }));
    const response = await t.fetch(`/api/media/scenes/${sceneId}/attachments`, {
      method: "POST",
      body: form,
    });
    expect(response.status).toBe(400);
  });
});
