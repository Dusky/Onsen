import { afterEach, describe, expect, test } from "bun:test";
import {
  ScriptedAdapter,
  completeSetup,
  createHarness,
  tick,
  until,
  type TestHarness,
} from "./helpers.ts";
import { OPENAI_COMPATIBLE_CAPABILITIES, type Adapter } from "../server/adapters/index.ts";
import { V1_CARD, V2_CARD, charxCard, jsonBytes, pngCard } from "./card-fixtures.ts";
import { OP_KINDS, TURN_CLASSIFIER, taskKind } from "../server/tasks/registry.ts";
import { TaskRunner } from "../server/tasks/runner.ts";
import { listTaskRuns, updateTask } from "../server/db/queries/tasks.ts";
import { createEstimatingTokenizer } from "../server/prompt/index.ts";
import type { BuiltPrompt } from "../server/prompt/index.ts";
import type {
  AuthorDto,
  CharacterDto,
  ConnectionProfileDto,
  SceneDto,
  TaskDto,
  TaskRunDto,
} from "../shared/types.ts";
import type { GenerationSnapshot } from "../server/generation/service.ts";

/**
 * The background-task primitive (SPEC §7, §20 phase 11).
 *
 * One rule shapes all of it: a background task must never block or fail a
 * user-facing generation. Everything below is either that rule holding under a
 * different kind of failure, or the consequence of it — because every failure
 * is swallowed on purpose, every run has to be readable somewhere afterwards.
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

async function importCharacter(t: TestHarness, bytes: Uint8Array, filename: string) {
  const form = new FormData();
  form.append("file", new File([bytes as unknown as BlobPart], filename));
  const body = (await (
    await t.fetch("/api/characters/import", { method: "POST", body: form })
  ).json()) as { character: CharacterDto };
  return body.character;
}

/** A scene whose turn director is the classifier — the one task that exists. */
async function classifierScene(t: TestHarness) {
  const author = await json<AuthorDto>(t, "POST", "/api/authors", { name: "Kestrel" });
  const characters = [
    await importCharacter(t, pngCard({ chara: V2_CARD }), "bell.png"),
    await importCharacter(t, jsonBytes(V1_CARD), "aldan.json"),
    await importCharacter(
      t,
      charxCard({ ...V2_CARD, data: { ...V2_CARD.data, name: "Mira Vance" } }),
      "mira.charx",
    ),
  ];
  const profiles = await json<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
  const created = await json<SceneDto>(t, "POST", "/api/scenes", {
    title: "Ridge station",
    connectionProfileId: profiles[0]!.id,
  });
  await json<SceneDto>(t, "PATCH", `/api/scenes/${created.id}`, {
    authorId: author.id,
    turnStrategy: "classifier",
  });
  for (const character of characters) {
    await json<SceneDto>(t, "PUT", `/api/scenes/${created.id}/cast/${character.id}`);
  }
  await json(t, "POST", `/api/scenes/${created.id}/messages`, {
    kind: "user",
    authorType: "user",
    content: "Has anyone counted the lamp oil?",
  });
  return { sceneId: created.id, profiles };
}

async function generate(t: TestHarness, sceneId: string): Promise<GenerationSnapshot> {
  const started = await json<GenerationSnapshot>(t, "POST", `/api/scenes/${sceneId}/generate`, {});
  await adapter.started;
  adapter.push("A line of prose.");
  adapter.end();
  await until(() => t.generation.get(started.id)?.status === "complete");
  return t.generation.get(started.id)!;
}

/** A prompt shaped like one, for driving the runner directly. */
function somePrompt(text = "Answer with one word."): BuiltPrompt {
  const tokenizer = createEstimatingTokenizer();
  return {
    system: "You answer briefly.",
    messages: [{ role: "user", content: text }],
    outlets: {},
    debug: {
      mode: "author",
      tokensAreEstimated: true,
      tokenizerId: tokenizer.id,
      budget: 100,
      reservedForResponse: 0,
      available: 100,
      fixedTokens: 0,
      historyTokens: 0,
      totalTokens: tokenizer.count(text),
      headroom: 0,
      blocks: [],
      evicted: [],
      historyIncluded: [],
      unresolvedOutlets: [],
      unknownMacros: [],
    },
  };
}

/* ------------------------------------------------------------------ */
/* The rule                                                            */
/* ------------------------------------------------------------------ */

describe("a side call never fails the turn", () => {
  test("an unreachable model", async () => {
    const t = await signedIn();
    const { sceneId } = await classifierScene(t);
    adapter.taskFails = true;

    const snapshot = await generate(t, sceneId);
    adapter.taskFails = false;

    expect(snapshot.status).toBe("complete");
    expect(snapshot.buffer).toBe("A line of prose.");
  });

  test("a task turned off", async () => {
    const t = await signedIn();
    const { sceneId } = await classifierScene(t);
    adapter.taskReply = "SPEAKER: Mira Vance\nWHY: She was addressed.";

    await json<TaskDto>(t, "PATCH", `/api/tasks/${TURN_CLASSIFIER}`, { enabled: false });
    const snapshot = await generate(t, sceneId);

    expect(snapshot.status).toBe("complete");
    // The director specifically: several other side calls follow a turn.
    expect(adapter.callsLabelled("Classifier")).toBe(0);
    expect(snapshot.director!.reason).toBe("Round robin — the classifier is turned off");
  });

  test("a run that produced nothing at all", async () => {
    const t = await signedIn();
    const { sceneId } = await classifierScene(t);
    adapter.taskReply = "";

    const snapshot = await generate(t, sceneId);
    expect(snapshot.status).toBe("complete");
    expect(snapshot.director!.reason).toContain("the classifier answered with nothing");
  });

  test("the runner itself returns a named failure rather than throwing", async () => {
    const t = await signedIn();
    adapter.taskFails = true;
    const outcome = await t.tasks.run({
      kind: taskKind(TURN_CLASSIFIER)!,
      sceneId: null,
      prompt: { ...somePrompt(), debug: { ...somePrompt().debug, blocks: [
        { id: "system_prompt", label: "x", source: "turn director", role: "system",
          content: "x", placement: { kind: "prefix" }, tokens: 1 },
      ] } },
      fallbackProfileId: null,
      profileId: profileIdOf(t),
    });
    adapter.taskFails = false;

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.status).toBe("failed");
      expect(outcome.detail).toContain("unreachable");
    }
  });

  test("no model to run on is a failure, not a crash", async () => {
    const t = await signedIn();
    const outcome = await t.tasks.run({
      kind: taskKind(TURN_CLASSIFIER)!,
      sceneId: null,
      prompt: somePrompt(),
      fallbackProfileId: null,
    });
    expect(outcome).toMatchObject({ ok: false, status: "failed" });
    if (!outcome.ok) expect(outcome.detail).toContain("no connection profile");
  });
});

function profileIdOf(t: TestHarness): number {
  const row = t.ctx.db.query("SELECT id FROM connection_profiles LIMIT 1").get() as { id: number };
  return row.id;
}

/* ------------------------------------------------------------------ */
/* The log                                                             */
/* ------------------------------------------------------------------ */

describe("every run is readable afterwards", () => {
  test("a successful run records what was asked and what came back", async () => {
    const t = await signedIn();
    const { sceneId } = await classifierScene(t);
    adapter.taskReply = "SPEAKER: Mira Vance\nWHY: She was already halfway out.";
    await generate(t, sceneId);

    const runs = await json<TaskRunDto[]>(t, "GET", `/api/tasks/${TURN_CLASSIFIER}/runs`);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "ok", sceneId, taskKey: TURN_CLASSIFIER });
    expect(runs[0]!.prompt).toContain("Who is available:");
    expect(runs[0]!.output).toContain("Mira Vance");
    expect(runs[0]!.model).not.toBeNull();
  });

  test("a failure is recorded with a reason a person can read", async () => {
    const t = await signedIn();
    const { sceneId } = await classifierScene(t);
    adapter.taskFails = true;
    await generate(t, sceneId);
    adapter.taskFails = false;

    const runs = await json<TaskRunDto[]>(t, "GET", `/api/tasks/${TURN_CLASSIFIER}/runs`);
    expect(runs[0]).toMatchObject({ status: "failed" });
    expect(runs[0]!.detail).toContain("unreachable");
  });

  test("an answer that could not be used is told apart from a failure", async () => {
    const t = await signedIn();
    const { sceneId } = await classifierScene(t);
    adapter.taskReply = "I'm afraid I can't help with that.";
    await generate(t, sceneId);

    const runs = await json<TaskRunDto[]>(t, "GET", `/api/tasks/${TURN_CLASSIFIER}/runs`);
    // "The model said no" and "the model was unreachable" are different
    // problems, and only one of them is worth changing a model over.
    expect(runs[0]).toMatchObject({ status: "unusable" });
    expect(runs[0]!.output).toContain("can't help");
  });

  test("a call that was not worth making is recorded as skipped", async () => {
    const t = await signedIn();
    const { sceneId, profiles } = await classifierScene(t);
    adapter.taskReply = "SPEAKER: Mira Vance\nWHY: Because.";

    // Cueing somebody leaves nothing to ask about.
    const scene = await json<{ scene: SceneDto }>(t, "GET", `/api/scenes/${sceneId}`);
    const started = await json<GenerationSnapshot>(t, "POST", `/api/scenes/${sceneId}/generate`, {
      characterId: scene.scene.cast[0]!.characterId,
      connectionProfileId: profiles[0]!.id,
    });
    await adapter.started;
    adapter.push("Fine.");
    adapter.end();
    await until(() => t.generation.get(started.id)?.status === "complete");

    const runs = await json<TaskRunDto[]>(t, "GET", `/api/tasks/${TURN_CLASSIFIER}/runs`);
    expect(runs[0]).toMatchObject({ status: "skipped" });
    expect(runs[0]!.detail).toContain("only one turn this could be");
  });

  test("the log stays bounded rather than growing with the scene", async () => {
    const t = await signedIn();
    const runner = new TaskRunner({ db: t.ctx.db, keyring: t.ctx.keyring });
    for (let i = 0; i < 60; i++) {
      runner.noteSkipped(
        { kind: taskKind(TURN_CLASSIFIER)!, sceneId: null, fallbackProfileId: null },
        `run ${i}`,
      );
    }
    expect(listTaskRuns(t.ctx.db, TURN_CLASSIFIER, 200)).toHaveLength(50);
  });
});

/* ------------------------------------------------------------------ */
/* The two bounds                                                      */
/* ------------------------------------------------------------------ */

/** An adapter whose reply a test releases by hand. */
function blockingAdapter(): { adapter: Adapter; entered: Promise<void>; release(): void } {
  let markEntered!: () => void;
  const entered = new Promise<void>((resolve) => (markEntered = resolve));
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  return {
    entered,
    release,
    adapter: {
      kind: "blocking",
      capabilities: OPENAI_COMPATIBLE_CAPABILITIES,
      async *generate(_prompt, _settings, signal) {
        markEntered();
        await Promise.race([
          released,
          new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve())),
        ]);
        if (signal.aborted) return;
        yield { text: "done" };
      },
    },
  };
}

describe("what stops a side call running away", () => {
  test("a timeout ends it, and says that is what happened", async () => {
    const t = await signedIn();
    const kind = taskKind(TURN_CLASSIFIER)!;
    updateTask(t.ctx.db, kind, { timeoutMs: 60 });

    const blocking = blockingAdapter();
    const runner = new TaskRunner({
      db: t.ctx.db,
      keyring: t.ctx.keyring,
      createAdapter: () => blocking.adapter,
    });
    const outcome = await runner.run({
      kind,
      sceneId: null,
      prompt: somePrompt(),
      fallbackProfileId: profileIdOf(t),
    });

    expect(outcome).toMatchObject({ ok: false, status: "timeout" });
    // Told apart from an unreachable model in the log, because they are
    // different problems: one is the model, the other is the machine.
    expect(listTaskRuns(t.ctx.db, TURN_CLASSIFIER)[0]).toMatchObject({ status: "timeout" });
    blocking.release();
  });

  test("only so many run at once", async () => {
    const t = await signedIn();
    const kind = taskKind(TURN_CLASSIFIER)!;
    const first = blockingAdapter();
    const second = blockingAdapter();
    let handed = 0;

    const runner = new TaskRunner({
      db: t.ctx.db,
      keyring: t.ctx.keyring,
      concurrency: 1,
      createAdapter: () => (handed++ === 0 ? first.adapter : second.adapter),
    });
    const request = {
      kind,
      sceneId: null,
      prompt: somePrompt(),
      fallbackProfileId: profileIdOf(t),
    };

    const a = runner.run(request);
    const b = runner.run(request);
    await first.entered;

    // A post-generation pipeline over a beat's segments is a dozen requests
    // from one turn; the cap is what stops that saturating a local model.
    await tick();
    expect(handed).toBe(1);

    first.release();
    await a;
    await second.entered;
    expect(handed).toBe(2);
    second.release();
    await b;
  });

  test("shutting down stops admitting work", async () => {
    const t = await signedIn();
    const runner = new TaskRunner({ db: t.ctx.db, keyring: t.ctx.keyring });
    runner.shutdown();

    const outcome = await runner.run({
      kind: taskKind(TURN_CLASSIFIER)!,
      sceneId: null,
      prompt: somePrompt(),
      fallbackProfileId: profileIdOf(t),
    });
    expect(outcome).toMatchObject({ ok: false, status: "cancelled" });
  });
});

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

describe("configuring a task", () => {
  test("lists every kind the code knows, configured or not", async () => {
    const t = await signedIn();
    const tasks = await json<TaskDto[]>(t, "GET", "/api/tasks");
    expect(tasks.map((task) => task.key)).toEqual(OP_KINDS.map((kind) => kind.key));
    expect(tasks[0]).toMatchObject({
      key: TURN_CLASSIFIER,
      stage: "pre_generation",
      enabled: true,
      connectionProfileId: null,
      promptTemplate: null,
    });
  });

  test("can be pointed at a different model, and back", async () => {
    const t = await signedIn();
    const profiles = await json<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");

    const pointed = await json<TaskDto>(t, "PATCH", `/api/tasks/${TURN_CLASSIFIER}`, {
      connectionProfileId: profiles[0]!.id,
    });
    expect(pointed.connectionProfileId).toBe(profiles[0]!.id);

    const cleared = await json<TaskDto>(t, "PATCH", `/api/tasks/${TURN_CLASSIFIER}`, {
      connectionProfileId: null,
    });
    expect(cleared.connectionProfileId).toBeNull();
  });

  test("an empty prompt override means the built-in, not an empty prompt", async () => {
    const t = await signedIn();
    const blanked = await json<TaskDto>(t, "PATCH", `/api/tasks/${TURN_CLASSIFIER}`, {
      promptTemplate: "   ",
    });
    expect(blanked.promptTemplate).toBeNull();
  });

  test("rejects an unknown task and an unknown profile", async () => {
    const t = await signedIn();
    expect(await statusOf(t, "PATCH", "/api/tasks/nope", { enabled: false })).toBe(404);
    expect(await statusOf(t, "GET", "/api/tasks/nope/runs")).toBe(404);
    expect(
      await statusOf(t, "PATCH", `/api/tasks/${TURN_CLASSIFIER}`, { connectionProfileId: "NOPE" }),
    ).toBe(400);
  });

  test("the scene's own choice of model beats the task's", async () => {
    const t = await signedIn();
    const { sceneId, profiles } = await classifierScene(t);
    // Both point at the same fixture, so what is asserted is the order the
    // runner resolves them in, not which provider answered.
    await json<TaskDto>(t, "PATCH", `/api/tasks/${TURN_CLASSIFIER}`, {
      connectionProfileId: profiles[0]!.id,
    });
    await json<SceneDto>(t, "PATCH", `/api/scenes/${sceneId}`, {
      directorProfileId: profiles[0]!.id,
    });

    adapter.taskReply = "SPEAKER: Mira Vance\nWHY: Because.";
    const snapshot = await generate(t, sceneId);
    expect(snapshot.director!.reason).toBe("Because.");
  });

  test("requires a session", async () => {
    const t = await signedIn();
    const cookie = t.cookie;
    t.cookie = null;
    expect((await t.fetch("/api/tasks")).status).toBe(401);
    t.cookie = cookie;
  });
});
