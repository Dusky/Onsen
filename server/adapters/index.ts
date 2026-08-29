import type { ProviderKind } from "../../shared/types.ts";
import { createOpenAiAdapter, OPENAI_COMPATIBLE_CAPABILITIES } from "./openai.ts";
import { AdapterError, type Adapter, type AdapterConfig } from "./types.ts";

export * from "./types.ts";
export { OPENAI_COMPATIBLE_CAPABILITIES } from "./openai.ts";
export { parseSseStream } from "./sse.ts";

/**
 * The adapter registry (SPEC §4). Anthropic and text completion are phase 20;
 * asking for one now fails with a message that says so rather than silently
 * falling back to a different provider's wire format.
 */
export function createAdapter(kind: ProviderKind, config: AdapterConfig): Adapter {
  switch (kind) {
    case "openai_compatible":
      return createOpenAiAdapter(config);
    case "anthropic":
    case "text_completion":
      throw new AdapterError(
        `The ${kind === "anthropic" ? "Anthropic" : "text completion"} adapter is not built yet.`,
      );
  }
}

/** Capabilities without constructing an adapter, for the prompt builder. */
export function capabilitiesFor(kind: ProviderKind) {
  switch (kind) {
    case "openai_compatible":
      return OPENAI_COMPATIBLE_CAPABILITIES;
    case "anthropic":
    case "text_completion":
      throw new AdapterError(`No capabilities are known for ${kind} yet.`);
  }
}
