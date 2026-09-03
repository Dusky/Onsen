import { afterEach, describe, expect, test } from "bun:test";
import { ScriptedAdapter, completeSetup, createHarness, until, type TestHarness } from "./helpers.ts";
import { V2_CARD, pngCard } from "./card-fixtures.ts";
import type {
  CharacterDto,
  ConnectionProfileDto,
  MemoryEntityDto,
  PromptInspectorDto,
  SceneDto,
} from "../shared/types.ts";

/**
 * Narrative memory through the real system (SPEC §11 layer 3, §20 phase 38).
 *
 * Two properties carry the feature. Extraction has to land in a graph that
 * accumulates rather than replaces — the window is a dozen turns and the memory
 * is the whole story. And a reader's edit has to survive every extraction after
 * it, or every correction is provisional and the feature is not safe to leave
 * running.
 */

let harness: TestHarness | null = null;
let adapter: ScriptedAdapter;

async function signedIn(): Promise<TestHarness> {
  if (harness === null) {
    adapter = new ScriptedAdapter();
    harness = createHarness({ adapter });
    await completeSetup(harness);
  }
  return harness;
}

afterEach(() => {
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

async function statusOf(t: TestHarness, method: string, path: string, body?: unknown) {
  const response = await t.fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  return response.status;
}

async function scene(t: TestHarness): Promise<string> {
  const form = new FormData();
  form.append("file", new File([pngCard({ chara: V2_CARD }) as unknown as BlobPart], "bell.png"));
  const { character } = (await (
    await t.fetch("/api/characters/import", { method: "POST", body: form })
  ).json()) as { character: CharacterDto };
  const profiles = await json<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
  const created = await json<SceneDto>(t, "POST", "/api/scenes", {
    title: "The pass",
    connectionProfileId: profiles[0]!.id,
  });
  await json<SceneDto>(t, "PUT", `/api/scenes/${created.id}/cast/${character.id}`);
  for (const line of ["Hollis poured without being asked.", "The pass is closed until spring."]) {
    await json(t, "POST", `/api/scenes/${created.id}/messages`, {
      kind: "user",
      authorType: "user",
      content: line,
    });
  }
  return created.id;
}

/** The extractor's answer, for the side call the runner makes. */
function extractionOf(entities: unknown[], relations: unknown[] = []): string {
  return JSON.stringify({ entities, relations });
}

async function enable(t: TestHarness, sceneId: string) {
  return json<{ enabled: boolean }>(t, "PATCH", `/api/memory/scenes/${sceneId}`, {
    enabled: true,
  });
}

function entities(t: TestHarness, sceneId: string) {
  return json<{ enabled: boolean; entities: MemoryEntityDto[] }>(
    t,
    "GET",
    `/api/memory/scenes/${sceneId}`,
  );
}

describe("switching it on", () => {
  test("is off until asked for, and extraction is refused until then", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    expect((await entities(t, sceneId)).enabled).toBe(false);
    // §11 puts this third and says to build it last; it costs a model call per
    // turn, so a scene that did not ask does not pay.
    expect(await statusOf(t, "POST", `/api/memory/scenes/${sceneId}/extract`, {})).toBe(400);

    await enable(t, sceneId);
    expect((await entities(t, sceneId)).enabled).toBe(true);
  });
});

describe("extraction", () => {
  test("lands entities and the relations between them", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    await enable(t, sceneId);

    adapter.taskReply = extractionOf(
      [
        {
          kind: "person",
          name: "Hollis",
          content: "Keeps the inn at the pass.",
          salience: { emotional: 0.6, narrative: 0.9, density: 0.5 },
        },
        { kind: "place", name: "The pass", content: "Closed until spring.", salience: 0.7 },
      ],
      [{ from: "Hollis", to: "The pass", kind: "keeps the road to", salience: 0.5 }],
    );
    await json(t, "POST", `/api/memory/scenes/${sceneId}/extract`, {});

    const stored = await entities(t, sceneId);
    expect(stored.entities.map((entity) => entity.name).sort()).toEqual(["Hollis", "The pass"]);
    const hollis = stored.entities.find((entity) => entity.name === "Hollis")!;
    expect(hollis.kind).toBe("person");
    expect(hollis.salience).toBeGreaterThan(0.6);
    expect(hollis.links[0]).toContain("keeps the road to");
  });

  test("accumulates rather than replaces", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    await enable(t, sceneId);

    adapter.taskReply = extractionOf([{ kind: "person", name: "Hollis", content: "The keeper." }]);
    await json(t, "POST", `/api/memory/scenes/${sceneId}/extract`, {});

    // A later window that never mentions Hollis must not lose her: the window
    // is a dozen turns and the memory is the whole story.
    adapter.taskReply = extractionOf([{ kind: "fact", name: "The bribe", content: "Taken in autumn." }]);
    await json(t, "POST", `/api/memory/scenes/${sceneId}/extract`, {});

    const stored = await entities(t, sceneId);
    expect(stored.entities.map((entity) => entity.name).sort()).toEqual(["Hollis", "The bribe"]);
  });

  test("salience is the higher of the two, not the latest", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    await enable(t, sceneId);

    adapter.taskReply = extractionOf([{ kind: "event", name: "The storm", salience: 0.9 }]);
    await json(t, "POST", `/api/memory/scenes/${sceneId}/extract`, {});
    // Mentioned in passing later. A thing that mattered once does not stop
    // having mattered; decay is what lowers a score, not a quiet turn.
    adapter.taskReply = extractionOf([{ kind: "event", name: "The storm", salience: 0.1 }]);
    await json(t, "POST", `/api/memory/scenes/${sceneId}/extract`, {});

    const stored = await entities(t, sceneId);
    expect(stored.entities[0]?.salience).toBe(0.9);
  });

  test("a reply it cannot read changes nothing", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    await enable(t, sceneId);
    adapter.taskReply = extractionOf([{ kind: "person", name: "Hollis" }]);
    await json(t, "POST", `/api/memory/scenes/${sceneId}/extract`, {});

    adapter.taskReply = "I'm sorry, I can't help with that.";
    await json(t, "POST", `/api/memory/scenes/${sceneId}/extract`, {});

    expect((await entities(t, sceneId)).entities).toHaveLength(1);
  });

  test("a relation naming something not extracted is dropped, not stored broken", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    await enable(t, sceneId);
    adapter.taskReply = extractionOf(
      [{ kind: "person", name: "Hollis" }],
      [{ from: "Hollis", to: "Someone nobody mentioned", kind: "owes money to" }],
    );
    await json(t, "POST", `/api/memory/scenes/${sceneId}/extract`, {});

    const stored = await entities(t, sceneId);
    expect(stored.entities).toHaveLength(1);
    expect(stored.entities[0]?.links).toEqual([]);
  });
});

describe("a reader's edit", () => {
  test("is never overwritten by extraction", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    await enable(t, sceneId);

    adapter.taskReply = extractionOf([
      { kind: "person", name: "Hollis", content: "The keeper.", salience: 0.4 },
    ]);
    await json(t, "POST", `/api/memory/scenes/${sceneId}/extract`, {});
    const before = (await entities(t, sceneId)).entities[0]!;
    expect(before.userEdited).toBe(false);

    await json(t, "PATCH", `/api/memory/entities/${before.id}`, {
      content: "She took the bribe and has not slept since.",
      salience: 0.95,
    });

    // The same extraction again, with a different story. §11's rule is what
    // makes every correction permanent rather than provisional.
    adapter.taskReply = extractionOf([
      { kind: "person", name: "Hollis", content: "A minor innkeeper.", salience: 0.1 },
    ]);
    await json(t, "POST", `/api/memory/scenes/${sceneId}/extract`, {});

    const after = (await entities(t, sceneId)).entities[0]!;
    expect(after.content).toBe("She took the bribe and has not slept since.");
    expect(after.salience).toBe(0.95);
    expect(after.userEdited).toBe(true);
  });

  test("editing is what protects it — there is no flag to forget", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    await enable(t, sceneId);
    adapter.taskReply = extractionOf([{ kind: "fact", name: "The bribe" }]);
    await json(t, "POST", `/api/memory/scenes/${sceneId}/extract`, {});

    const entity = (await entities(t, sceneId)).entities[0]!;
    // No `userEdited` in the request; the act of editing sets it.
    await json(t, "PATCH", `/api/memory/entities/${entity.id}`, { content: "Autumn." });
    expect((await entities(t, sceneId)).entities[0]?.userEdited).toBe(true);
  });

  test("deleting removes it", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    await enable(t, sceneId);
    adapter.taskReply = extractionOf([{ kind: "fact", name: "The bribe" }]);
    await json(t, "POST", `/api/memory/scenes/${sceneId}/extract`, {});
    const entity = (await entities(t, sceneId)).entities[0]!;
    await t.fetch(`/api/memory/entities/${entity.id}`, { method: "DELETE" });
    expect((await entities(t, sceneId)).entities).toHaveLength(0);
  });
});

describe("recall", () => {
  test("reaches the prompt, and the inspector says why", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    await enable(t, sceneId);

    adapter.taskReply = extractionOf([
      {
        kind: "fact",
        name: "The bribe",
        content: "Hollis took money to keep the pass closed.",
        salience: 0.9,
      },
    ]);
    await json(t, "POST", `/api/memory/scenes/${sceneId}/extract`, {});
    adapter.taskReply = null;

    await json(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "Ask her about the bribe.",
    });

    const before = adapter.prompts.length;
    const snapshot = await json<{ id: string }>(t, "POST", `/api/scenes/${sceneId}/generate`, {});
    await adapter.started;
    adapter.push("She looked at the door.");
    adapter.end();
    await until(() => t.generation.get(snapshot.id)?.status === "complete");

    const sent = JSON.stringify(adapter.prompts[before]);
    expect(sent).toContain("Hollis took money to keep the pass closed");

    // §11 asks for a full retrieval trace: what was recalled, its score, why.
    const path = await json<{ id: string }[]>(t, "GET", `/api/scenes/${sceneId}/messages`);
    const landed = path.at(-1)!.id;
    const inspector = await json<PromptInspectorDto>(
      t,
      "GET",
      `/api/scenes/${sceneId}/inspector/${landed}`,
    );
    const trace = inspector.debug.memoryTrace;
    expect(trace).toHaveLength(1);
    expect(trace[0]?.name).toBe("The bribe");
    expect(trace[0]?.score).toBeGreaterThan(0);
    // The two halves of the blend are kept apart, because "it scored 0.7"
    // answers nothing.
    expect(trace[0]?.similarity).toBeGreaterThan(0);
    expect(trace[0]?.salience).toBe(0.9);
  });

  test("a scene with memory off recalls nothing and costs nothing", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    // Never switched on, so there is nothing to recall even in principle.
    const before = adapter.prompts.length;
    const snapshot = await json<{ id: string }>(t, "POST", `/api/scenes/${sceneId}/generate`, {});
    await adapter.started;
    adapter.push("Fine.");
    adapter.end();
    await until(() => t.generation.get(snapshot.id)?.status === "complete");

    const path = await json<{ id: string }[]>(t, "GET", `/api/scenes/${sceneId}/messages`);
    const inspector = await json<PromptInspectorDto>(
      t,
      "GET",
      `/api/scenes/${sceneId}/inspector/${path.at(-1)!.id}`,
    );
    expect(inspector.debug.memoryTrace).toEqual([]);
    expect(adapter.prompts.length).toBeGreaterThan(before);
  });
});
