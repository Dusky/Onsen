import type { SamplerSettings } from "../../shared/types.ts";
import type { BuiltPrompt, InstructTemplate, ProviderCapabilities } from "../prompt/index.ts";
import { parseSseStream } from "./sse.ts";
import { AdapterError, type Adapter, type AdapterConfig, type ModelInfo, type TokenChunk } from "./types.ts";

/**
 * The text-completion adapter (SPEC §4): llama.cpp's server, KoboldCpp and
 * TabbyAPI.
 *
 * All three expose an OpenAI-shaped `/v1/completions` alongside their own
 * native APIs, and that is the one endpoint common to the three, so it is the
 * one this speaks. The wire shape is the chat adapter's minus the message
 * array: a single `prompt` string in, `choices[0].text` out.
 *
 * The reason this adapter exists at all, when those servers also speak
 * `/chat/completions`, is control over the prompt. Their chat endpoints apply
 * an instruct template of their own — from the GGUF's metadata, usually — and
 * silently reshape everything the builder did: the system block moves, the
 * prefill is dropped, and depth-injected notes end up somewhere else. Text mode
 * is how the app keeps the prompt it actually assembled (§3).
 *
 * That control is also the risk. In text mode the app owns the turn markers, so
 * a wrong template is a wrong prompt with no error to show for it.
 */

export const TEXT_COMPLETION_CAPABILITIES: ProviderCapabilities = {
  // There is no system role in a raw completion; the template decides where the
  // system text goes.
  separateSystemRole: false,
  // Prefill is free here, and is not really a feature: the prompt simply ends
  // mid-assistant-turn and the model continues it. That is what a completion
  // endpoint does.
  supportsPrefill: true,
  requiresStrictAlternation: false,
  mode: "text",
  needsInstructTemplate: true,
  // The local-inference samplers, which is the whole reason this audience runs
  // these servers (§13).
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
  maxContext: 8192,
  supportsLogitBias: true,
  supportsStopSequences: true,
  supportsGrammar: true,
  emitsReasoning: false,
  supportsPromptCaching: false,
  // A raw completion endpoint takes a string. There is nowhere to put a
  // picture, which is a fact about the format rather than a limitation.
  supportsVision: false,
  tokenizer: null,
};

interface CompletionChunk {
  choices?: { text?: string | null; finish_reason?: string | null }[];
  error?: { message?: string } | string;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

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

/** Everything the text adapter needs beyond the shared config. */
export interface TextAdapterConfig extends AdapterConfig {
  /**
   * The template whose stop sequences end a turn. The same template the builder
   * rendered with — they have to agree, or the model is stopped on markers it
   * was never given.
   */
  instruct?: InstructTemplate;
}

export function createTextCompletionAdapter(config: TextAdapterConfig): Adapter {
  const doFetch = config.fetch ?? globalThis.fetch;
  const capabilities: ProviderCapabilities = {
    ...TEXT_COMPLETION_CAPABILITIES,
    ...(config.maxContext === undefined ? {} : { maxContext: config.maxContext }),
    ...(config.supportsPrefill === undefined ? {} : { supportsPrefill: config.supportsPrefill }),
  };

  function headers(): Record<string, string> {
    const base: Record<string, string> = { "Content-Type": "application/json" };
    if (config.apiKey !== null && config.apiKey !== "") {
      base["Authorization"] = `Bearer ${config.apiKey}`;
    }
    return base;
  }

  return {
    kind: "text_completion",
    capabilities,

    async *generate(
      prompt: BuiltPrompt,
      settings: SamplerSettings,
      signal: AbortSignal,
    ): AsyncIterable<TokenChunk> {
      if (prompt.rawText === undefined) {
        // The builder only renders `rawText` when the capabilities say text
        // mode. Reaching here without it means the prompt was built against a
        // different provider's capabilities, and continuing would send a
        // chat-shaped prompt to a completion endpoint.
        throw new AdapterError("This prompt was not built for text completion.");
      }

      const stop = config.instruct?.stopSequences ?? [];
      let response: Response;
      try {
        response = await doFetch(joinUrl(config.baseUrl, "completions"), {
          method: "POST",
          headers: headers(),
          signal,
          body: JSON.stringify({
            model: config.model,
            prompt: prompt.rawText,
            stream: true,
            // Without these the model writes the user's next turn too, which is
            // the complaint that makes people give up on text mode.
            ...(stop.length === 0 ? {} : { stop }),
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
        throw new AdapterError(`The provider returned ${response.status}.`, {
          status: response.status,
          providerMessage: await readErrorBody(response),
          retryable: response.status === 408 || response.status === 429 || response.status >= 500,
        });
      }

      if (response.body === null) {
        throw new AdapterError("The provider returned no response body.");
      }

      for await (const event of parseSseStream(response.body, signal)) {
        if (signal.aborted) return;
        if (event.data === "[DONE]") return;

        let chunk: CompletionChunk;
        try {
          chunk = JSON.parse(event.data) as CompletionChunk;
        } catch {
          continue;
        }

        if (chunk.error !== undefined) {
          throw new AdapterError("The provider reported an error mid-stream.", {
            providerMessage:
              typeof chunk.error === "string" ? chunk.error : (chunk.error.message ?? null),
          });
        }

        const text = chunk.choices?.[0]?.text;
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
        .filter((model): model is { id: string; context_length?: number } =>
          typeof model.id === "string",
        )
        .map((model) => ({
          id: model.id,
          ...(typeof model.context_length === "number"
            ? { contextLength: model.context_length }
            : {}),
        }));
    },
  };
}
