import { AdapterError } from "../adapters/types.ts";

/**
 * The media adapter contract (SPEC §20 phase 41).
 *
 * Deliberately the same shape as §4's text adapters: one internal request,
 * adapters translate outward, credentials arrive from the caller and are never
 * read from anywhere else. The differences from §4 are the two that matter —
 * nothing streams, because a picture arrives whole, and there is no prompt
 * builder in front of this, because a picture has no context window to fill.
 *
 * `AdapterError` is reused rather than reinvented. A media service failing is
 * the same kind of event as a provider failing, and the UI that has to explain
 * "the endpoint refused this" already knows how to read one.
 */

export interface MediaServiceConfig {
  baseUrl: string;
  apiKey: string | null;
  model: string | null;
  /** Whatever this kind of service takes. Validated by the adapter, not here. */
  options: Record<string, unknown>;
  /** Injected so tests use a stub rather than a live service (§23). */
  fetch?: typeof globalThis.fetch;
}

export interface ImageRequest {
  prompt: string;
  /** A negative prompt, where the service has the idea. Ignored where it does not. */
  negativePrompt?: string;
  width?: number;
  height?: number;
}

export interface SpeechRequest {
  text: string;
  /** The service's own voice name. Null takes the service's configured default. */
  voice?: string | null;
}

/** What came back. Bytes, because the store is what decides where they live. */
export interface MediaResult {
  bytes: Uint8Array;
  mime: string;
  width?: number;
  height?: number;
  durationMs?: number;
}

export interface ImageAdapter {
  readonly kind: string;
  readonly purpose: "image";
  draw(request: ImageRequest, signal: AbortSignal): Promise<MediaResult>;
}

export interface SpeechAdapter {
  readonly kind: string;
  readonly purpose: "speech";
  speak(request: SpeechRequest, signal: AbortSignal): Promise<MediaResult>;
}

export type MediaAdapter = ImageAdapter | SpeechAdapter;

/**
 * Read a failed response into something a reader can act on.
 *
 * Shared by every adapter here for the reason §4 gives: "request failed" tells
 * nobody whether to fix a URL, a key, or a model name.
 */
export async function failed(response: Response, what: string): Promise<AdapterError> {
  let providerMessage: string | null = null;
  try {
    const text = await response.text();
    try {
      const parsed: unknown = JSON.parse(text);
      const record = typeof parsed === "object" && parsed !== null ? parsed : {};
      const error = (record as { error?: unknown }).error;
      providerMessage =
        typeof error === "string"
          ? error
          : typeof (error as { message?: unknown })?.message === "string"
            ? String((error as { message?: unknown }).message)
            : text.slice(0, 500) || null;
    } catch {
      providerMessage = text.slice(0, 500) || null;
    }
  } catch {
    providerMessage = null;
  }
  return new AdapterError(`${what} failed with ${response.status}.`, {
    status: response.status,
    providerMessage,
    // 408, 429 and the 5xx range are worth trying again; a 400 or a 401 is not.
    retryable: response.status === 408 || response.status === 429 || response.status >= 500,
  });
}

/** Decode a base64 payload, which is how both image APIs hand back bytes. */
export function fromBase64(data: string): Uint8Array {
  return Uint8Array.from(Buffer.from(data, "base64"));
}
