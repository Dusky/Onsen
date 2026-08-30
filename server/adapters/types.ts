import type { SamplerSettings } from "../../shared/types.ts";
import type { BuiltPrompt, ProviderCapabilities } from "../prompt/index.ts";

/**
 * The adapter contract (SPEC §4). One internal message format; adapters
 * translate outward. Each provider declares its capabilities and the prompt
 * builder branches on them, so an adapter never reshapes a prompt itself.
 */

export interface TokenChunk {
  /** Text to append to the generation buffer. */
  text: string;
  /**
   * Reasoning the provider handed back in a field of its own (SPEC §13).
   *
   * Separate from `text` because it is separate at the source: DeepSeek, vLLM
   * and OpenRouter stream it in `delta.reasoning_content`, and mixing the two
   * here would put the model's private planning into the scene.
   */
  reasoning?: string;
}

export interface ModelInfo {
  id: string;
  /** Context window in tokens, where the provider reports one. */
  contextLength?: number;
}

export interface Adapter {
  readonly kind: string;
  readonly capabilities: ProviderCapabilities;

  /**
   * Stream a completion. The signal **must** reach the upstream request:
   * SPEC §4 calls this out explicitly because a leaked generation pins a GPU on
   * llama.cpp, and `test/adapter-openai.test.ts` asserts it.
   */
  generate(
    prompt: BuiltPrompt,
    settings: SamplerSettings,
    signal: AbortSignal,
  ): AsyncIterable<TokenChunk>;

  countTokens?(text: string): number;
  listModels?(): Promise<ModelInfo[]>;
}

/**
 * A failure that came from the provider rather than from this codebase. Carries
 * enough to show the user something actionable instead of "request failed".
 */
export class AdapterError extends Error {
  readonly status: number | null;
  /** The provider's own message, where it sent one. */
  readonly providerMessage: string | null;
  /** True when retrying the same request might succeed. */
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { status?: number | null; providerMessage?: string | null; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "AdapterError";
    this.status = options.status ?? null;
    this.providerMessage = options.providerMessage ?? null;
    this.retryable = options.retryable ?? false;
  }
}

/** Everything an adapter needs to reach its provider. */
export interface AdapterConfig {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  /** Overrides the capability default where the operator knows better. */
  maxContext?: number;
  /**
   * Whether this endpoint accepts a prefill (§13). Prefill is a property of the
   * endpoint rather than the wire format: OpenAI rejects a trailing assistant
   * message, most local servers speaking the same shape accept one. Absent
   * means the adapter's own default stands.
   */
  supportsPrefill?: boolean;
  /** Injected so tests use recorded fixtures rather than live APIs (§23). */
  fetch?: typeof globalThis.fetch;
}
