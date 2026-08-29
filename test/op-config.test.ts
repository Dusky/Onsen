import { afterEach, describe, expect, test } from "bun:test";
import { ScriptedAdapter, completeSetup, createHarness, until, type TestHarness } from "./helpers.ts";
import { V2_CARD, pngCard } from "./card-fixtures.ts";
import { OP_KINDS, opKind } from "../server/tasks/registry.ts";
import { TEMPLATED_OPS, defaultTemplateOf, fillTemplate } from "../server/prompt/index.ts";
import type {
  CharacterDto,
  ConnectionProfileDto,
  MessageDto,
  ProviderDto,
  SceneDto,
  TaskDto,
} from "../shared/types.ts";
import type { GenerationSnapshot } from "../server/generation/service.ts";

/**
 * Per-op configuration and connection profiles (SPEC §7, §20 phase 13).
 *
 * Two halves of one idea. Every op carries a row saying which model it runs on,
 * the words it uses, where they are injected and whether its button is shown —
 * and profiles are what "which model" points at, which until this phase you
 * could not create, so the routing that existed was unreachable.
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

async function scene(t: TestHarness) {
  const form = new FormData();
  form.append("file", new File([pngCard({ chara: V2_CARD }) as unknown as BlobPart], "bell.png"));
  const { character } = (await (
    await t.fetch("/api/characters/import", { method: "POST", body: form })
  ).json()) as { character: CharacterDto };

  const profiles = await json<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
  const created = await json<SceneDto>(t, "POST", "/api/scenes", {
    title: "Ridge station",
    connectionProfileId: profiles[0]!.id,
  });
  await json<SceneDto>(t, "PUT", `/api/scenes/${created.id}/cast/${character.id}`);
  await json(t, "POST", `/api/scenes/${created.id}/messages`, {
    kind: "user",
    authorType: "user",
    content: "Anyone there?",
  });
  return { sceneId: created.id, profiles };
}

async function run(t: TestHarness, path: string, body: unknown, output = "Ok.") {
  const started = await json<GenerationSnapshot>(t, "POST", path, body);
  await adapter.started;
  adapter.push(output);
  adapter.end();
  await until(() => t.generation.get(started.id)?.status === "complete");
}

function lastTurnPrompt() {
  return adapter.prompts.filter((prompt) => prompt.debug.blocks.length > 2).at(-1)!;
}

function block(label: string) {
  return lastTurnPrompt().debug.blocks.find((b) => b.label === label);
}

/* ------------------------------------------------------------------ */
/* The registry and its templates                                      */
/* ------------------------------------------------------------------ */

describe("the op registry", () => {
  test("every op with a template is in the registry, and every key agrees", () => {
    // The templates live under /prompt and duplicate the keys deliberately, so
    // the two lists have to be checked against each other rather than trusted.
    for (const key of TEMPLATED_OPS) {
      expect(opKind(key), `${key} has a template but no registry entry`).not.toBeNull();
    }
    for (const kind of OP_KINDS) {
      if (kind.runs !== "turn") continue;
      expect(defaultTemplateOf(kind.key), `${kind.key} is a turn op with no words`).not.toBe("");
    }
  });

  test("every variable an op declares appears in its own template", () => {
    for (const kind of OP_KINDS) {
      if (kind.runs !== "turn") continue;
      const template = defaultTemplateOf(kind.key);
      for (const variable of kind.variables) {
        expect(template, `${kind.key} declares {{${variable}}} but never uses it`).toContain(
          `{{${variable}}}`,
        );
      }
    }
  });

  test("filling leaves unknown macros alone for the ordinary pass", () => {
    // A macro deleted here would never reach the engine that knows it.
    expect(fillTemplate("{{char}} said {{input}}", { input: "no" })).toBe("{{char}} said no");
  });
});

/* ------------------------------------------------------------------ */
/* Overriding an op's words                                            */
/* ------------------------------------------------------------------ */

describe("overriding the words an op uses", () => {
  test("a nudge can be wrapped in a frame the model reads better", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await json<TaskDto>(t, "PATCH", "/api/tasks/nudge", {
      promptTemplate: "A note from the director: {{input}}",
    });

    await run(t, `/api/scenes/${sceneId}/generate`, { nudge: "slow down" });
    expect(block("Nudge")!.content).toBe("A note from the director: slow down");
  });

  test("an expand override replaces the instruction but never the user-lock", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await run(t, `/api/scenes/${sceneId}/generate`, {});
    const target = (await json<MessageDto[]>(t, "GET", `/api/scenes/${sceneId}/messages`)).at(-1)!;

    await json<TaskDto>(t, "PATCH", "/api/tasks/expand", {
      promptTemplate: "Rewrite this at twice the length:\n\n{{original}}",
    });
    await run(t, `/api/scenes/${sceneId}/messages/${target.id}/revise`, { mode: "expand" });

    const instruction = block("Expand instruction")!;
    expect(instruction.content).toContain("Rewrite this at twice the length:");
    expect(instruction.content).toContain("Ok.");
    expect(instruction.content).not.toContain("Not more words for the same content");
    // SPEC §0.5 makes the lock a hard constraint restated near the turn; a
    // template a user can edit is not where a non-negotiable belongs.
    expect(instruction.content).toContain("do not decide what they do next");
  });

  test("the ordinary macro set still works inside an override", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await json<TaskDto>(t, "PATCH", "/api/tasks/nudge", {
      promptTemplate: "Tell {{char}} this: {{input}}",
    });
    await run(t, `/api/scenes/${sceneId}/generate`, { nudge: "be quiet" });
    // Filled by the macro engine at assembly, not by the op's own pass.
    expect(block("Nudge")!.content).toBe("Tell Sister Bell this: be quiet");
  });

  test("clearing the override goes back to the built-in words", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await json<TaskDto>(t, "PATCH", "/api/tasks/nudge", { promptTemplate: "X: {{input}}" });
    const cleared = await json<TaskDto>(t, "PATCH", "/api/tasks/nudge", { promptTemplate: null });
    expect(cleared.promptTemplate).toBeNull();

    await run(t, `/api/scenes/${sceneId}/generate`, { nudge: "carry on" });
    expect(block("Nudge")!.content).toBe("carry on");
  });

  test("an op turned off contributes nothing", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await json<TaskDto>(t, "PATCH", "/api/tasks/steer", { enabled: false });
    await json<SceneDto>(t, "PATCH", `/api/scenes/${sceneId}`, { directorNote: "Rain, always." });

    await run(t, `/api/scenes/${sceneId}/generate`, {});
    // Omitted, not emitted empty: a block with nothing in it is still a block.
    expect(block("Steer")).toBeUndefined();
  });
});

describe("where an op's words land", () => {
  test("the injection role is per-op, because which works best varies", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await json<TaskDto>(t, "PATCH", "/api/tasks/nudge", { injectionRole: "user" });

    await run(t, `/api/scenes/${sceneId}/generate`, { nudge: "louder" });
    expect(block("Nudge")!.role).toBe("user");
    // And only that op moved.
    expect(block("Spotlight instruction")!.role).toBe("system");
  });

  test("rejects a role that is not one", async () => {
    const t = await signedIn();
    expect(await statusOf(t, "PATCH", "/api/tasks/nudge", { injectionRole: "sideways" })).toBe(400);
  });
});

describe("hiding an op's button", () => {
  test("hidden is not the same as turned off", async () => {
    const t = await signedIn();
    const hidden = await json<TaskDto>(t, "PATCH", "/api/tasks/nudge", { buttonVisible: false });
    expect(hidden.buttonVisible).toBe(false);
    // Still on: something else asking for it still gets it.
    expect(hidden.enabled).toBe(true);
  });

  test("the list says which ops are worth hiding", async () => {
    const t = await signedIn();
    const tasks = await json<TaskDto[]>(t, "GET", "/api/tasks");
    const director = tasks.find((task) => task.key === "turn_classifier")!;
    // Nothing shows a button for the turn director; hiding it would mean
    // nothing, and offering the switch would be a lie.
    expect(director.hideable).toBe(false);
    expect(tasks.find((task) => task.key === "nudge")!.hideable).toBe(true);
  });

  test("a turn instruction carries no routing or timeout", async () => {
    const t = await signedIn();
    const tasks = await json<TaskDto[]>(t, "GET", "/api/tasks");
    const nudge = tasks.find((task) => task.key === "nudge")!;
    expect(nudge.runs).toBe("turn");
    expect(nudge.defaultTemplate).toBe("{{input}}");
    expect(nudge.variables).toEqual(["input"]);
  });
});

/* ------------------------------------------------------------------ */
/* Connection profiles                                                 */
/* ------------------------------------------------------------------ */

describe("providers", () => {
  test("can be added, edited and removed", async () => {
    const t = await signedIn();
    const created = await json<ProviderDto>(t, "POST", "/api/connections/providers", {
      name: "Second box",
      kind: "openai_compatible",
      baseUrl: "http://localhost:8080/v1",
      apiKey: "sk-abcdefgh",
      model: "small-1",
    });
    expect(created).toMatchObject({ name: "Second box", hasApiKey: true });
    // The plaintext never comes back — only the last four characters (§17).
    expect(JSON.stringify(created)).not.toContain("sk-abcdefgh");
    expect(created.apiKeyMask).toContain("efgh");

    const renamed = await json<ProviderDto>(
      t,
      "PATCH",
      `/api/connections/providers/${created.id}`,
      { name: "The other box" },
    );
    expect(renamed.name).toBe("The other box");
    // A patch that says nothing about the key leaves it alone.
    expect(renamed.hasApiKey).toBe(true);

    const after = await json<ProviderDto[]>(
      t,
      "DELETE",
      `/api/connections/providers/${created.id}`,
    );
    expect(after.map((provider) => provider.id)).not.toContain(created.id);
  });

  test("clearing a key is different from not mentioning it", async () => {
    const t = await signedIn();
    const created = await json<ProviderDto>(t, "POST", "/api/connections/providers", {
      name: "Keyed",
      kind: "openai_compatible",
      apiKey: "sk-secret99",
    });
    const cleared = await json<ProviderDto>(
      t,
      "PATCH",
      `/api/connections/providers/${created.id}`,
      { apiKey: null },
    );
    expect(cleared.hasApiKey).toBe(false);
  });

  test("the last provider cannot be removed", async () => {
    const t = await signedIn();
    const providers = await json<ProviderDto[]>(t, "GET", "/api/connections/providers");
    expect(providers).toHaveLength(1);
    expect(
      await statusOf(t, "DELETE", `/api/connections/providers/${providers[0]!.id}`),
    ).toBe(400);
  });

  test("rejects an unknown kind and a nameless provider", async () => {
    const t = await signedIn();
    expect(
      await statusOf(t, "POST", "/api/connections/providers", { name: "X", kind: "telepathy" }),
    ).toBe(400);
    expect(
      await statusOf(t, "POST", "/api/connections/providers", { kind: "openai_compatible" }),
    ).toBe(400);
  });
});

describe("connection profiles", () => {
  test("a second profile can be made and set as the default", async () => {
    const t = await signedIn();
    const providers = await json<ProviderDto[]>(t, "GET", "/api/connections/providers");

    const created = await json<ConnectionProfileDto>(t, "POST", "/api/connections/profiles", {
      name: "Cheap and fast",
      providerId: providers[0]!.id,
      model: "small-1",
      isDefault: true,
    });
    expect(created).toMatchObject({ name: "Cheap and fast", model: "small-1", isDefault: true });

    // One default at a time.
    const all = await json<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
    expect(all.filter((profile) => profile.isDefault)).toHaveLength(1);
  });

  test("routing an op at a profile is what all of this is for", async () => {
    const t = await signedIn();
    const providers = await json<ProviderDto[]>(t, "GET", "/api/connections/providers");
    const cheap = await json<ConnectionProfileDto>(t, "POST", "/api/connections/profiles", {
      name: "Cheap",
      providerId: providers[0]!.id,
      model: "small-1",
    });

    const routed = await json<TaskDto>(t, "PATCH", "/api/tasks/turn_classifier", {
      connectionProfileId: cheap.id,
    });
    expect(routed.connectionProfileId).toBe(cheap.id);
  });

  test("deleting one leaves the scenes that used it saying so", async () => {
    const t = await signedIn();
    const { sceneId, profiles } = await scene(t);
    const providers = await json<ProviderDto[]>(t, "GET", "/api/connections/providers");
    await json<ConnectionProfileDto>(t, "POST", "/api/connections/profiles", {
      name: "Spare",
      providerId: providers[0]!.id,
    });

    await json(t, "DELETE", `/api/connections/profiles/${profiles[0]!.id}`);
    const read = await json<{ scene: SceneDto }>(t, "GET", `/api/scenes/${sceneId}`);
    // Losing the setting is recoverable; losing the roleplay would not be.
    expect(read.scene.connectionProfileId).toBeNull();
    expect(await statusOf(t, "POST", `/api/scenes/${sceneId}/generate`, {})).toBe(400);
  });

  test("the last profile cannot be removed", async () => {
    const t = await signedIn();
    const profiles = await json<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
    expect(await statusOf(t, "DELETE", `/api/connections/profiles/${profiles[0]!.id}`)).toBe(400);
  });

  test("rejects a profile pointing at nothing", async () => {
    const t = await signedIn();
    expect(
      await statusOf(t, "POST", "/api/connections/profiles", { name: "X", providerId: "NOPE" }),
    ).toBe(400);
  });

  test("all of it requires a session", async () => {
    const t = await signedIn();
    const cookie = t.cookie;
    t.cookie = null;
    expect((await t.fetch("/api/connections/providers", { method: "POST" })).status).toBe(401);
    t.cookie = cookie;
  });
});
