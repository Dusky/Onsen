import { describe, expect, test } from "bun:test";
import { comfyuiAdapter } from "../server/media/comfyui.ts";
import type { MediaServiceConfig } from "../server/media/types.ts";

/**
 * The ComfyUI / ComfyCloud adapter (SPEC §20 phase 79).
 *
 * ComfyUI's API is workflow-based, so the adapter submits a workflow, polls the
 * job, and downloads the output — and the workflow is the reader's, with two
 * things filled in: `{{prompt}}` in the text node, and a fresh seed so two
 * portraits differ.
 */

const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function config(fetch: typeof globalThis.fetch): MediaServiceConfig {
  return {
    baseUrl: "https://cloud.comfy.org",
    apiKey: "k",
    model: null,
    options: {
      workflow: JSON.stringify({
        "1": { class_type: "CLIPTextEncode", inputs: { text: "{{prompt}}" } },
        "2": { class_type: "KSampler", inputs: { seed: 0 } },
      }),
    },
    fetch,
  };
}

describe("the comfyui adapter", () => {
  test("submits, polls, and downloads, injecting the prompt and a seed", async () => {
    let submitted: { prompt: Record<string, unknown> } | null = null;
    let viewKey: string | null = null;
    let polled = 0;

    const stub = (async (url: string | URL, init: RequestInit | undefined) => {
      const path = String(url);
      if (path.includes("/api/prompt")) {
        submitted = JSON.parse(String(init?.body)) as { prompt: Record<string, unknown> };
        return Response.json({ prompt_id: "p1" });
      }
      if (path.includes("/api/job/p1/status")) {
        polled += 1;
        return polled < 2
          ? Response.json({ status: "running" })
          : Response.json({
              status: "success",
              outputs: { "9": { images: [{ filename: "out.png", subfolder: "", type: "output" }] } },
            });
      }
      if (path.includes("/api/view")) {
        viewKey = (init?.headers as Record<string, string> | undefined)?.["X-API-Key"] ?? null;
        return new Response(null, { status: 302, headers: { Location: "https://storage/out.png" } });
      }
      return new Response(Uint8Array.from(atob(PIXEL), (c) => c.charCodeAt(0)));
    }) as unknown as typeof globalThis.fetch;

    const adapter = comfyuiAdapter(config(stub));
    const result = await adapter.draw({ prompt: "a closed pass" }, new AbortController().signal);

    // The prompt reached the text node, and the seed was rolled.
    const textNode = (submitted!.prompt["1"] as { inputs: { text: string } }).inputs;
    expect(textNode.text).toBe("a closed pass");
    const sampler = (submitted!.prompt["2"] as { inputs: { seed: number } }).inputs;
    expect(typeof sampler.seed).toBe("number");
    expect(sampler.seed).not.toBe(0);

    // The key went to the API, and the download was fetched without it.
    expect(viewKey ?? "missing").toBe("k");
    expect(result.mime).toBe("image/png");
    expect(result.bytes.byteLength).toBeGreaterThan(0);
  });

  test("no workflow is refused before any call", async () => {
    let calls = 0;
    const stub = (async () => {
      calls += 1;
      return new Response("unexpected", { status: 500 });
    }) as unknown as typeof globalThis.fetch;

    const adapter = comfyuiAdapter({
      baseUrl: "https://cloud.comfy.org",
      apiKey: "k",
      model: null,
      options: {},
      fetch: stub,
    });
    await expect(
      adapter.draw({ prompt: "x" }, new AbortController().signal),
    ).rejects.toThrow(/No workflow/);
    expect(calls).toBe(0);
  });
});
