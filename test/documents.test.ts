import { afterEach, describe, expect, test } from "bun:test";
import { ScriptedAdapter, completeSetup, createHarness, until, type TestHarness } from "./helpers.ts";
import { pngCard, V2_CARD } from "./card-fixtures.ts";
import { chunkText } from "../server/documents/chunk.ts";
import { cosine } from "../server/documents/similarity.ts";
import { buildVocabulary, lexicalVector } from "../server/documents/lexical.ts";
import type {
  CharacterDto,
  ConnectionProfileDto,
  DocumentDto,
  EmbeddingsConfigDto,
  SceneDto,
  PromptInspectorDto,
} from "../shared/types.ts";

/**
 * The data bank (SPEC §11, §20 phase 30).
 *
 * The tests read the store both ways — the lexical fallback with nothing
 * configured, and the provider path with a stubbed /embeddings endpoint — and
 * then once more through a real generation, where the recalled chunks appear
 * as the prompt's documents block and the inspector's retrieval trace.
 */

let harness: TestHarness | null = null;
let adapter: ScriptedAdapter;
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  harness?.cleanup();
  harness = null;
});

async function json<T>(t: TestHarness, method: string, path: string, body?: unknown): Promise<T> {
  const response = await t.fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  return (await response.json()) as T;
}

async function signedIn(): Promise<TestHarness> {
  harness = createHarness({ adapter: (adapter = new ScriptedAdapter()) });
  await completeSetup(harness);
  return harness;
}

describe("chunking and similarity (pure)", () => {
  test("merges short paragraphs and splits long ones", () => {
    const chunks = chunkText("A short note.\n\nAnother short note.", 1_000);
    expect(chunks).toEqual(["A short note.\n\nAnother short note."]);

    const big = chunkText(`${"Sentence one. Sentence two. Sentence three. ".repeat(30)}`, 200);
    expect(big.length).toBeGreaterThan(1);
    for (const chunk of big) expect(chunk.length).toBeLessThan(400);
  });

  test("cosine ranks what the lexical vector agrees with", () => {
    const vocabulary = buildVocabulary(["the ocean tide rises", "a mountain trail climbs", "ocean waves"]);
    const ocean = lexicalVector("the ocean tide rises", vocabulary);
    const mountain = lexicalVector("a mountain trail climbs", vocabulary);
    const query = lexicalVector("ocean waves", vocabulary);
    expect(cosine(query, ocean)).toBeGreaterThan(cosine(query, mountain));
  });
});

describe("the data bank (SPEC §11)", () => {
  test("lexical fallback recalls the document that shares words", async () => {
    const t = await signedIn();
    await json<DocumentDto>(t, "POST", "/api/documents", {
      title: "The ocean",
      text: "The ocean tide rises every night and floods the lower caves with salt.",
    });
    await json<DocumentDto>(t, "POST", "/api/documents", {
      title: "The mountain",
      text: "The mountain trail climbs past old pines and a dry spring.",
    });

    const chunks = await json<{ documentTitle: string; score: number }[]>(
      t,
      "POST",
      "/api/documents/retrieve",
      { query: "salt water in the caves" },
    );
    expect(chunks[0]!.documentTitle).toBe("The ocean");
    expect(chunks[0]!.score).toBeGreaterThan(0);
  });

  test("the provider path embeds through the configured endpoint", async () => {
    const t = await signedIn();
    // A provider whose fake embeddings encode "ocean" and "mountain" as axes.
    await json<EmbeddingsConfigDto>(t, "PUT", "/api/connections/embeddings", {
      baseUrl: "http://localhost:11434/v1",
      model: "nomic-embed-text",
      apiKey: null,
    });

    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      const embeddings = body.input.map((text) =>
        text.includes("ocean") ? [1, 0] : text.includes("mountain") ? [0, 1] : [0.5, 0.5],
      );
      return new Response(JSON.stringify({ data: embeddings.map((embedding) => ({ embedding })) }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await json<DocumentDto>(t, "POST", "/api/documents", {
      title: "The ocean",
      text: "The ocean tide rises.",
    });
    await json<DocumentDto>(t, "POST", "/api/documents", {
      title: "The mountain",
      text: "The mountain trail climbs.",
    });

    const chunks = await json<{ documentTitle: string; score: number }[]>(
      t,
      "POST",
      "/api/documents/retrieve",
      { query: "the ocean" },
    );
    expect(chunks[0]!.documentTitle).toBe("The ocean");
    expect(chunks[0]!.score).toBeCloseTo(1, 5);
  });

  test("a document can be deleted", async () => {
    const t = await signedIn();
    const document = await json<DocumentDto>(t, "POST", "/api/documents", {
      title: "Gone",
      text: "This will be deleted.",
    });
    expect((await t.fetch(`/api/documents/${document.id}`, { method: "DELETE" })).status).toBe(204);
    const listed = await json<DocumentDto[]>(t, "GET", "/api/documents");
    expect(listed.map((row) => row.id)).not.toContain(document.id);
  });
});

describe("documents in the prompt (SPEC §11)", () => {
  test("recalled chunks reach the documents block and the inspector", async () => {
    const t = await signedIn();
    const bell = (await (async () => {
      const form = new FormData();
      form.append("file", new File([pngCard({ chara: V2_CARD }) as unknown as BlobPart], "bell.png"));
      return (await (await t.fetch("/api/characters/import", { method: "POST", body: form })).json()) as {
        character: CharacterDto;
      };
    })()).character;
    const profiles = await json<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
    const scene = await json<SceneDto>(t, "POST", "/api/scenes", {
      title: "Ridge",
      connectionProfileId: profiles[0]!.id,
    });
    await json<SceneDto>(t, "PUT", `/api/scenes/${scene.id}/cast/${bell.id}`);
    await json<DocumentDto>(t, "POST", "/api/documents", {
      title: "The lamp oil",
      text: "The station's lamps burn cedar oil, and the reserve is running out.",
    });

    await json(t, "POST", `/api/scenes/${scene.id}/messages`, {
      kind: "user",
      authorType: "user",
      content: "Bell, what about the cedar oil?",
    });
    adapter.push("The reserve is low.");
    adapter.end();
    const generation = await json<{ id: string }>(t, "POST", `/api/scenes/${scene.id}/generate`, {});
    await until(async () => {
      const snapshot = await json<{ status: string }>(t, "GET", `/api/generations/${generation.id}`);
      return snapshot.status === "complete";
    });

    const history = await json<{ messages: { id: string }[] }>(t, "GET", `/api/scenes/${scene.id}`);
    const inspection = await json<PromptInspectorDto>(
      t,
      "GET",
      `/api/scenes/${scene.id}/inspector/${history.messages.at(-1)!.id}`,
    );
    // The recalled chunk is in the assembly and named in the trace.
    expect(inspection.debug.blocks.some((block) => block.id === "documents")).toBe(true);
    expect(inspection.debug.retrievedChunks.length).toBeGreaterThan(0);
    expect(inspection.debug.retrievedChunks[0]!.documentTitle).toBe("The lamp oil");
  });
});
