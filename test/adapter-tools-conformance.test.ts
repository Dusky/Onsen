import { describe, expect, test } from "bun:test";
import { PROVIDER_KINDS } from "../shared/types.ts";
import type { ProviderKind } from "../shared/types.ts";
import { capabilitiesFor, createAdapter } from "../server/adapters/index.ts";
import type { BuiltPrompt, ToolCall } from "../server/prompt/index.ts";
import { MODERN_SAMPLER_DEFAULTS } from "../shared/types.ts";

/**
 * Tools behave the same whichever provider is behind them (SPEC §4, §20 phase 48).
 *
 * The point of this file is the *shared* assertion. Each provider's wire shape
 * is its own — OpenAI streams `tool_calls` fragments with an index, Anthropic
 * streams `tool_use` content blocks and `input_json_delta` — and translating
 * that is each adapter's private business. What must not vary is what comes out
 * the other side: one complete call, with an id, a name, and arguments the
 * caller can `JSON.parse`.
 *
 * Phase 46 shipped tools on one provider and declared `supportsTools: false` on
 * the rest, which meant the assistant only worked if you happened to have
 * pointed Onsen at an OpenAI-compatible endpoint. That is the wrong shape for
 * an app whose whole premise is bring-your-own-backend, and a per-provider test
 * file is how it stayed invisible: each one passed on its own terms.
 */

/** The same logical stream, in each provider's own dialect. */
interface Dialect {
  kind: ProviderKind;
  model: string;
  /** Text, then a call to `list_characters({"limit":5})` split across frames. */
  frames: string[];
  /** The same, with the stream closing instead of saying it is done. */
  truncated: string[];
  /** Where the tool definitions land in the request body. */
  toolsIn(body: Record<string, unknown>): unknown;
  /**
   * A stream that ran out of room, in this dialect's own words (§20 phase 63).
   *
   * Every provider has a different one — `length`, `max_tokens` — and the one
   * thing that reads it, auto-continue, branches on the normalised value. An
   * adapter that dropped this would leave a preset's setting quietly doing
   * nothing, which is not a failure any generation test would see.
   */
  capped: string[];
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const OPENAI_CALL = [
  sse("m", {
    choices: [
      {
        delta: {
          tool_calls: [
            { index: 0, id: "call_01", function: { name: "list_characters", arguments: '{"li' } },
          ],
        },
      },
    ],
  }),
  sse("m", {
    choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'mit": 5}' } }] } }],
  }),
];

const ANTHROPIC_CALL = [
  sse("content_block_start", {
    type: "content_block_start",
    index: 1,
    content_block: { type: "tool_use", id: "call_01", name: "list_characters" },
  }),
  sse("content_block_delta", {
    type: "content_block_delta",
    index: 1,
    delta: { type: "input_json_delta", partial_json: '{"li' },
  }),
  sse("content_block_delta", {
    type: "content_block_delta",
    index: 1,
    delta: { type: "input_json_delta", partial_json: 'mit": 5}' },
  }),
];

const DIALECTS: Dialect[] = [
  {
    kind: "openai_compatible",
    model: "gpt-oss-120b",
    frames: [
      sse("m", { choices: [{ delta: { content: "Let me look." } }] }),
      ...OPENAI_CALL,
      "data: [DONE]\n\n",
    ],
    truncated: [sse("m", { choices: [{ delta: { content: "Let me look." } }] }), ...OPENAI_CALL],
    toolsIn: (body) => body["tools"],
    capped: [
      sse("m", { choices: [{ delta: { content: "Cut off mid-" } }] }),
      sse("m", { choices: [{ delta: {}, finish_reason: "length" }] }),
      "data: [DONE]\n\n",
    ],
  },
  {
    kind: "anthropic",
    model: "claude-opus-5",
    frames: [
      sse("message_start", { type: "message_start", message: {} }),
      sse("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Let me look." },
      }),
      ...ANTHROPIC_CALL,
      sse("message_stop", { type: "message_stop" }),
    ],
    truncated: [
      sse("message_start", { type: "message_start", message: {} }),
      sse("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Let me look." },
      }),
      ...ANTHROPIC_CALL,
    ],
    toolsIn: (body) => body["tools"],
    capped: [
      sse("message_start", { type: "message_start", message: {} }),
      sse("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Cut off mid-" },
      }),
      sse("message_delta", { type: "message_delta", delta: { stop_reason: "max_tokens" } }),
      sse("message_stop", { type: "message_stop" }),
    ],
  },
];

const PROMPT: BuiltPrompt = {
  system: "You are the assistant inside Onsen.",
  messages: [{ role: "user", content: "How many characters do I have?" }],
  tools: [
    {
      name: "list_characters",
      description: "Every character in this install, newest first.",
      parameters: { type: "object", properties: { limit: { type: "number" } } },
    },
  ],
  outlets: {},
  debug: {
    mode: "author",
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
    loreTrace: [],
    retrievedChunks: [],
    memoryTrace: [],
  },
};

function responder(frames: string[]): {
  fetch: typeof globalThis.fetch;
  bodies: Record<string, unknown>[];
} {
  const bodies: Record<string, unknown>[] = [];
  const encoder = new TextEncoder();
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(typeof init?.body === "string" ? JSON.parse(init.body) : {});
    return new Response(
      new ReadableStream({
        start(controller) {
          for (const frame of frames) controller.enqueue(encoder.encode(frame));
          controller.close();
        },
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
  }) as unknown as typeof globalThis.fetch;
  return { fetch: fetchImpl, bodies };
}

async function run(dialect: Dialect, frames: string[]) {
  const { fetch, bodies } = responder(frames);
  const adapter = createAdapter(dialect.kind, {
    baseUrl: "https://example.invalid",
    apiKey: "k",
    model: dialect.model,
    fetch,
  });
  let text = "";
  let finishReason: string | null = null;
  const calls: ToolCall[] = [];
  for await (const chunk of adapter.generate(
    PROMPT,
    MODERN_SAMPLER_DEFAULTS,
    new AbortController().signal,
  )) {
    text += chunk.text;
    if (chunk.finishReason !== undefined) finishReason = chunk.finishReason;
    for (const call of chunk.toolCalls ?? []) calls.push(call);
  }
  return { text, calls, finishReason, body: bodies[0]! };
}

describe("every tool-capable provider", () => {
  test("is covered here", () => {
    /*
     * The guard that makes the rest of this file mean something. A new adapter
     * that declares `supportsTools` and is not in DIALECTS would otherwise ship
     * with no conformance check at all — which is exactly how the assistant
     * came to work on one provider out of three.
     */
    const claiming = PROVIDER_KINDS.filter((kind) => capabilitiesFor(kind).supportsTools);
    expect(claiming.sort()).toEqual(DIALECTS.map((d) => d.kind).sort());
  });

  for (const dialect of DIALECTS) {
    describe(dialect.kind, () => {
      test("sends the tool definitions", async () => {
        const { body } = await run(dialect, dialect.frames);
        expect(dialect.toolsIn(body)).toBeDefined();
        expect(JSON.stringify(dialect.toolsIn(body))).toContain("list_characters");
      });

      test("yields one whole call with parseable arguments", async () => {
        const { text, calls } = await run(dialect, dialect.frames);
        expect(text).toBe("Let me look.");
        expect(calls).toHaveLength(1);
        expect(calls[0]!.id).toBe("call_01");
        expect(calls[0]!.name).toBe("list_characters");
        expect(JSON.parse(calls[0]!.arguments)).toEqual({ limit: 5 });
      });

      test("reports why the completion stopped, in our words", async () => {
        const capped = await run(dialect, dialect.capped);
        expect(capped.text).toBe("Cut off mid-");
        expect(capped.finishReason).toBe("length");

        // And a normal end is not a cap: auto-continue branches on `length`,
        // so an adapter that reported it for everything would continue every
        // turn forever.
        const normal = await run(dialect, dialect.frames);
        expect(normal.finishReason).not.toBe("length");
      });

      test("delivers the call even if the stream just closes", async () => {
        // Providers differ on whether they send a terminator. Losing the call
        // when they do not is the phase 46 bug, and it is provider-shaped, so
        // it belongs in the shared suite rather than in one adapter's file.
        const { calls } = await run(dialect, dialect.truncated);
        expect(calls).toHaveLength(1);
        expect(JSON.parse(calls[0]!.arguments)).toEqual({ limit: 5 });
      });
    });
  }
});

describe("a provider that cannot use tools", () => {
  test("says so rather than accepting them silently", () => {
    // Text completion has nowhere structured to put a call. Declaring false is
    // the honest answer, and the agent loop refuses on it rather than sending
    // tools that will be ignored.
    expect(capabilitiesFor("text_completion").supportsTools).toBe(false);
  });
});
