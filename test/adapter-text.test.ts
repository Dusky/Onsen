import { describe, expect, test } from "bun:test";
import { createTextCompletionAdapter } from "../server/adapters/text.ts";
import type { BuiltPrompt } from "../server/prompt/index.ts";
import { MODERN_SAMPLER_DEFAULTS } from "../shared/types.ts";

/**
 * The text-completion adapter's request shape, against recorded fixtures
 * rather than a live server (SPEC §23). The response cap has to reach this
 * wire format too: it is the same `max_response_tokens` that auto-continue
 * reads a `length` finish for, and a cap the builder reserved but this adapter
 * never sent would make the feature dead on local backends exactly as it was
 * on the OpenAI-compatible one.
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

function streamingResponse(chunks: string[]): Response {
  return new Response(bodyOf(chunks), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

interface FakeCall {
  url: string;
  body: Record<string, unknown>;
}

function fakeFetch(): {
  fetch: typeof globalThis.fetch;
  calls: FakeCall[];
} {
  const calls: FakeCall[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : {},
    });
    return streamingResponse(["data: [DONE]\n\n"]);
  }) as unknown as typeof globalThis.fetch;
  return { fetch: fetchImpl, calls };
}

function promptWith(reservedForResponse: number): BuiltPrompt {
  return {
    rawText: "The author's assembled prompt, in text mode.",
    messages: [],
    outlets: {},
    debug: {
      mode: "author",
      tokensAreEstimated: true,
      tokenizerId: "estimate",
      budget: 8000,
      reservedForResponse,
      available: 7800,
      fixedTokens: 10,
      historyTokens: 5,
      totalTokens: 15,
      headroom: 7785,
      blocks: [],
      evicted: [],
      historyIncluded: [],
      unresolvedOutlets: [],
      unknownMacros: [],
      loreTrace: [],
      retrievedChunks: [],
      memoryTrace: [],
    },
  };
}

function adapterWith(fetchImpl: typeof globalThis.fetch) {
  return createTextCompletionAdapter({
    baseUrl: "http://localhost:8080/v1",
    apiKey: null,
    model: "test-model",
    fetch: fetchImpl,
  });
}

async function drain(adapter: ReturnType<typeof createTextCompletionAdapter>, prompt: BuiltPrompt) {
  for await (const _ of adapter.generate(prompt, MODERN_SAMPLER_DEFAULTS, new AbortController().signal)) {
    /* drain */
  }
}

describe("the text-completion request", () => {
  test("sends the raw prompt and marks the stream", async () => {
    const { fetch, calls } = fakeFetch();
    await drain(adapterWith(fetch), promptWith(200));

    expect(calls[0]!.url).toBe("http://localhost:8080/v1/completions");
    expect(calls[0]!.body["prompt"]).toBe("The author's assembled prompt, in text mode.");
    expect(calls[0]!.body["stream"]).toBe(true);
    expect(calls[0]!.body["model"]).toBe("test-model");
  });

  test("sends max_tokens from what the builder reserved", async () => {
    const { fetch, calls } = fakeFetch();
    await drain(adapterWith(fetch), promptWith(200));

    expect(calls[0]!.body["max_tokens"]).toBe(200);
  });

  test("omits max_tokens when nothing was reserved, as on a side call", async () => {
    const { fetch, calls } = fakeFetch();
    await drain(adapterWith(fetch), promptWith(0));

    expect("max_tokens" in calls[0]!.body).toBe(false);
  });
});
