import { failed, type MediaResult, type MediaServiceConfig, type SpeechAdapter, type SpeechRequest } from "./types.ts";

/**
 * Speech from an OpenAI-shaped endpoint: `POST /v1/audio/speech`.
 *
 * Unlike the two image adapters this one returns raw audio bytes rather than
 * base64 in JSON, which is why it reads the body as an ArrayBuffer and why a
 * failure has to be sniffed from the status rather than from the payload.
 *
 * There is no A1111 equivalent to pair this with, because there is no single
 * local TTS API the way there is a single local image API. The OpenAI shape is
 * what the local servers that exist — Kokoro-FastAPI, openedai-speech — chose to
 * emulate, so one adapter reaches them too.
 */

const DEFAULT_VOICE = "alloy";
const DEFAULT_FORMAT = "mp3";

const MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  opus: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
  pcm: "audio/L16",
};

/** How much text one request may carry. OpenAI's own cap, and a sane one. */
export const MAX_SPEECH_CHARACTERS = 4_096;

export function openaiSpeechAdapter(config: MediaServiceConfig): SpeechAdapter {
  const doFetch = config.fetch ?? globalThis.fetch;
  return {
    kind: "openai",
    purpose: "speech",
    async speak(request: SpeechRequest, signal: AbortSignal): Promise<MediaResult> {
      const configuredVoice = config.options["voice"];
      const voice =
        request.voice ??
        (typeof configuredVoice === "string" && configuredVoice !== ""
          ? configuredVoice
          : DEFAULT_VOICE);
      const configuredFormat = config.options["format"];
      const format =
        typeof configuredFormat === "string" && configuredFormat in MIME
          ? configuredFormat
          : DEFAULT_FORMAT;

      const body: Record<string, unknown> = {
        model: config.model === null || config.model === "" ? "tts-1" : config.model,
        // Truncated rather than refused: a reader who pressed play on a long
        // message wants to hear it start, not to be told it was too long.
        input: request.text.slice(0, MAX_SPEECH_CHARACTERS),
        voice,
        response_format: format,
      };
      const speed = config.options["speed"];
      if (typeof speed === "number" && Number.isFinite(speed)) body["speed"] = speed;

      const response = await doFetch(`${config.baseUrl.replace(/\/+$/, "")}/audio/speech`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.apiKey === null ? {} : { Authorization: `Bearer ${config.apiKey}` }),
        },
        body: JSON.stringify(body),
        signal,
      });
      if (!response.ok) throw await failed(response, "Speaking");

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0) throw new Error("The service returned no audio.");
      return { bytes, mime: MIME[format] ?? "application/octet-stream" };
    },
  };
}
