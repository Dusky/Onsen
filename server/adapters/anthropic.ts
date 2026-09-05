import type { SamplerSettings } from "../../shared/types.ts";
import type { BuiltPrompt, ProviderCapabilities } from "../prompt/index.ts";
import { parseSseStream } from "./sse.ts";
import { AdapterError, type Adapter, type AdapterConfig, type ModelInfo, type TokenChunk } from "./types.ts";

/**
 * The Anthropic adapter (SPEC §4).
 *
 * Written against the wire format rather than the official SDK, for the same
 * reason the OpenAI adapter is: this is a provider *adapter* in a
 * multi-provider app, and it has to satisfy three things an SDK client does
 * not. It must honour an operator-supplied `baseUrl`, because a large share of
 * this audience reaches Anthropic through a proxy. It must stream through the
 * one SSE parser the whole app shares — the one whose tests cover events split
 * across network chunks. And it must take an injected `fetch`, so the suite
 * runs on fixtures instead of a live API and a bill.
 *
 * Three shapes differ from the OpenAI-compatible endpoint and all three are
 * load-bearing:
 *
 * - **`system` is its own parameter**, not a message. That is what
 *   `separateSystemRole` exists to say.
 * - **The conversation must open on a user turn.** `requiresStrictAlternation`
 *   makes the builder merge and pad for this before the adapter sees it.
 * - **`max_tokens` is required.** There is no "as much as you like".
 */

/** Anthropic's dated API contract. Not a version of this app. */
const API_VERSION = "2023-06-01";

/**
 * A floor for `max_tokens`, used when the caller reserved nothing.
 *
 * Side calls (§7's classifier, the guide and summary runners) reserve zero,
 * because on every other provider the response budget is advisory. Here it is a
 * required field, and zero is not a legal value.
 */
const MIN_RESPONSE_TOKENS = 1024;

/**
 * What a given Claude model actually accepts.
 *
 * This is the part of the adapter that dates fastest, and it is not
 * decoration: Anthropic **removed** `temperature`, `top_p` and `top_k` from the
 * 4.6 generation onward, and removed assistant prefill along with them. Sending
 * either to a current model is a 400, not a politely ignored field — which
 * makes this the one place in the app where a provider rejects §13's samplers
 * outright rather than tolerating them.
 */
export interface AnthropicModelRules {
  /** `temperature`, `top_p` and `top_k`. Gone from 4.6 onward. */
  acceptsSamplingParams: boolean;
  /** A trailing assistant turn. Gone from 4.6 onward. */
  acceptsPrefill: boolean;
  /** Whether to ask for thinking, and in which of the two dialects. */
  thinking: "adaptive" | "none";
  /** Null when the model string is not one this code recognises. */
  version: number | null;
}

/**
 * Read a generation number out of a model id.
 *
 * `claude-opus-5` is 5, `claude-opus-4-8` is 4.8, `claude-haiku-4-5` is 4.5,
 * and the older `claude-3-5-sonnet-20241022` is 3.5. Anything else — a proxy's
 * own naming, a fine-tune, a model released after this was written — is null.
 */
export function anthropicModelVersion(model: string): number | null {
  const id = model.trim().toLowerCase();
  // The two-part legacy form puts the generation before the family.
  const legacy = /^claude-(\d+)(?:[-.](\d+))?-(?:opus|sonnet|haiku)\b/.exec(id);
  if (legacy !== null) return Number(`${legacy[1]}.${legacy[2] ?? "0"}`);
  const modern = /^claude-(?:opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?\b/.exec(id);
  if (modern !== null) return Number(`${modern[1]}.${modern[2] ?? "0"}`);
  return null;
}

/**
 * The generation that dropped sampling parameters and prefill.
 *
 * Both went at once, which is why one constant covers both.
 */
const NO_SAMPLERS_FROM = 4.6;

export function anthropicModelRules(model: string): AnthropicModelRules {
  const version = anthropicModelVersion(model);
  // An unrecognised model is treated as current. The two failure directions are
  // not symmetric: sending a sampler a model rejects fails the whole
  // generation with a 400, while not sending one costs a knob and still
  // writes the turn. `AdapterConfig` carries overrides for an operator who
  // knows their proxy better than this heuristic does.
  const modern = version === null || version >= NO_SAMPLERS_FROM;
  return {
    acceptsSamplingParams: !modern,
    acceptsPrefill: !modern,
    // Thinking is asked for only where the adaptive form exists; the older
    // `budget_tokens` dialect needs a budget this app has no field for, and
    // guessing one is worse than leaving the model to its default.
    thinking: modern ? "adaptive" : "none",
    version,
  };
}

/**
 * Capabilities for a given model.
 *
 * Unlike every other provider in the app, Anthropic's capabilities are not a
 * constant: what the endpoint accepts depends on which Claude is behind it.
 */
export function anthropicCapabilities(model: string, rules = anthropicModelRules(model)): ProviderCapabilities {
  return {
    separateSystemRole: true,
    supportsPrefill: rules.acceptsPrefill,
    requiresStrictAlternation: true,
    mode: "chat",
    needsInstructTemplate: false,
    // Never min-P, DRY or XTC: those are local-inference samplers and this API
    // has never had them. On a current model the list is empty, and §13's
    // editor showing nothing is the correct, honest result.
    supportedSamplers: rules.acceptsSamplingParams ? ["temperature", "top_p", "top_k"] : [],
    samplerOrder: null,
    maxContext: 200_000,
    supportsLogitBias: false,
    supportsStopSequences: true,
    supportsGrammar: false,
    emitsReasoning: true,
    supportsPromptCaching: true,
    // Anthropic's tool blocks are a different wire shape from OpenAI's — content
  // blocks with `tool_use` and `input_json_delta`, not a `tool_calls` array —
  // and that is not wired yet (§20 phase 46). Declaring false is the honest
  // answer: this codebase has been bitten five times by a capability that was
  // announced and not built.
  supportsTools: false,
  supportsVision: true,
    tokenizer: null,
  };
}

/** Capabilities before a model is known, for callers that only have a kind. */
export const ANTHROPIC_CAPABILITIES: ProviderCapabilities = anthropicCapabilities("");

/* ------------------------------------------------------------------ */
/* Wire shapes                                                         */
/* ------------------------------------------------------------------ */

interface StreamEvent {
  type?: string;
  delta?: { type?: string; text?: string; thinking?: string };
  error?: { type?: string; message?: string };
  message?: { usage?: { input_tokens?: number } };
}

interface ErrorBody {
  error?: { type?: string; message?: string };
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

async function readErrorBody(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    if (text === "") return null;
    try {
      const parsed = JSON.parse(text) as ErrorBody;
      if (parsed.error?.message !== undefined) return parsed.error.message;
    } catch {
      /* Not JSON; the raw body is still the most useful thing to show. */
    }
    return text.slice(0, 500);
  } catch {
    return null;
  }
}

/** 429 and 5xx are worth another attempt; 529 is the overload code. */
function isRetryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function createAnthropicAdapter(config: AdapterConfig): Adapter {
  const doFetch = config.fetch ?? globalThis.fetch;
  const rules = anthropicModelRules(config.model);
  const capabilities: ProviderCapabilities = {
    ...anthropicCapabilities(config.model, rules),
    ...(config.maxContext === undefined ? {} : { maxContext: config.maxContext }),
    ...(config.supportsPrefill === undefined ? {} : { supportsPrefill: config.supportsPrefill }),
  };

  function headers(): Record<string, string> {
    const base: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": API_VERSION,
    };
    // A proxy in front of this API often needs no key of its own.
    if (config.apiKey !== null && config.apiKey !== "") base["x-api-key"] = config.apiKey;
    return base;
  }

  function samplerFields(settings: SamplerSettings): Record<string, unknown> {
    if (!capabilities.supportedSamplers.includes("temperature")) return {};
    const fields: Record<string, unknown> = {};
    if (settings.temperature !== undefined) fields["temperature"] = settings.temperature;
    if (settings.top_p !== undefined) fields["top_p"] = settings.top_p;
    if (settings.top_k !== undefined) fields["top_k"] = settings.top_k;
    return fields;
  }

  return {
    kind: "anthropic",
    capabilities,

    async *generate(
      prompt: BuiltPrompt,
      settings: SamplerSettings,
      signal: AbortSignal,
    ): AsyncIterable<TokenChunk> {
      const messages: { role: string; content: unknown }[] = prompt.messages.map((message) => ({
        role: message.role,
        // Anthropic's blocks rather than OpenAI's parts (§20 phase 41), and the
        // image comes first: the API's own guidance is that a question about a
        // picture reads better after it.
        content:
          message.images === undefined || message.images.length === 0
            ? message.content
            : [
                ...message.images.map((image) => ({
                  type: "image",
                  source: { type: "base64", media_type: image.mime, data: image.base64 },
                })),
                { type: "text", text: message.content },
              ],
      }));

      if (capabilities.supportsPrefill && prompt.prefill !== undefined && prompt.prefill !== "") {
        messages.push({ role: "assistant", content: prompt.prefill });
      }

      const body: Record<string, unknown> = {
        model: config.model,
        messages,
        // Required, and there is no sentinel for "unlimited". The builder's own
        // reservation is the honest number: it is what the prompt was fitted
        // around, so asking for more than it could overflow the window the
        // builder already reported as fitting. The floor applies only where
        // nothing was reserved at all.
        max_tokens:
          prompt.debug.reservedForResponse > 0
            ? prompt.debug.reservedForResponse
            : MIN_RESPONSE_TOKENS,
        stream: true,
        ...samplerFields(settings),
      };
      if (prompt.system !== undefined && prompt.system !== "") body["system"] = prompt.system;
      if (rules.thinking === "adaptive") {
        // `display` has to be asked for. Its default omits the text, which on a
        // thinking model looks to the reader like a long silence before the
        // first word — and §13 has a reasoning strip with nothing to put in it.
        body["thinking"] = { type: "adaptive", display: "summarized" };
      }

      let response: Response;
      try {
        response = await doFetch(joinUrl(config.baseUrl, "v1/messages"), {
          method: "POST",
          headers: headers(),
          // SPEC §4: the signal must reach upstream, or an abandoned
          // generation keeps being billed.
          signal,
          body: JSON.stringify(body),
        });
      } catch (caught) {
        if (signal.aborted) return;
        throw new AdapterError(`Could not reach ${config.baseUrl}.`, {
          providerMessage: caught instanceof Error ? caught.message : null,
          retryable: true,
        });
      }

      if (!response.ok) {
        throw new AdapterError(`The provider returned ${response.status}.`, {
          status: response.status,
          providerMessage: await readErrorBody(response),
          retryable: isRetryable(response.status),
        });
      }

      if (response.body === null) {
        throw new AdapterError("The provider returned no response body.");
      }

      for await (const event of parseSseStream(response.body, signal)) {
        if (signal.aborted) return;

        let frame: StreamEvent;
        try {
          frame = JSON.parse(event.data) as StreamEvent;
        } catch {
          // As on the OpenAI side: losing a frame beats losing the turn.
          continue;
        }

        // Errors arrive as an event in a 200 stream rather than as a status.
        if (frame.type === "error") {
          throw new AdapterError("The provider reported an error mid-stream.", {
            providerMessage: frame.error?.message ?? null,
            retryable: frame.error?.type === "overloaded_error",
          });
        }
        if (frame.type === "message_stop") return;
        if (frame.type !== "content_block_delta") continue;

        // Two delta types matter. `thinking_delta` is this API's equivalent of
        // the `reasoning_content` field the OpenAI-shaped providers use, and it
        // is kept apart for the same reason: the model's planning is not the
        // scene (§13).
        const delta = frame.delta;
        if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
          if (delta.thinking !== "") yield { text: "", reasoning: delta.thinking };
        } else if (delta?.type === "text_delta" && typeof delta.text === "string") {
          if (delta.text !== "") yield { text: delta.text };
        }
      }
    },

    async listModels(): Promise<ModelInfo[]> {
      const response = await doFetch(joinUrl(config.baseUrl, "v1/models"), { headers: headers() });
      if (!response.ok) {
        throw new AdapterError(`Could not list models: the provider returned ${response.status}.`, {
          status: response.status,
          providerMessage: await readErrorBody(response),
        });
      }
      const body = (await response.json()) as {
        data?: { id?: unknown; max_input_tokens?: unknown }[];
      };
      return (body.data ?? [])
        .filter((model): model is { id: string; max_input_tokens?: number } =>
          typeof model.id === "string",
        )
        .map((model) => ({
          id: model.id,
          // This API calls the context window `max_input_tokens`; there is no
          // `context_length` here.
          ...(typeof model.max_input_tokens === "number"
            ? { contextLength: model.max_input_tokens }
            : {}),
        }));
    },
  };
}
