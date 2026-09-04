import { a1111Adapter } from "./a1111.ts";
import { openaiImageAdapter } from "./openai-image.ts";
import { openaiSpeechAdapter } from "./openai-speech.ts";
import type { ImageAdapter, MediaServiceConfig, SpeechAdapter } from "./types.ts";

export * from "./types.ts";
export { MAX_SPEECH_CHARACTERS } from "./openai-speech.ts";

/**
 * Which adapters exist, and what each one is called on screen.
 *
 * The labels live here rather than in the client for the reason that has now
 * come up in four phases: a raw enum reaching a screen is how `situational` and
 * `OPENAI_COMPATIBLE` got in front of a reader.
 */
export const MEDIA_KINDS = [
  {
    purpose: "image" as const,
    kind: "openai" as const,
    label: "OpenAI-compatible",
    hint: "Anything serving /v1/images/generations.",
    defaultBaseUrl: "https://api.openai.com/v1",
    needsKey: true,
  },
  {
    purpose: "image" as const,
    kind: "a1111" as const,
    label: "Stable Diffusion WebUI",
    hint: "AUTOMATIC1111, Forge, reForge or SD.Next, running locally.",
    defaultBaseUrl: "http://127.0.0.1:7860",
    needsKey: false,
  },
  {
    purpose: "speech" as const,
    kind: "openai" as const,
    label: "OpenAI-compatible",
    hint: "Anything serving /v1/audio/speech, including Kokoro and openedai-speech.",
    defaultBaseUrl: "https://api.openai.com/v1",
    needsKey: true,
  },
];

export function imageAdapterFor(kind: string, config: MediaServiceConfig): ImageAdapter {
  switch (kind) {
    case "openai":
      return openaiImageAdapter(config);
    case "a1111":
      return a1111Adapter(config);
    default:
      throw new Error(`No image service of kind "${kind}".`);
  }
}

export function speechAdapterFor(kind: string, config: MediaServiceConfig): SpeechAdapter {
  switch (kind) {
    case "openai":
      return openaiSpeechAdapter(config);
    default:
      throw new Error(`No speech service of kind "${kind}".`);
  }
}
