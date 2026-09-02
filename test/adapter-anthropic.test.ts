import { describe, expect, test } from "bun:test";
import {
  anthropicCapabilities,
  anthropicModelRules,
  anthropicModelVersion,
  createAnthropicAdapter,
} from "../server/adapters/anthropic.ts";
import { AdapterError } from "../server/adapters/types.ts";
import type { BuiltPrompt } from "../server/prompt/index.ts";
import { MODERN_SAMPLER_DEFAULTS } from "../shared/types.ts";

/**
 * The Anthropic adapter, against recorded fixtures rather than a live API and a
 * bill (SPEC §23).
 *
 * Most of what is worth testing here is not the streaming — that is the shared
 * SSE parser, covered in the OpenAI suite — but the shape of the request. Three
 * things about this API are unlike every other provider in the app, and each
 * one is a hard failure rather than a degraded result: `system` is its own
 * parameter, `max_tokens` is required, and sampling parameters were removed
 * from the 4.6 generation onward.
 */

function bodyOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function textDelta(text: string): string {
  return `event: content_block_delta\ndata: ${JSON.stringify({
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text },
  })}\n\n`;
}

function thinkingDelta(thinking: string): string {
  return `event: content_block_delta\ndata: ${JSON.stringify({
    type: "content_block_delta",
    index: 0,
    delta: { type: "thinking_delta", thinking },
  })}\n\n`;
}

const MESSAGE_START =
  `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: {} })}\n\n`;
const MESSAGE_STOP = `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`;

interface FakeCall {
  url: string;
  init: RequestInit | undefined;
  body: Record<string, unknown>;
}

function fakeFetch(response: Response | (() => Response)): {
  fetch: typeof globalThis.fetch;
  calls: FakeCall[];
} {
  const calls: FakeCall[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      init,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : {},
    });
    return typeof response === "function" ? response() : response;
  }) as unknown as typeof globalThis.fetch;
  return { fetch: fetchImpl, calls };
}

function streamingResponse(chunks: string[]): Response {
  return new Response(bodyOf(chunks), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

const PROMPT: BuiltPrompt = {
  system: "You are an author.",
  messages: [{ role: "user", content: "Ridge: Hello." }],
  prefill: "She said,",
  outlets: {},
  debug: {
    mode: "single_character",
    tokensAreEstimated: true,
    tokenizerId: "estimate",
    budget: 8000,
    reservedForResponse: 700,
    available: 7300,
    fixedTokens: 10,
    historyTokens: 5,
    totalTokens: 15,
    headroom: 7285,
    blocks: [],
    evicted: [],
    historyIncluded: [],
    unresolvedOutlets: [],
    unknownMacros: [],
    // A side call's prompt has no lore to explain.
    loreTrace: [],
    // A side call's prompt recalls no documents.
    retrievedChunks: [],
  },
};

function adapterWith(fetchImpl: typeof globalThis.fetch, overrides = {}) {
  return createAnthropicAdapter({
    baseUrl: "https://api.anthropic.com",
    apiKey: "sk-ant-test",
    model: "claude-opus-5",
    fetch: fetchImpl,
    ...overrides,
  });
}

async function collect(
  adapter: ReturnType<typeof createAnthropicAdapter>,
  signal?: AbortSignal,
): Promise<{ text: string; reasoning: string }> {
  let text = "";
  let reasoning = "";
  for await (const chunk of adapter.generate(
    PROMPT,
    MODERN_SAMPLER_DEFAULTS,
    signal ?? new AbortController().signal,
  )) {
    text += chunk.text;
    reasoning += chunk.reasoning ?? "";
  }
  return { text, reasoning };
}

describe("reading a model id", () => {
  test("both naming schemes, and the ones that are neither", () => {
    expect(anthropicModelVersion("claude-opus-5")).toBe(5);
    expect(anthropicModelVersion("claude-sonnet-5")).toBe(5);
    expect(anthropicModelVersion("claude-opus-4-8")).toBe(4.8);
    expect(anthropicModelVersion("claude-haiku-4-5")).toBe(4.5);
    expect(anthropicModelVersion("claude-fable-5")).toBe(5);
    // The older scheme puts the generation first.
    expect(anthropicModelVersion("claude-3-5-sonnet-20241022")).toBe(3.5);
    expect(anthropicModelVersion("claude-3-opus-20240229")).toBe(3);
    // A proxy's own naming, which is common in this ecosystem.
    expect(anthropicModelVersion("my-proxy/claude")).toBeNull();
    expect(anthropicModelVersion("")).toBeNull();
  });

  test("4.6 is the line where samplers and prefill were removed", () => {
    expect(anthropicModelRules("claude-haiku-4-5").acceptsSamplingParams).toBe(true);
    expect(anthropicModelRules("claude-haiku-4-5").acceptsPrefill).toBe(true);
    expect(anthropicModelRules("claude-sonnet-4-6").acceptsSamplingParams).toBe(false);
    expect(anthropicModelRules("claude-opus-5").acceptsPrefill).toBe(false);
  });

  test("an unrecognised model takes the narrower contract", () => {
    // The two failure directions are not symmetric. Sending a sampler a model
    // rejects fails the generation with a 400; not sending one costs a knob and
    // still writes the turn.
    const rules = anthropicModelRules("some-proxy-model");
    expect(rules.acceptsSamplingParams).toBe(false);
    expect(rules.acceptsPrefill).toBe(false);
  });

  test("capabilities follow the model, not the provider kind", () => {
    expect(anthropicCapabilities("claude-opus-5").supportedSamplers).toEqual([]);
    expect(anthropicCapabilities("claude-3-5-sonnet-20241022").supportedSamplers).toEqual([
      "temperature",
      "top_p",
      "top_k",
    ]);
    // Never the local-inference samplers: this API has never had them.
    expect(anthropicCapabilities("claude-3-opus-20240229").supportedSamplers).not.toContain("min_p");
  });
});

describe("the request", () => {
  test("system is its own parameter, not a message", async () => {
    const { fetch, calls } = fakeFetch(() => streamingResponse([MESSAGE_START, MESSAGE_STOP]));
    await collect(adapterWith(fetch));
    expect(calls[0]!.body["system"]).toBe("You are an author.");
    expect(calls[0]!.body["messages"]).toEqual([{ role: "user", content: "Ridge: Hello." }]);
  });

  test("carries the version header and the key as x-api-key", async () => {
    const { fetch, calls } = fakeFetch(() => streamingResponse([MESSAGE_STOP]));
    await collect(adapterWith(fetch));
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    // Not a bearer token: this API does not read Authorization.
    expect(headers["Authorization"]).toBeUndefined();
    expect(calls[0]!.url).toBe("https://api.anthropic.com/v1/messages");
  });

  test("a proxy with no key of its own is sent no key", async () => {
    const { fetch, calls } = fakeFetch(() => streamingResponse([MESSAGE_STOP]));
    await collect(adapterWith(fetch, { apiKey: null }));
    expect((calls[0]!.init!.headers as Record<string, string>)["x-api-key"]).toBeUndefined();
  });

  test("max_tokens is required, and comes from what the builder reserved", async () => {
    const { fetch, calls } = fakeFetch(() => streamingResponse([MESSAGE_STOP]));
    await collect(adapterWith(fetch));
    expect(calls[0]!.body["max_tokens"]).toBe(700);
  });

  test("a side call that reserved nothing still gets a legal max_tokens", async () => {
    // §7's classifier and the guide runners reserve zero, because on every
    // other provider the response budget is advisory. Here zero is a 400.
    const { fetch, calls } = fakeFetch(() => streamingResponse([MESSAGE_STOP]));
    const adapter = adapterWith(fetch);
    const zeroed: BuiltPrompt = {
      ...PROMPT,
      debug: { ...PROMPT.debug, reservedForResponse: 0 },
    };
    for await (const _ of adapter.generate(
      zeroed,
      MODERN_SAMPLER_DEFAULTS,
      new AbortController().signal,
    )) {
      /* drain */
    }
    expect(calls[0]!.body["max_tokens"]).toBe(1024);
  });

  test("no samplers reach a current model", async () => {
    const { fetch, calls } = fakeFetch(() => streamingResponse([MESSAGE_STOP]));
    await collect(adapterWith(fetch, { model: "claude-opus-5" }));
    expect(calls[0]!.body["temperature"]).toBeUndefined();
    expect(calls[0]!.body["top_p"]).toBeUndefined();
    expect(calls[0]!.body["top_k"]).toBeUndefined();
  });

  test("samplers reach a model old enough to accept them", async () => {
    const { fetch, calls } = fakeFetch(() => streamingResponse([MESSAGE_STOP]));
    await collect(adapterWith(fetch, { model: "claude-3-5-sonnet-20241022" }));
    expect(calls[0]!.body["temperature"]).toBe(MODERN_SAMPLER_DEFAULTS.temperature);
    // min-P is a local-inference sampler; it has never existed on this API and
    // must not be smuggled through with the ones that do.
    expect(calls[0]!.body["min_p"]).toBeUndefined();
  });

  test("no prefill on a current model, even when the prompt carries one", async () => {
    const { fetch, calls } = fakeFetch(() => streamingResponse([MESSAGE_STOP]));
    await collect(adapterWith(fetch, { model: "claude-opus-5" }));
    expect(calls[0]!.body["messages"]).toEqual([{ role: "user", content: "Ridge: Hello." }]);
  });

  test("prefill on a model that still takes one", async () => {
    const { fetch, calls } = fakeFetch(() => streamingResponse([MESSAGE_STOP]));
    await collect(adapterWith(fetch, { model: "claude-3-5-sonnet-20241022" }));
    expect(calls[0]!.body["messages"]).toEqual([
      { role: "user", content: "Ridge: Hello." },
      { role: "assistant", content: "She said," },
    ]);
  });

  test("thinking asks for the summary, or the strip has nothing to show", async () => {
    const { fetch, calls } = fakeFetch(() => streamingResponse([MESSAGE_STOP]));
    await collect(adapterWith(fetch));
    expect(calls[0]!.body["thinking"]).toEqual({ type: "adaptive", display: "summarized" });
  });

  test("an operator override reopens prefill on a proxy", async () => {
    const { fetch, calls } = fakeFetch(() => streamingResponse([MESSAGE_STOP]));
    await collect(adapterWith(fetch, { model: "house-blend", supportsPrefill: true }));
    expect((calls[0]!.body["messages"] as unknown[]).length).toBe(2);
  });
});

describe("the stream", () => {
  test("text and thinking arrive on separate channels", async () => {
    const { fetch } = fakeFetch(() =>
      streamingResponse([
        MESSAGE_START,
        thinkingDelta("She is angry, "),
        thinkingDelta("but hiding it."),
        textDelta("She said, "),
        textDelta("nothing at all."),
        MESSAGE_STOP,
      ]),
    );
    const out = await collect(adapterWith(fetch));
    // §13: the model's planning is not the scene.
    expect(out.text).toBe("She said, nothing at all.");
    expect(out.reasoning).toBe("She is angry, but hiding it.");
  });

  test("message_stop ends it", async () => {
    const { fetch } = fakeFetch(() =>
      streamingResponse([textDelta("One."), MESSAGE_STOP, textDelta(" Two.")]),
    );
    expect((await collect(adapterWith(fetch))).text).toBe("One.");
  });

  test("an error arrives as an event inside a 200, not as a status", async () => {
    const { fetch } = fakeFetch(() =>
      streamingResponse([
        MESSAGE_START,
        textDelta("She "),
        `event: error\ndata: ${JSON.stringify({
          type: "error",
          error: { type: "overloaded_error", message: "Overloaded" },
        })}\n\n`,
      ]),
    );
    await expect(collect(adapterWith(fetch))).rejects.toThrow(AdapterError);
  });

  test("an overload mid-stream is worth retrying; a bad request is not", async () => {
    const { fetch } = fakeFetch(() =>
      streamingResponse([
        `event: error\ndata: ${JSON.stringify({
          type: "error",
          error: { type: "overloaded_error", message: "Overloaded" },
        })}\n\n`,
      ]),
    );
    try {
      await collect(adapterWith(fetch));
      throw new Error("expected a failure");
    } catch (caught) {
      expect(caught).toBeInstanceOf(AdapterError);
      expect((caught as AdapterError).retryable).toBe(true);
    }
  });

  test("a malformed frame loses a token rather than the turn", async () => {
    const { fetch } = fakeFetch(() =>
      streamingResponse([textDelta("One."), "data: {not json\n\n", textDelta(" Two."), MESSAGE_STOP]),
    );
    expect((await collect(adapterWith(fetch))).text).toBe("One. Two.");
  });
});

describe("failures", () => {
  test("the provider's own message is surfaced, not just the status", async () => {
    const { fetch } = fakeFetch(
      () =>
        new Response(
          JSON.stringify({
            type: "error",
            error: { type: "invalid_request_error", message: "max_tokens: must be > 0" },
          }),
          { status: 400 },
        ),
    );
    try {
      await collect(adapterWith(fetch));
      throw new Error("expected a failure");
    } catch (caught) {
      expect(caught).toBeInstanceOf(AdapterError);
      expect((caught as AdapterError).providerMessage).toBe("max_tokens: must be > 0");
      expect((caught as AdapterError).retryable).toBe(false);
    }
  });

  test("429 and 529 are retryable; 401 is not", async () => {
    for (const [status, retryable] of [
      [429, true],
      [529, true],
      [401, false],
    ] as const) {
      const { fetch } = fakeFetch(() => new Response("{}", { status }));
      try {
        await collect(adapterWith(fetch));
        throw new Error("expected a failure");
      } catch (caught) {
        expect((caught as AdapterError).retryable).toBe(retryable);
      }
    }
  });
});

describe("abort", () => {
  test("the signal reaches the upstream request", async () => {
    // SPEC §4 is explicit: an abandoned generation that keeps streaming is
    // still being billed.
    const controller = new AbortController();
    const { fetch, calls } = fakeFetch(() => streamingResponse([MESSAGE_STOP]));
    await collect(adapterWith(fetch), controller.signal);
    expect(calls[0]!.init!.signal).toBe(controller.signal);
  });

  test("an abort mid-flight ends quietly rather than throwing", async () => {
    const controller = new AbortController();
    const fetchImpl = (async () => {
      controller.abort();
      throw new Error("aborted");
    }) as unknown as typeof globalThis.fetch;
    expect((await collect(adapterWith(fetchImpl), controller.signal)).text).toBe("");
  });
});

describe("listing models", () => {
  test("this API reports the window as max_input_tokens", async () => {
    const { fetch } = fakeFetch(
      () =>
        new Response(
          JSON.stringify({ data: [{ id: "claude-opus-5", max_input_tokens: 1_000_000 }] }),
          { status: 200 },
        ),
    );
    expect(await adapterWith(fetch).listModels!()).toEqual([
      { id: "claude-opus-5", contextLength: 1_000_000 },
    ]);
  });
});
