import { describe, expect, test } from "bun:test";
import {
  INSTRUCT_TEMPLATES,
  findInstructTemplate,
  parseInstructTemplate,
  renderInstruct,
} from "../server/prompt/instruct.ts";
import { createTextCompletionAdapter } from "../server/adapters/text.ts";
import { AdapterError } from "../server/adapters/types.ts";
import type { BuiltPrompt } from "../server/prompt/index.ts";
import { MODERN_SAMPLER_DEFAULTS } from "../shared/types.ts";

/**
 * Instruct templates and the text-completion adapter (SPEC §4, §20 phase 22).
 *
 * The thing worth testing is the exact string. A template that is nearly right
 * produces no error at all — it produces prose that drifts, repeats the user,
 * or never stops, which reads as a bad model rather than as a bug. So these
 * assert the rendered text character for character rather than checking that
 * the markers appear somewhere.
 */

const CONVERSATION = [
  { role: "user" as const, content: "Hello." },
  { role: "assistant" as const, content: "Hi." },
  { role: "user" as const, content: "Again." },
];

function render(id: string, system: string | undefined, prefill?: string): string {
  return renderInstruct(findInstructTemplate(id)!, system, CONVERSATION, prefill);
}

describe("the shipped templates", () => {
  test("ChatML", () => {
    expect(render("chatml", "Be brief.")).toBe(
      "<|im_start|>system\nBe brief.<|im_end|>\n" +
        "<|im_start|>user\nHello.<|im_end|>\n" +
        "<|im_start|>assistant\nHi.<|im_end|>\n" +
        "<|im_start|>user\nAgain.<|im_end|>\n" +
        "<|im_start|>assistant\n",
    );
  });

  test("Llama 3, including the one BOS token", () => {
    expect(render("llama3", "Be brief.")).toBe(
      "<|begin_of_text|>" +
        "<|start_header_id|>system<|end_header_id|>\n\nBe brief.<|eot_id|>" +
        "<|start_header_id|>user<|end_header_id|>\n\nHello.<|eot_id|>" +
        "<|start_header_id|>assistant<|end_header_id|>\n\nHi.<|eot_id|>" +
        "<|start_header_id|>user<|end_header_id|>\n\nAgain.<|eot_id|>" +
        "<|start_header_id|>assistant<|end_header_id|>\n\n",
    );
  });

  test("Mistral folds the system text into the first user turn", () => {
    // The format has no system turn. Putting one in anyway is the most common
    // way to get subtly worse prose out of a Mistral finetune.
    expect(render("mistral", "Be brief.")).toBe(
      "<s>" +
        "[INST] Be brief.\n\nHello. [/INST]" +
        "Hi.</s>" +
        "[INST] Again. [/INST]" +
        "",
    );
  });

  test("Alpaca", () => {
    expect(render("alpaca", "Be brief.")).toBe(
      "### Instruction:\nBe brief.\n\nHello.\n\n" +
        "### Response:\nHi.\n\n" +
        "### Instruction:\nAgain.\n\n" +
        "### Response:\n",
    );
  });

  test("Metharme", () => {
    expect(render("metharme", "Be brief.")).toBe(
      "<|system|>Be brief.<|user|>Hello.<|model|>Hi.<|user|>Again.<|model|>",
    );
  });

  test("every template ends on an open assistant turn", () => {
    // That is the entire point: the model continues from where the string
    // stops. A template that closed the turn would be asking for silence.
    for (const template of INSTRUCT_TEMPLATES) {
      const out = renderInstruct(template, "S", CONVERSATION, undefined);
      expect(out.endsWith(template.assistantPrefix)).toBe(true);
      // Only meaningful where the suffix is a marker rather than whitespace:
      // `plain` legitimately ends on the blank line its turns are separated by.
      if (template.assistantSuffix.trim() !== "") {
        expect(out.endsWith(template.assistantSuffix)).toBe(false);
      }
    }
  });

  test("a prefill goes inside the open turn", () => {
    expect(render("chatml", "Be brief.", "She said,").endsWith(
      "<|im_start|>assistant\nShe said,",
    )).toBe(true);
  });

  test("no system text leaves no empty wrapper behind", () => {
    expect(render("chatml", undefined)).toBe(
      "<|im_start|>user\nHello.<|im_end|>\n" +
        "<|im_start|>assistant\nHi.<|im_end|>\n" +
        "<|im_start|>user\nAgain.<|im_end|>\n" +
        "<|im_start|>assistant\n",
    );
  });

  test("system text survives a conversation with no user turn", () => {
    // A group scene can open on the author. The system text still has to land
    // somewhere, and a format with no system turn has only one place for it.
    const out = renderInstruct(findInstructTemplate("mistral")!, "Be brief.", [], undefined);
    expect(out).toContain("Be brief.");
  });

  test("every shipped template can stop a turn", () => {
    // `plain` is the deliberate exception: a base model has no turn markers, so
    // there is nothing to stop on.
    for (const template of INSTRUCT_TEMPLATES) {
      if (template.id === "plain") continue;
      expect(template.stopSequences.length).toBeGreaterThan(0);
    }
  });
});

describe("custom templates", () => {
  test("two markers are enough; the rest default to empty", () => {
    const template = parseInstructTemplate(
      { name: "Two markers", userPrefix: "H: ", assistantPrefix: "A: " },
      "two-markers",
    )!;
    expect(renderInstruct(template, undefined, CONVERSATION, undefined)).toBe(
      "H: Hello.A: Hi.H: Again.A: ",
    );
  });

  test("anything that is not an object is not a template", () => {
    expect(parseInstructTemplate("chatml", "x")).toBeNull();
    expect(parseInstructTemplate(null, "x")).toBeNull();
  });

  test("a stop list of the wrong type is dropped rather than trusted", () => {
    const template = parseInstructTemplate({ name: "N", stopSequences: [1, "ok", null] }, "n")!;
    expect(template.stopSequences).toEqual(["ok"]);
  });
});

/* ------------------------------------------------------------------ */
/* The adapter                                                         */
/* ------------------------------------------------------------------ */

function bodyOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function chunk(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ text }] })}\n\n`;
}

function fakeFetch(response: Response | (() => Response)) {
  const calls: { url: string; init: RequestInit | undefined; body: Record<string, unknown> }[] = [];
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
  messages: [{ role: "user", content: "Hello." }],
  rawText: "<|im_start|>user\nHello.<|im_end|>\n<|im_start|>assistant\n",
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
    // A side call's prompt recalls no documents.
    retrievedChunks: [],
    memoryTrace: [],
  },
};

function adapterWith(fetchImpl: typeof globalThis.fetch, overrides = {}) {
  return createTextCompletionAdapter({
    baseUrl: "http://localhost:8080/v1",
    apiKey: null,
    model: "local",
    fetch: fetchImpl,
    instruct: findInstructTemplate("chatml")!,
    ...overrides,
  });
}

async function collect(adapter: ReturnType<typeof createTextCompletionAdapter>) {
  let text = "";
  for await (const piece of adapter.generate(
    PROMPT,
    MODERN_SAMPLER_DEFAULTS,
    new AbortController().signal,
  )) {
    text += piece.text;
  }
  return text;
}

describe("the text-completion adapter", () => {
  test("sends the rendered prompt, not a message array", async () => {
    const { fetch, calls } = fakeFetch(() => streamingResponse(["data: [DONE]\n\n"]));
    await collect(adapterWith(fetch));
    expect(calls[0]!.url).toBe("http://localhost:8080/v1/completions");
    expect(calls[0]!.body["prompt"]).toBe(PROMPT.rawText);
    expect(calls[0]!.body["messages"]).toBeUndefined();
  });

  test("the template's stop sequences are sent", async () => {
    // Without them the model writes the user's next turn too, which is the
    // complaint that makes people give up on text mode.
    const { fetch, calls } = fakeFetch(() => streamingResponse(["data: [DONE]\n\n"]));
    await collect(adapterWith(fetch));
    expect(calls[0]!.body["stop"]).toEqual(["<|im_end|>", "<|im_start|>"]);
  });

  test("a template with nothing to stop on sends no stop list at all", async () => {
    const { fetch, calls } = fakeFetch(() => streamingResponse(["data: [DONE]\n\n"]));
    await collect(adapterWith(fetch, { instruct: findInstructTemplate("plain")! }));
    expect("stop" in calls[0]!.body).toBe(false);
  });

  test("the local samplers reach the endpoint", async () => {
    // This is the whole reason this audience runs these servers (§13).
    const { fetch, calls } = fakeFetch(() => streamingResponse(["data: [DONE]\n\n"]));
    await collect(adapterWith(fetch));
    expect(calls[0]!.body["min_p"]).toBe(MODERN_SAMPLER_DEFAULTS.min_p);
    expect(calls[0]!.body["dry_multiplier"]).toBe(MODERN_SAMPLER_DEFAULTS.dry_multiplier);
  });

  test("text arrives on choices[0].text", async () => {
    const { fetch } = fakeFetch(() =>
      streamingResponse([chunk("She "), chunk("said."), "data: [DONE]\n\n"]),
    );
    expect(await collect(adapterWith(fetch))).toBe("She said.");
  });

  test("a prompt built for a chat provider is refused, not sent", async () => {
    // Reaching here without `rawText` means the prompt was built against
    // different capabilities. Sending it would post a chat-shaped prompt to a
    // completion endpoint and get plausible nonsense back.
    const { fetch } = fakeFetch(() => streamingResponse([]));
    const adapter = adapterWith(fetch);
    const chatPrompt: BuiltPrompt = { ...PROMPT };
    delete chatPrompt.rawText;
    await expect(
      (async () => {
        for await (const _ of adapter.generate(
          chatPrompt,
          MODERN_SAMPLER_DEFAULTS,
          new AbortController().signal,
        )) {
          /* drain */
        }
      })(),
    ).rejects.toThrow(AdapterError);
  });
});
