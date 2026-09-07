import { failed, type ImageAdapter, type ImageRequest, type MediaResult, type MediaServiceConfig } from "./types.ts";

/**
 * Images from ComfyUI / ComfyCloud (SPEC §20 phase 79).
 *
 * ComfyUI's API is workflow-based, nothing like the OpenAI image shape: submit
 * a workflow graph, wait for it to run, then download the output. The workflow
 * lives in the service's `options.workflow` (a JSON object in API format, pasted
 * by the reader from their template), and the adapter fills two placeholders:
 * `{{prompt}}` in the positive text-encode node, and any `seed` input gets a
 * fresh draw so two portraits differ. Auth is `X-API-Key`; the output download
 * is a signed URL that must be fetched *without* the key.
 */

const DEFAULT_BASE_URL = "https://cloud.comfy.org";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface SubmitResponse {
  prompt_id?: string;
}

interface JobStatus {
  status?: string;
  error_message?: string;
  outputs?: Record<
    string,
    { images?: { filename: string; subfolder: string; type: string }[] }
  >;
}

/** The error a failed job carries, in words rather than a stack trace. */
function failureOf(status: JobStatus): string {
  const raw = status.error_message;
  if (typeof raw === "string" && raw !== "") {
    try {
      const parsed = JSON.parse(raw) as { exception_message?: string; node_type?: string };
      if (typeof parsed.exception_message === "string" && parsed.exception_message !== "") {
        const where = parsed.node_type === undefined ? "" : `${parsed.node_type}: `;
        return `${where}${parsed.exception_message.trim()}`;
      }
    } catch {
      /* Not JSON; the raw message is still the most useful thing to show. */
    }
    return raw.slice(0, 300);
  }
  return "The workflow failed.";
}

/** Inject the prompt and a fresh seed into a workflow in API format. */
function inject(workflow: Record<string, unknown>, prompt: string): Record<string, unknown> {
  const seed = Math.floor(Math.random() * 2 ** 31);
  for (const node of Object.values(workflow)) {
    if (typeof node !== "object" || node === null) continue;
    const inputs = (node as { inputs?: Record<string, unknown> }).inputs;
    if (typeof inputs !== "object" || inputs === null) continue;
    for (const [key, value] of Object.entries(inputs)) {
      if (typeof value === "string") {
        if (value.includes("{{prompt}}")) {
          // The workflow keeps its own wording around the placeholder.
          inputs[key] = value.replace(/\{\{prompt\}\}/g, prompt);
        } else if (key === "prompt") {
          // A text field named `prompt` is the positive prompt whatever the
          // node is — Krea2, Flux, etc. Replace it outright.
          inputs[key] = prompt;
        }
      }
      // A sampler's seed is a number; rolling it is what makes two portraits
      // differ rather than two identical cards.
      if (key === "seed") inputs[key] = seed;
    }
  }
  return workflow;
}

export function comfyuiAdapter(config: MediaServiceConfig): ImageAdapter {
  const doFetch = config.fetch ?? globalThis.fetch;
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const apiKey = config.apiKey ?? "";

  function headers(): Record<string, string> {
    return { "Content-Type": "application/json", "X-API-Key": apiKey };
  }

  function workflowFor(prompt: string): Record<string, unknown> {
    const raw = config.options["workflow"];
    if (typeof raw !== "string" || raw.trim() === "") {
      throw new Error("No workflow is set for this service. Paste one in the service's settings.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("The workflow is not valid JSON.");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("The workflow must be a JSON object.");
    }
    return inject(parsed as Record<string, unknown>, prompt);
  }

  return {
    kind: "comfyui",
    purpose: "image",
    async draw(request: ImageRequest, signal: AbortSignal): Promise<MediaResult> {
      const workflow = workflowFor(request.prompt);

      const submitted = await doFetch(`${baseUrl}/api/prompt`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ prompt: workflow }),
        signal,
      });
      if (!submitted.ok) throw await failed(submitted, "Submitting the workflow");
      const promptId = ((await submitted.json()) as SubmitResponse).prompt_id;
      if (typeof promptId !== "string" || promptId === "") {
        throw new Error("The service returned no job id.");
      }

      // Poll. ComfyUI reports completion through a websocket too, but polling
      // the job status is the one path that works without a second protocol.
      const deadline = Date.now() + 120_000;
      let status: JobStatus = {};
      for (;;) {
        if (signal.aborted) throw new Error("Cancelled.");
        await sleep(1_500);
        const response = await doFetch(`${baseUrl}/api/job/${promptId}/status`, {
          headers: headers(),
          signal,
        });
        if (!response.ok) throw await failed(response, "Reading the job status");
        status = (await response.json()) as JobStatus;
        if (status.status === "error" || status.status === "failed") {
          throw new Error(failureOf(status));
        }
        if (status.status === "success" || status.status === "completed" || status.outputs !== undefined) {
          break;
        }
        if (Date.now() > deadline) throw new Error("Timed out waiting for the image.");
      }

      let image: { filename: string; subfolder: string; type: string } | null = null;
      for (const node of Object.values(status.outputs ?? {})) {
        for (const candidate of node?.images ?? []) {
          image = candidate;
          break;
        }
        if (image !== null) break;
      }
      if (image === null) throw new Error("The workflow finished with no image.");

      // The view endpoint 302s to a signed URL. Fetch it without the key — the
      // redirect target is storage, and the key must not go there.
      const view = await doFetch(
        `${baseUrl}/api/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder)}&type=${encodeURIComponent(image.type)}`,
        { headers: headers(), redirect: "manual", signal },
      );
      const location = view.headers.get("location");
      if (location !== null) {
        const file = await doFetch(location, { signal });
        if (!file.ok) throw await failed(file, "Downloading the image");
        return { bytes: new Uint8Array(await file.arrayBuffer()), mime: "image/png" };
      }
      return { bytes: new Uint8Array(await view.arrayBuffer()), mime: "image/png" };
    },
  };
}
