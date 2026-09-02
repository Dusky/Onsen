import { afterEach, describe, expect, test } from "bun:test";
import { completeSetup, createHarness, type TestHarness } from "./helpers.ts";
import { fetchProviderModels } from "../server/adapters/models.ts";

/**
 * Pulling a provider's model list from its own API (SPEC §16).
 *
 * The endpoints differ by backend, so the parser is the thing under test: the
 * same normalisation SillyTavern's backends do, reduced to the shapes our
 * providers actually speak.
 */

let harness: TestHarness | null = null;
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  harness?.cleanup();
  harness = null;
});

function stubFetch(reply: unknown, status = 200): void {
  globalThis.fetch = (async () => new Response(JSON.stringify(reply), {
    status,
    headers: { "Content-Type": "application/json" },
  })) as typeof fetch;
}

describe("fetchProviderModels", () => {
  test("normalises the OpenAI shape and dedupes", async () => {
    stubFetch({ data: [{ id: "b" }, { id: "a" }, { id: "a" }] });
    expect(await fetchProviderModels({ baseUrl: "http://x/v1", apiKey: null })).toEqual(["a", "b"]);
  });

  test("normalises the Ollama shape", async () => {
    stubFetch({ models: [{ name: "llama3:latest" }, { name: "mistral" }] });
    expect(await fetchProviderModels({ baseUrl: "http://localhost:11434", apiKey: null })).toEqual([
      "llama3:latest",
      "mistral",
    ]);
  });

  test("returns null when no endpoint answers", async () => {
    globalThis.fetch = (async () => new Response("nope", { status: 404 })) as typeof fetch;
    expect(await fetchProviderModels({ baseUrl: "http://x", apiKey: null })).toBeNull();
  });
});

describe("the models route", () => {
  test("returns a provider's models", async () => {
    harness = createHarness();
    await completeSetup(harness);
    stubFetch({ data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }] });

    const response = await harness.fetch("/api/connections/providers/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseUrl: "http://x/v1" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ models: ["gpt-4o", "gpt-4o-mini"] });
  });

  test("reports an unreachable provider", async () => {
    harness = createHarness();
    await completeSetup(harness);
    globalThis.fetch = (async () => new Response("nope", { status: 404 })) as typeof fetch;

    const response = await harness.fetch("/api/connections/providers/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseUrl: "http://x" }),
    });
    expect(response.status).toBe(502);
  });
});
