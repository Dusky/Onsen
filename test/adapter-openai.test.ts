import { describe, expect, test } from "bun:test";
import { createOpenAiAdapter } from "../server/adapters/openai.ts";
import { parseSseStream } from "../server/adapters/sse.ts";
import { AdapterError } from "../server/adapters/types.ts";
import type { BuiltPrompt } from "../server/prompt/index.ts";
import { MODERN_SAMPLER_DEFAULTS } from "../shared/types.ts";

/**
 * The OpenAI-compatible adapter, against recorded fixtures rather than live
 * APIs (SPEC §23). Abort propagation is tested explicitly, because a leaked
 * generation pins a GPU on a local backend (§4).
 */

/** Turn a list of byte-chunks into a response body, exactly as the wire would. */
function bodyOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function delta(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
}

interface FakeCall {
  url: string;
  init: RequestInit | undefined;
  body: Record<string, unknown>;
}

/** A fetch that replays a fixture and records what it was asked for. */
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
  outlets: {},
  debug: {
    mode: "single_character",
    tokensAreEstimated: true,
    tokenizerId: "estimate",
    budget: 8000,
    reservedForResponse: 200,
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
    // A side call's prompt has no lore to explain.
    loreTrace: [],
  },
};

function adapterWith(fetchImpl: typeof globalThis.fetch, overrides = {}) {
  return createOpenAiAdapter({
    baseUrl: "http://localhost:8080/v1",
    apiKey: "sk-test",
    model: "test-model",
    fetch: fetchImpl,
    ...overrides,
  });
}

async function collect(adapter: ReturnType<typeof createOpenAiAdapter>, signal?: AbortSignal) {
  const out: string[] = [];
  for await (const chunk of adapter.generate(
    PROMPT,
    MODERN_SAMPLER_DEFAULTS,
    signal ?? new AbortController().signal,
  )) {
    out.push(chunk.text);
  }
  return out;
}

describe("SSE parsing", () => {
  test("reads events split arbitrarily across network chunks", async () => {
    // The failure this guards: one data line arriving in two reads. A parser
    // that assumes chunk boundaries are line boundaries drops tokens exactly
    // when the network is bad.
    const events = [];
    for await (const event of parseSseStream(
      bodyOf(['data: {"a"', ':1}\n', "\ndata: ", '{"b":2}\n\n']),
    )) {
      events.push(event.data);
    }
    expect(events).toEqual(['{"a":1}', '{"b":2}']);
  });

  test("reads several events arriving in one chunk", async () => {
    const events = [];
    for await (const event of parseSseStream(bodyOf(["data: one\n\ndata: two\n\ndata: three\n\n"]))) {
      events.push(event.data);
    }
    expect(events).toEqual(["one", "two", "three"]);
  });

  test("accepts CRLF line endings, which proxies introduce", async () => {
    const events = [];
    for await (const event of parseSseStream(bodyOf(["data: one\r\n\r\ndata: two\r\n\r\n"]))) {
      events.push(event.data);
    }
    expect(events).toEqual(["one", "two"]);
  });

  test("ignores heartbeat comments", async () => {
    const events = [];
    for await (const event of parseSseStream(bodyOf([": heartbeat\n\ndata: real\n\n"]))) {
      events.push(event.data);
    }
    expect(events).toEqual(["real"]);
  });

  test("joins multi-line data and reads the event name", async () => {
    const events = [];
    for await (const event of parseSseStream(bodyOf(["event: chunk\ndata: one\ndata: two\n\n"]))) {
      events.push(event);
    }
    expect(events).toEqual([{ event: "chunk", data: "one\ntwo" }]);
  });

  test("emits a trailing event that arrived without a closing blank line", async () => {
    const events = [];
    for await (const event of parseSseStream(bodyOf(["data: last"]))) events.push(event.data);
    expect(events).toEqual(["last"]);
  });

  test("strips exactly one leading space after the colon", async () => {
    const events = [];
    for await (const event of parseSseStream(bodyOf(["data:  two spaces\n\ndata:none\n\n"]))) {
      events.push(event.data);
    }
    expect(events).toEqual([" two spaces", "none"]);
  });
});

describe("streaming a completion", () => {
  test("yields the deltas in order and stops at [DONE]", async () => {
    const { fetch } = fakeFetch(
      streamingResponse([delta("Bell "), delta("looks "), delta("up."), "data: [DONE]\n\n"]),
    );
    expect(await collect(adapterWith(fetch))).toEqual(["Bell ", "looks ", "up."]);
  });

  test("ignores empty deltas, which providers send as keepalives", async () => {
    const { fetch } = fakeFetch(
      streamingResponse([delta(""), delta("real"), 'data: {"choices":[{"delta":{}}]}\n\n']),
    );
    expect(await collect(adapterWith(fetch))).toEqual(["real"]);
  });

  test("skips a malformed frame rather than failing the whole turn", async () => {
    // Losing one token beats losing the message the user watched arrive.
    const { fetch } = fakeFetch(
      streamingResponse([delta("before "), "data: {not json\n\n", delta("after")]),
    );
    expect(await collect(adapterWith(fetch))).toEqual(["before ", "after"]);
  });

  test("raises an error frame sent mid-stream", async () => {
    const { fetch } = fakeFetch(
      streamingResponse([delta("partial"), 'data: {"error":{"message":"context overflow"}}\n\n']),
    );
    const adapter = adapterWith(fetch);
    await expect(collect(adapter)).rejects.toThrow(/mid-stream/);

    try {
      await collect(adapter);
    } catch (caught) {
      expect((caught as AdapterError).providerMessage).toBe("context overflow");
    }
  });
});

describe("the request", () => {
  test("sends the system prompt as a system message and the rest in order", async () => {
    const { fetch, calls } = fakeFetch(streamingResponse(["data: [DONE]\n\n"]));
    await collect(adapterWith(fetch));

    expect(calls[0]!.url).toBe("http://localhost:8080/v1/chat/completions");
    expect(calls[0]!.body["messages"]).toEqual([
      { role: "system", content: "You are an author." },
      { role: "user", content: "Ridge: Hello." },
    ]);
    expect(calls[0]!.body["stream"]).toBe(true);
    expect(calls[0]!.body["model"]).toBe("test-model");
  });

  test("passes the modern samplers through, including the ones local shims add", async () => {
    const { fetch, calls } = fakeFetch(streamingResponse(["data: [DONE]\n\n"]));
    await collect(adapterWith(fetch));

    // SPEC §13's defaults are only worth having if they reach the backend.
    expect(calls[0]!.body).toMatchObject({
      temperature: 1,
      min_p: 0.05,
      repetition_penalty: 1,
      dry_multiplier: 0.8,
      dry_base: 1.75,
      dry_allowed_length: 2,
      xtc_threshold: 0.1,
      xtc_probability: 0.5,
    });
    expect(calls[0]!.body["dry_sequence_breakers"]).toEqual(["\n", ":", '"', "*"]);
  });

  test("omits samplers that were not set rather than sending nulls", async () => {
    const { fetch, calls } = fakeFetch(streamingResponse(["data: [DONE]\n\n"]));
    const adapter = adapterWith(fetch);
    for await (const _ of adapter.generate(PROMPT, { temperature: 0.8 }, new AbortController().signal)) {
      /* drain */
    }
    expect(calls[0]!.body["temperature"]).toBe(0.8);
    expect("top_p" in calls[0]!.body).toBe(false);
    expect("min_p" in calls[0]!.body).toBe(false);
  });

  test("sends no Authorization header when there is no key, as local servers require", async () => {
    const { fetch, calls } = fakeFetch(streamingResponse(["data: [DONE]\n\n"]));
    await collect(adapterWith(fetch, { apiKey: null }));
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect("Authorization" in headers).toBe(false);

    const keyed = fakeFetch(streamingResponse(["data: [DONE]\n\n"]));
    await collect(adapterWith(keyed.fetch));
    expect((keyed.calls[0]!.init!.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer sk-test",
    );
  });

  test("joins the base URL without doubling or dropping a slash", async () => {
    for (const baseUrl of ["http://x/v1", "http://x/v1/"]) {
      const { fetch, calls } = fakeFetch(streamingResponse(["data: [DONE]\n\n"]));
      await collect(adapterWith(fetch, { baseUrl }));
      expect(calls[0]!.url).toBe("http://x/v1/chat/completions");
    }
  });
});

describe("failures", () => {
  test("reports the provider's own message, not just a status code", async () => {
    const { fetch } = fakeFetch(
      new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 401 }),
    );
    try {
      await collect(adapterWith(fetch));
      throw new Error("should have thrown");
    } catch (caught) {
      const error = caught as AdapterError;
      expect(error).toBeInstanceOf(AdapterError);
      expect(error.status).toBe(401);
      expect(error.providerMessage).toBe("invalid api key");
      expect(error.retryable).toBe(false);
    }
  });

  test("marks overload and server errors retryable, and client errors not", async () => {
    for (const [status, retryable] of [
      [429, true],
      [500, true],
      [503, true],
      [400, false],
      [404, false],
    ] as const) {
      const { fetch } = fakeFetch(new Response("nope", { status }));
      try {
        await collect(adapterWith(fetch));
        throw new Error(`expected ${status} to throw`);
      } catch (caught) {
        expect((caught as AdapterError).retryable).toBe(retryable);
      }
    }
  });

  test("reports an unreachable provider as retryable", async () => {
    const failing = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof globalThis.fetch;
    try {
      await collect(adapterWith(failing));
      throw new Error("should have thrown");
    } catch (caught) {
      const error = caught as AdapterError;
      expect(error.message).toContain("Could not reach");
      expect(error.providerMessage).toBe("ECONNREFUSED");
      expect(error.retryable).toBe(true);
    }
  });

  test("a body-less 200 is an error, not silence", async () => {
    const { fetch } = fakeFetch(new Response(null, { status: 200 }));
    await expect(collect(adapterWith(fetch))).rejects.toThrow(/no response body/);
  });
});

describe("abort propagation", () => {
  test("passes the signal to fetch so inference actually stops upstream", async () => {
    // SPEC §4 is explicit about this: a leaked generation pins a GPU.
    const { fetch, calls } = fakeFetch(streamingResponse(["data: [DONE]\n\n"]));
    const controller = new AbortController();
    await collect(adapterWith(fetch), controller.signal);
    expect(calls[0]!.init!.signal).toBe(controller.signal);
  });

  test("stops yielding once aborted mid-stream", async () => {
    const encoder = new TextEncoder();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(delta("one")));
        controller.enqueue(encoder.encode(delta("two")));
        controller.enqueue(encoder.encode(delta("three")));
      },
      cancel() {
        cancelled = true;
      },
    });

    const { fetch } = fakeFetch(new Response(body, { status: 200 }));
    const controller = new AbortController();
    const received: string[] = [];

    for await (const chunk of adapterWith(fetch).generate(
      PROMPT,
      MODERN_SAMPLER_DEFAULTS,
      controller.signal,
    )) {
      received.push(chunk.text);
      if (received.length === 2) controller.abort();
    }

    expect(received).toEqual(["one", "two"]);
    // Aborting must release the upstream body, not just stop reading from it.
    expect(cancelled).toBe(true);
  });

  test("an abort before dispatch ends quietly rather than throwing", async () => {
    const failing = (async () => {
      throw new Error("aborted");
    }) as unknown as typeof globalThis.fetch;
    const controller = new AbortController();
    controller.abort();
    expect(await collect(adapterWith(failing), controller.signal)).toEqual([]);
  });
});

describe("listing models", () => {
  test("returns ids and context lengths where the provider reports them", async () => {
    const { fetch, calls } = fakeFetch(
      new Response(
        JSON.stringify({
          data: [
            { id: "llama-3.3-70b", context_length: 32768 },
            { id: "mistral-small" },
            { missing: "id" },
          ],
        }),
        { status: 200 },
      ),
    );
    const models = await adapterWith(fetch).listModels!();
    expect(calls[0]!.url).toBe("http://localhost:8080/v1/models");
    expect(models).toEqual([
      { id: "llama-3.3-70b", contextLength: 32768 },
      { id: "mistral-small" },
    ]);
  });

  test("raises a useful error when listing fails", async () => {
    const { fetch } = fakeFetch(new Response("denied", { status: 403 }));
    await expect(adapterWith(fetch).listModels!()).rejects.toThrow(/Could not list models/);
  });
});
