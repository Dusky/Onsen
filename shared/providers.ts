import type { ProviderKind } from "./types.ts";

/**
 * Known endpoints, so adding a provider is a pick rather than a URL hunt
 * (§20 phase 180).
 *
 * Every address here was checked against the provider's own documentation
 * rather than recalled, because a base URL that is *nearly* right fails at the
 * first generation with a 404 and looks like a broken app. Where a provider
 * serves several shapes, the one chosen is the one whose path Onsen's adapter
 * appends to: `${baseUrl}/chat/completions` for an OpenAI-compatible endpoint,
 * `${baseUrl}/messages` for Anthropic's, `${baseUrl}/completions` for text
 * completion (`server/routes/connections.ts`).
 *
 * A preset fills the form and nothing more. It is a starting point, not a
 * promise: every field stays editable, and the reader can Test before saving
 * (§20 phase 179). No preset carries a key — those never travel.
 *
 * `models` is only populated where the ids are known from the provider's own
 * current documentation. Everywhere else it is empty on purpose, because the
 * form's Fetch button asks the endpoint what it actually serves, and a stale
 * guessed model id is worse than an empty field.
 */
export interface ProviderPreset {
  /** Stable id, used by the picker and by the guards. */
  key: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  /**
   * Grouping for the picker. `hosted` is somebody else's machine and wants a
   * key; `local` is yours and usually does not.
   */
  where: "hosted" | "local";
  /** Offered before Fetch runs. Empty where the ids are not known for certain. */
  models?: string[];
  /** One short line, only where something would otherwise surprise. */
  note?: string;
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    key: "anthropic",
    name: "Anthropic",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    where: "hosted",
    models: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
  },
  {
    key: "openai",
    name: "OpenAI",
    kind: "openai_compatible",
    baseUrl: "https://api.openai.com/v1",
    where: "hosted",
  },
  {
    key: "deepseek",
    name: "DeepSeek",
    kind: "openai_compatible",
    baseUrl: "https://api.deepseek.com/v1",
    where: "hosted",
    models: ["deepseek-flash", "deepseek-v4-pro"],
  },
  {
    key: "nanogpt",
    name: "NanoGPT",
    kind: "openai_compatible",
    baseUrl: "https://nano-gpt.com/api/v1",
    where: "hosted",
  },
  {
    key: "zai",
    name: "Z.AI",
    kind: "openai_compatible",
    baseUrl: "https://api.z.ai/api/paas/v4",
    where: "hosted",
    // A coding plan is served from a different path, so the address is the one
    // field worth checking against your own plan before saving.
    note: "A coding plan uses /api/coding/paas/v4 instead.",
  },
  {
    key: "openrouter",
    name: "OpenRouter",
    kind: "openai_compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    where: "hosted",
  },
  {
    key: "google",
    name: "Google Gemini",
    kind: "openai_compatible",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    where: "hosted",
  },
  {
    key: "xai",
    name: "xAI",
    kind: "openai_compatible",
    baseUrl: "https://api.x.ai/v1",
    where: "hosted",
  },
  {
    key: "mistral",
    name: "Mistral",
    kind: "openai_compatible",
    baseUrl: "https://api.mistral.ai/v1",
    where: "hosted",
  },
  {
    key: "groq",
    name: "Groq",
    kind: "openai_compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    where: "hosted",
  },
  {
    key: "together",
    name: "Together AI",
    kind: "openai_compatible",
    baseUrl: "https://api.together.ai/v1",
    where: "hosted",
  },
  {
    key: "fireworks",
    name: "Fireworks AI",
    kind: "openai_compatible",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    where: "hosted",
  },
  {
    key: "ollama",
    name: "Ollama",
    kind: "openai_compatible",
    baseUrl: "http://localhost:11434/v1",
    where: "local",
  },
  {
    key: "lmstudio",
    name: "LM Studio",
    kind: "openai_compatible",
    baseUrl: "http://localhost:1234/v1",
    where: "local",
  },
  {
    key: "koboldcpp",
    name: "KoboldCpp",
    kind: "openai_compatible",
    baseUrl: "http://localhost:5001/v1",
    where: "local",
  },
  {
    key: "llamacpp",
    name: "llama.cpp",
    kind: "openai_compatible",
    baseUrl: "http://localhost:8080/v1",
    where: "local",
  },
  {
    key: "textgen",
    name: "Text generation web UI",
    kind: "openai_compatible",
    baseUrl: "http://localhost:5000/v1",
    where: "local",
  },
];
