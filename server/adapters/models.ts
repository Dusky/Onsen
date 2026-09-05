/**
 * Fetching a provider's model list (SPEC §16's "test button", grown up).
 *
 * The same idea SillyTavern's backends use, reduced to our three kinds: try the
 * standard model endpoints in order and normalise whatever comes back into a
 * flat list of model ids. The call lives on the server because the API key is
 * encrypted at rest and never sent to the browser (§17) — the browser can only
 * ever *ask* for the list, never reach for it itself.
 */

export interface ModelListRequest {
  baseUrl: string;
  apiKey: string | null;
  /**
   * Which provider this is, where the caller knows (§20 phase 49).
   *
   * It decides how the key is presented, not which paths are tried. Anthropic
   * authenticates with `x-api-key` and a required version header rather than a
   * bearer token, so before this every Anthropic provider's fetch came back
   * 401 on every candidate and reported "no models endpoint answered" — which
   * is true, and useless.
   */
  kind?: string;
}

function parseOpenAi(body: unknown): string[] {
  if (typeof body !== "object" || body === null) return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data
    .map((entry) => (typeof entry === "object" && entry !== null ? (entry as { id?: unknown }).id : null))
    .filter((id): id is string => typeof id === "string" && id !== "")
    .map((id) => id.trim());
}

function parseOllama(body: unknown): string[] {
  if (typeof body !== "object" || body === null) return [];
  const models = (body as { models?: unknown }).models;
  if (!Array.isArray(models)) return [];
  return models
    .map((entry) => (typeof entry === "object" && entry !== null ? (entry as { name?: unknown }).name : null))
    .filter((name): name is string => typeof name === "string" && name !== "");
}

interface Candidate {
  path: string;
  parse(body: unknown): string[];
}

/** The endpoints in the order they are tried, covering every kind we ship. */
const CANDIDATES: Candidate[] = [
  { path: "/models", parse: parseOpenAi }, // OpenAI, Anthropic, vLLM, LM Studio, KoboldCpp
  { path: "/v1/models", parse: parseOpenAi }, // llama.cpp, Ollama's OpenAI shim
  { path: "/api/tags", parse: parseOllama }, // Ollama's native endpoint
  { path: "/v1/model/list", parse: parseOpenAi }, // TabbyAPI
];

/** The model ids a provider serves, or null when none of the endpoints answer. */
export async function fetchProviderModels(request: ModelListRequest): Promise<string[] | null> {
  const baseUrl = request.baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> =
    request.kind === "anthropic"
      ? {
          ...(request.apiKey === null ? {} : { "x-api-key": request.apiKey }),
          // Required on every call to this API, listing endpoint included.
          "anthropic-version": "2023-06-01",
        }
      : { ...(request.apiKey === null ? {} : { Authorization: `Bearer ${request.apiKey}` }) };

  for (const candidate of CANDIDATES) {
    try {
      const response = await fetch(`${baseUrl}${candidate.path}`, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) continue;
      const body: unknown = await response.json();
      const models = candidate.parse(body);
      if (models.length > 0) {
        return [...new Set(models)].sort((a, b) => a.localeCompare(b));
      }
    } catch {
      // This endpoint is not the shape this provider speaks; try the next.
      continue;
    }
  }
  return null;
}
