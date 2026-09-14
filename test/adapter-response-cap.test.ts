import { describe, expect, test } from "bun:test";
import { PROVIDER_KINDS } from "../shared/types.ts";
import { createAdapter } from "../server/adapters/index.ts";
import type { BuiltPrompt } from "../server/prompt/index.ts";
import { MODERN_SAMPLER_DEFAULTS } from "../shared/types.ts";

/**
 * The response cap reaches every wire format (SPEC §13.6, phase ~196).
 *
 * `max_response_tokens` is the number the prompt is fitted around, and it is
 * the number auto-continue's trigger depends on: a turn has to *stop at the
 * cap* for the provider to report `length`, and a cap the builder reserved but
 * an adapter never sent is a shipped feature doing nothing. Two of the three
 * adapters shipped without it — the OpenAI-compatible one and the text one —
 * and each per-adapter test passed on its own terms, which is exactly how it
 * stayed invisible.
 *
 * The same shape as the tools conformance file: the guard at the top lists
 * every kind, so the next adapter cannot ship without a cap.
 */

const PROMPT: BuiltPrompt = {
  system: "You are an author.",
  messages: [{ role: "user", content: "Ridge: Hello." }],
  // Text completion needs the rendered string; the chat adapters ignore it.
  rawText: "Ridge: Hello.",
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
    loreTrace: [],
    retrievedChunks: [],
    memoryTrace: [],
  },
};

describe("every adapter", () => {
  for (const kind of PROVIDER_KINDS) {
    describe(kind, () => {
      test("sends max_tokens from what the builder reserved", async () => {
        const bodies: Record<string, unknown>[] = [];
        const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
          bodies.push(typeof init?.body === "string" ? JSON.parse(init.body) : {});
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
                controller.close();
              },
            }),
            { status: 200, headers: { "Content-Type": "text/event-stream" } },
          );
        }) as unknown as typeof globalThis.fetch;

        const adapter = createAdapter(kind, {
          baseUrl: "https://example.invalid",
          apiKey: "k",
          model: "test-model",
          fetch: fetchImpl,
        });
        for await (const _ of adapter.generate(
          PROMPT,
          MODERN_SAMPLER_DEFAULTS,
          new AbortController().signal,
        )) {
          /* drain */
        }

        expect(bodies).toHaveLength(1);
        expect(bodies[0]!["max_tokens"]).toBe(200);
      });
    });
  }
});
