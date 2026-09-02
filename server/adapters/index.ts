import type { ProviderKind } from "../../shared/types.ts";
import type { InstructTemplate, ProviderCapabilities } from "../prompt/index.ts";
import { createOpenAiAdapter, OPENAI_COMPATIBLE_CAPABILITIES } from "./openai.ts";
import {
  ANTHROPIC_CAPABILITIES,
  anthropicCapabilities,
  createAnthropicAdapter,
} from "./anthropic.ts";
import { createTextCompletionAdapter, TEXT_COMPLETION_CAPABILITIES } from "./text.ts";
import { type Adapter, type AdapterConfig } from "./types.ts";

export * from "./types.ts";
export { OPENAI_COMPATIBLE_CAPABILITIES } from "./openai.ts";
export { ANTHROPIC_CAPABILITIES, anthropicCapabilities, anthropicModelRules } from "./anthropic.ts";
export { TEXT_COMPLETION_CAPABILITIES } from "./text.ts";
export { parseSseStream } from "./sse.ts";

/** Beyond the shared config: what only one kind of adapter needs. */
export interface CreateAdapterOptions extends AdapterConfig {
  /** Text completion only: the template whose stop sequences end a turn. */
  instruct?: InstructTemplate;
}

/** The adapter registry (SPEC §4). All three v1 adapters are built. */
export function createAdapter(kind: ProviderKind, config: CreateAdapterOptions): Adapter {
  switch (kind) {
    case "openai_compatible":
      return createOpenAiAdapter(config);
    case "anthropic":
      return createAnthropicAdapter(config);
    case "text_completion":
      return createTextCompletionAdapter(config);
  }
  throw new Error(`Unknown adapter kind: ${kind}`);
}

/**
 * Capabilities without constructing an adapter, for the prompt builder.
 *
 * The model matters for exactly one provider. Anthropic removed `temperature`,
 * `top_p`, `top_k` and assistant prefill from its 4.6 generation onward, so
 * what the endpoint accepts depends on which Claude is behind it — and a caller
 * that knows the model should say so. Without one, the safe reading is applied:
 * the newer, narrower contract, which costs a knob rather than failing a
 * generation with a 400.
 */
export function capabilitiesFor(kind: ProviderKind, model?: string): ProviderCapabilities {
  switch (kind) {
    case "openai_compatible":
      return OPENAI_COMPATIBLE_CAPABILITIES;
    case "anthropic":
      return model === undefined ? ANTHROPIC_CAPABILITIES : anthropicCapabilities(model);
    case "text_completion":
      return TEXT_COMPLETION_CAPABILITIES;
  }
}
