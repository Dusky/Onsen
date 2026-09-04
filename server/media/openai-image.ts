import { failed, fromBase64, type ImageAdapter, type ImageRequest, type MediaResult, type MediaServiceConfig } from "./types.ts";

/**
 * Images from an OpenAI-shaped endpoint: `POST /v1/images/generations`.
 *
 * The same reasoning §4 gives for the text adapter applies here — this one
 * shape reaches OpenAI itself and every local or hosted service that chose to
 * emulate it, which is most of them.
 */

const DEFAULT_SIZE = "1024x1024";

function sizeOf(request: ImageRequest, options: Record<string, unknown>): string {
  if (request.width !== undefined && request.height !== undefined) {
    return `${request.width}x${request.height}`;
  }
  const configured = options["size"];
  return typeof configured === "string" && /^\d+x\d+$/.test(configured) ? configured : DEFAULT_SIZE;
}

interface ImagesResponse {
  data?: { b64_json?: string | null; url?: string | null }[];
}

export function openaiImageAdapter(config: MediaServiceConfig): ImageAdapter {
  const doFetch = config.fetch ?? globalThis.fetch;
  return {
    kind: "openai",
    purpose: "image",
    async draw(request: ImageRequest, signal: AbortSignal): Promise<MediaResult> {
      const size = sizeOf(request, config.options);
      const body: Record<string, unknown> = {
        prompt: request.prompt,
        n: 1,
        size,
        // Asking for bytes rather than a URL keeps the picture inside this
        // server. A URL would mean the browser fetching from the provider,
        // which leaks who is looking at what and expires without warning.
        response_format: "b64_json",
      };
      if (config.model !== null && config.model !== "") body["model"] = config.model;
      const quality = config.options["quality"];
      if (typeof quality === "string" && quality !== "") body["quality"] = quality;

      const response = await doFetch(`${config.baseUrl.replace(/\/+$/, "")}/images/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.apiKey === null ? {} : { Authorization: `Bearer ${config.apiKey}` }),
        },
        body: JSON.stringify(body),
        // §4's rule, and it matters more here: a leaked image request keeps a
        // GPU busy for a minute rather than a moment.
        signal,
      });
      if (!response.ok) throw await failed(response, "Drawing");

      const parsed = (await response.json()) as ImagesResponse;
      const first = parsed.data?.[0];
      const encoded = first?.b64_json;
      if (typeof encoded !== "string" || encoded === "") {
        // A service that ignored response_format and sent a URL lands here.
        // Saying which is more useful than saying "no image".
        throw new Error(
          typeof first?.url === "string"
            ? "The service returned a link rather than the image itself."
            : "The service returned no image.",
        );
      }
      const [width, height] = size.split("x").map(Number);
      return {
        bytes: fromBase64(encoded),
        mime: "image/png",
        ...(Number.isFinite(width) ? { width: width as number } : {}),
        ...(Number.isFinite(height) ? { height: height as number } : {}),
      };
    },
  };
}
