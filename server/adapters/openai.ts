import type { SamplerSettings } from "../../shared/types.ts";
import type { BuiltPrompt, ProviderCapabilities } from "../prompt/index.ts";
import { parseSseStream } from "./sse.ts";
import { AdapterError, type Adapter, type AdapterConfig, type ModelInfo, type TokenChunk } from "./types.ts";

/**
 * The OpenAI-compatible adapter (SPEC §4): OpenAI itself, OpenRouter, and the
 * OpenAI-shaped endpoints that llama.cpp, KoboldCpp, TabbyAPI, Ollama and
 * text-generation-webui all expose.
 *
 * Local shims accept the modern samplers (min-P, DRY, XTC) as extra top-level
 * fields and ignore what they do not know, while hosted providers reject
 * nothing they do not recognise either. Sending them is therefore safe and is
 * what makes SPEC §13's defaults actually reach a local backend.
 */

export const OPENAI_COMPATIBLE_CAPABILITIES: ProviderCapabilities = {
  separateSystemRole: true,
  supportsPrefill: false,
  requiresStrictAlternation: false,
  mode: "chat",
  needsInstructTemplate: false,
  supportedSamplers: [
    "temperature",
    "top_p",
    "top_k",
    "min_p",
    "repetition_penalty",
    "dry",
    "xtc",
  ],
  samplerOrder: null,
  maxContext: 32_768,
  supportsLogitBias: true,
  supportsStopSequences: true,
  supportsGrammar: false,
  emitsReasoning: false,
  supportsPromptCaching: true,
  tokenizer: null,
};

/**
 * The delta shape of a streaming chat completion.
 *
 * `reasoning_content` is DeepSeek's field and the one vLLM copied;
 * `reasoning` is OpenRouter's. Neither is in OpenAI's own schema, and a
 * provider that sends neither simply never populates them (§13).
 */
interface ChatCompletionChunk {
  choices?: {
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
    };
  }[];
  error?: { message?: string };
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/**
 * Map internal sampler settings onto request fields. Only the samplers the
 * capabilities declare are sent, so a provider never receives a knob the prompt
 * builder was told it does not have.
 */
function samplerFields(settings: SamplerSettings): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const put = (key: string, value: number | string[] | undefined) => {
    if (value !== undefined) fields[key] = value;
  };

  put("temperature", settings.temperature);
  put("top_p", settings.top_p);
  put("top_k", settings.top_k);
  put("min_p", settings.min_p);
  put("repetition_penalty", settings.repetition_penalty);
  put("dry_multiplier", settings.dry_multiplier);
  put("dry_base", settings.dry_base);
  put("dry_allowed_length", settings.dry_allowed_length);
  put("dry_sequence_breakers", settings.dry_sequence_breakers);
  put("xtc_threshold", settings.xtc_threshold);
  put("xtc_probability", settings.xtc_probability);

  return fields;
}

async function readErrorBody(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    if (text === "") return null;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } | string };
      if (typeof parsed.error === "string") return parsed.error;
      if (parsed.error?.message !== undefined) return parsed.error.message;
    } catch {
      /* Not JSON; the raw body is still the most useful thing to show. */
    }
    return text.slice(0, 500);
  } catch {
    return null;
  }
}

export function createOpenAiAdapter(config: AdapterConfig): Adapter {
  const doFetch = config.fetch ?? globalThis.fetch;
  const capabilities: ProviderCapabilities = {
    ...OPENAI_COMPATIBLE_CAPABILITIES,
    ...(config.maxContext === undefined ? {} : { maxContext: config.maxContext }),
    ...(config.supportsPrefill === undefined ? {} : { supportsPrefill: config.supportsPrefill }),
  };

  function headers(): Record<string, string> {
    const base: Record<string, string> = { "Content-Type": "application/json" };
    // A local server usually needs no key, and sending an empty bearer token
    // makes some of them reject the request outright.
    if (config.apiKey !== null && config.apiKey !== "") {
      base["Authorization"] = `Bearer ${config.apiKey}`;
    }
    return base;
  }

  return {
    kind: "openai_compatible",
    capabilities,

    async *generate(
      prompt: BuiltPrompt,
      settings: SamplerSettings,
      signal: AbortSignal,
    ): AsyncIterable<TokenChunk> {
      const messages = [
        ...(prompt.system === undefined ? [] : [{ role: "system", content: prompt.system }]),
        ...prompt.messages.map((message) => ({ role: message.role, content: message.content })),
      ];

      // Prefill: a partial assistant turn the model continues from (§13). On
      // this wire format that is a trailing assistant message, which is exactly
      // what OpenAI rejects and what most local servers accept — so it is sent
      // only where the endpoint has said it works.
      if (capabilities.supportsPrefill && prompt.prefill !== undefined && prompt.prefill !== "") {
        messages.push({ role: "assistant", content: prompt.prefill });
      }

      let response: Response;
      try {
        response = await doFetch(joinUrl(config.baseUrl, "chat/completions"), {
          method: "POST",
          headers: headers(),
          // Passing the signal to fetch is what actually stops inference
          // upstream. SPEC §4 is explicit that a leaked generation pins a GPU.
          signal,
          body: JSON.stringify({
            model: config.model,
            messages,
            stream: true,
            ...samplerFields(settings),
          }),
        });
      } catch (caught) {
        if (signal.aborted) return;
        throw new AdapterError(`Could not reach ${config.baseUrl}.`, {
          providerMessage: caught instanceof Error ? caught.message : null,
          retryable: true,
        });
      }

      if (!response.ok) {
        const providerMessage = await readErrorBody(response);
        throw new AdapterError(`The provider returned ${response.status}.`, {
          status: response.status,
          providerMessage,
          // 408, 429 and 5xx are worth another attempt; a 400 or 401 is not.
          retryable: response.status === 408 || response.status === 429 || response.status >= 500,
        });
      }

      if (response.body === null) {
        throw new AdapterError("The provider returned no response body.");
      }

      for await (const event of parseSseStream(response.body, signal)) {
        if (signal.aborted) return;
        if (event.data === "[DONE]") return;

        let chunk: ChatCompletionChunk;
        try {
          chunk = JSON.parse(event.data) as ChatCompletionChunk;
        } catch {
          // A malformed frame is not worth failing a generation over; the next
          // one is usually fine, and losing a token beats losing the turn.
          continue;
        }

        if (chunk.error !== undefined) {
          throw new AdapterError("The provider reported an error mid-stream.", {
            providerMessage: chunk.error.message ?? null,
          });
        }

        const delta = chunk.choices?.[0]?.delta;
        // A frame can carry either, and some providers send a run of
        // reasoning-only frames before the first word of prose.
        const thought = delta?.reasoning_content ?? delta?.reasoning;
        if (typeof thought === "string" && thought !== "") yield { text: "", reasoning: thought };
        const text = delta?.content;
        if (typeof text === "string" && text !== "") yield { text };
      }
    },

    async listModels(): Promise<ModelInfo[]> {
      const response = await doFetch(joinUrl(config.baseUrl, "models"), { headers: headers() });
      if (!response.ok) {
        throw new AdapterError(`Could not list models: the provider returned ${response.status}.`, {
          status: response.status,
          providerMessage: await readErrorBody(response),
        });
      }
      const body = (await response.json()) as {
        data?: { id?: unknown; context_length?: unknown }[];
      };
      return (body.data ?? [])
        .filter((model): model is { id: string; context_length?: number } => typeof model.id === "string")
        .map((model) => ({
          id: model.id,
          ...(typeof model.context_length === "number"
            ? { contextLength: model.context_length }
            : {}),
        }));
    },
  };
}
