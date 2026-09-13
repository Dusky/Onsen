import type { ProviderKind } from "./types.ts";

/**
 * Known endpoints, so adding a provider is a pick rather than a URL hunt
 * (§20 phase 180).
 *
 * Every address here was checked against the provider's own documentation
 * rather than recalled, because a base URL that is *nearly* right fails at the
 * first generation with a 404 and looks like a broken app. Where a provider
 * serves several shapes, the one chosen is the one whose path Onsen's adapter
 * appends to — `chatPathFor` in `server/adapters/errors.ts` is the authority.
 * The consequence worth stating, because getting it backwards is a 404 on
 * every turn: an OpenAI-compatible or text-completion address **carries its
 * own `/v1`**, and an Anthropic one **does not**, because that adapter
 * appends `v1/messages`.
 *
 * A preset fills the form and nothing more. It is a starting point, not a
 * promise: every field stays editable, and the reader can Test before saving
 * (§20 phase 179). No preset carries a key — those never travel.
 *
 * **No preset names a model, and that is the point (§20 phase 182).** The
 * first version shipped ids for the two providers whose documentation seemed
 * clearest, and DeepSeek's were wrong within days of writing them — a reader
 * picked the preset, kept the prefilled model, and got a 400 from an endpoint
 * their key was perfectly good for. The form's Fetch button asks the provider
 * what it serves right now, which is the only answer that cannot go stale, and
 * a blank field costs one click where a wrong one costs a confusing failure at
 * the first generation.
 *
 * The asymmetry is the whole argument: a blank model is a small, obvious,
 * one-click gap. A wrong model is invisible until a turn fails, and the
 * failure names something the reader never typed.
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
  /** One short line, only where something would otherwise surprise. */
  note?: string;
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    key: "anthropic",
    name: "Anthropic",
    kind: "anthropic",
    // No `/v1`: the Anthropic adapter appends `v1/messages` itself
    // (`chatPathFor`, `server/adapters/errors.ts`). Every other kind's
    // address carries its own `/v1`, because theirs do not.
    baseUrl: "https://api.anthropic.com",
    where: "hosted",
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
