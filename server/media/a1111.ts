import { failed, fromBase64, type ImageAdapter, type ImageRequest, type MediaResult, type MediaServiceConfig } from "./types.ts";

/**
 * Images from AUTOMATIC1111's WebUI: `POST /sdapi/v1/txt2img`.
 *
 * Here because it is what this audience actually runs. The API predates the
 * OpenAI image shape and looks nothing like it: settings are top-level fields,
 * a negative prompt is a first-class idea rather than something folded into the
 * prompt, and the response is always base64 whether you ask or not.
 *
 * Forge, reForge and SD.Next all keep this endpoint, so one adapter covers the
 * local ecosystem the way the OpenAI one covers the hosted ecosystem.
 */

const DEFAULTS = { steps: 25, cfgScale: 7, width: 512, height: 512 };

function number(options: Record<string, unknown>, key: string, fallback: number): number {
  const value = options[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

interface Txt2ImgResponse {
  images?: string[];
}

export function a1111Adapter(config: MediaServiceConfig): ImageAdapter {
  const doFetch = config.fetch ?? globalThis.fetch;
  return {
    kind: "a1111",
    purpose: "image",
    async draw(request: ImageRequest, signal: AbortSignal): Promise<MediaResult> {
      const width = request.width ?? number(config.options, "width", DEFAULTS.width);
      const height = request.height ?? number(config.options, "height", DEFAULTS.height);
      const body: Record<string, unknown> = {
        prompt: request.prompt,
        // A1111 has a real negative prompt, so a caller's one is used rather
        // than glued onto the front of the positive one.
        negative_prompt: request.negativePrompt ?? config.options["negativePrompt"] ?? "",
        steps: number(config.options, "steps", DEFAULTS.steps),
        cfg_scale: number(config.options, "cfgScale", DEFAULTS.cfgScale),
        width,
        height,
        // No preview stream: the endpoint has one, and a half-drawn picture in
        // the middle of a story is a distraction rather than a feature.
        send_images: true,
        save_images: false,
      };
      const sampler = config.options["sampler"];
      if (typeof sampler === "string" && sampler !== "") body["sampler_name"] = sampler;
      // The model is a checkpoint here, set through an override rather than a
      // field, which is the one place this API is genuinely awkward.
      if (config.model !== null && config.model !== "") {
        body["override_settings"] = { sd_model_checkpoint: config.model };
      }

      const response = await doFetch(`${config.baseUrl.replace(/\/+$/, "")}/sdapi/v1/txt2img`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // A1111 is usually unauthenticated on a LAN, and carries an API
          // password when it is not.
          ...(config.apiKey === null ? {} : { Authorization: `Basic ${config.apiKey}` }),
        },
        body: JSON.stringify(body),
        signal,
      });
      if (!response.ok) throw await failed(response, "Drawing");

      const parsed = (await response.json()) as Txt2ImgResponse;
      const encoded = parsed.images?.[0];
      if (typeof encoded !== "string" || encoded === "") {
        throw new Error("The service returned no image.");
      }
      // A1111 sometimes prefixes a data URL and sometimes does not.
      const payload = encoded.includes(",") ? encoded.slice(encoded.indexOf(",") + 1) : encoded;
      return { bytes: fromBase64(payload), mime: "image/png", width, height };
    },
  };
}
