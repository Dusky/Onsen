import { afterEach, describe, expect, test } from "bun:test";
import { ScriptedAdapter, completeSetup, createHarness, until, type TestHarness } from "./helpers.ts";
import { V2_CARD, pngCard } from "./card-fixtures.ts";
import { TEXT_COMPLETION_CAPABILITIES } from "../server/adapters/text.ts";
import type {
  CharacterDto,
  ConnectionProfileDto,
  InstructTemplateDto,
  ProviderDto,
  SceneDto,
} from "../shared/types.ts";

/**
 * Instruct templates through the real system (SPEC §4, §20 phase 22).
 *
 * The unit tests prove the renderer. What they cannot prove is that the
 * template a user picked is the template a generation actually used — which is
 * the failure that would look exactly like a bad model, and exactly the shape
 * of the bug phase 20 found in `scenario_override`: a value with a passing
 * unit test that the real system could never deliver.
 */

let harness: TestHarness | null = null;
let adapter: ScriptedAdapter;

async function signedIn(): Promise<TestHarness> {
  if (harness === null) {
    // Text-mode capabilities, so the builder renders `rawText` at all. The
    // shipped fixture provider is llama.cpp, which is the real case.
    adapter = new ScriptedAdapter(TEXT_COMPLETION_CAPABILITIES);
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
    title: "Ridge station",
    connectionProfileId: profiles[0]!.id,
  });
  await json<SceneDto>(t, "PUT", `/api/scenes/${created.id}/cast/${character.id}`);
  await json(t, "POST", `/api/scenes/${created.id}/messages`, {
    kind: "user",
    authorType: "user",
    content: "Has anyone counted the lamp oil?",
  });
  return created.id;
}

/** Run one generation and hand back the prompt the adapter was given. */
async function promptFrom(t: TestHarness, sceneId: string) {
  const before = adapter.prompts.length;
  void t.fetch(`/api/scenes/${sceneId}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  await adapter.started;
  await until(() => adapter.prompts.length > before);
  adapter.push("She did not look up.");
  adapter.end();
  return adapter.prompts.at(-1)!;
}

async function setTemplate(t: TestHarness, templateId: string | null) {
  const providers = await json<ProviderDto[]>(t, "GET", "/api/connections/providers");
  return statusOf(t, "PATCH", `/api/connections/providers/${providers[0]!.id}`, {
    instructTemplate: templateId,
  });
}

describe("choosing a template", () => {
  test("the shipped six are offered, and say they are built in", async () => {
    const t = await signedIn();
    const templates = await json<InstructTemplateDto[]>(
      t,
      "GET",
      "/api/connections/instruct-templates",
    );
    expect(templates.map((row) => row.id)).toContain("chatml");
    expect(templates.map((row) => row.id)).toContain("llama3");
    expect(templates.every((row) => row.builtIn)).toBe(true);
  });

  test("a template that does not exist is refused rather than ignored", async () => {
    // Silently ignoring it renders the plain transcript and the prose just
    // quietly gets worse, with nothing to point at.
    const t = await signedIn();
    expect(await setTemplate(t, "not-a-template")).toBe(400);
  });

  test("null restores the shipped default", async () => {
    const t = await signedIn();
    expect(await setTemplate(t, "llama3")).toBe(200);
    expect(await setTemplate(t, null)).toBe(200);
    const providers = await json<ProviderDto[]>(t, "GET", "/api/connections/providers");
    expect(providers[0]!.instructTemplate).toBeNull();
  });
});

describe("what the model is actually sent", () => {
  test("the chosen template marks the turns", async () => {
    const t = await signedIn();
    expect(await setTemplate(t, "llama3")).toBe(200);
    const sceneId = await scene(t);
    const prompt = await promptFrom(t, sceneId);

    expect(prompt.rawText).toBeDefined();
    expect(prompt.rawText!.startsWith("<|begin_of_text|>")).toBe(true);
    expect(prompt.rawText).toContain("<|start_header_id|>user<|end_header_id|>");
    expect(prompt.rawText).toContain("Has anyone counted the lamp oil?");
    // An open assistant turn: the model continues from there.
    expect(prompt.rawText!.endsWith("<|start_header_id|>assistant<|end_header_id|>\n\n")).toBe(true);
  });

  test("changing the template changes the prompt", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);

    expect(await setTemplate(t, "chatml")).toBe(200);
    const chatml = await promptFrom(t, sceneId);
    expect(chatml.rawText).toContain("<|im_start|>user");

    expect(await setTemplate(t, "metharme")).toBe(200);
    const metharme = await promptFrom(t, sceneId);
    expect(metharme.rawText).toContain("<|user|>");
    expect(metharme.rawText).not.toContain("<|im_start|>");
  });

  test("the markers are counted against the budget, not added after it", async () => {
    // The reason rendering lives in the builder. On a long scene the markers
    // are hundreds of tokens; a wrapper applied after the budget was struck
    // overflows a window the builder already called a fit.
    const t = await signedIn();
    const sceneId = await scene(t);

    expect(await setTemplate(t, "plain")).toBe(200);
    const plain = await promptFrom(t, sceneId);
    expect(await setTemplate(t, "llama3")).toBe(200);
    const llama = await promptFrom(t, sceneId);

    expect(llama.rawText!.length).toBeGreaterThan(plain.rawText!.length);
    expect(llama.debug.totalTokens).toBeGreaterThan(plain.debug.totalTokens);
  });
});

describe("templates a user writes", () => {
  test("a copy of a shipped one, then edited", async () => {
    const t = await signedIn();
    const created = await json<InstructTemplateDto>(
      t,
      "POST",
      "/api/connections/instruct-templates",
      { name: "My ChatML", copyFrom: "chatml" },
    );
    expect(created.builtIn).toBe(false);
    expect(created.userPrefix).toBe("<|im_start|>user\n");

    const edited = await json<InstructTemplateDto>(
      t,
      "PATCH",
      `/api/connections/instruct-templates/${created.id}`,
      { userPrefix: "<|human|>" },
    );
    expect(edited.userPrefix).toBe("<|human|>");
    // Untouched fields survive an edit that named one field.
    expect(edited.assistantPrefix).toBe("<|im_start|>assistant\n");
  });

  test("a custom template reaches a real generation", async () => {
    const t = await signedIn();
    const created = await json<InstructTemplateDto>(
      t,
      "POST",
      "/api/connections/instruct-templates",
      { name: "Two markers", userPrefix: "H: ", assistantPrefix: "A: " },
    );
    expect(await setTemplate(t, created.id)).toBe(200);
    const prompt = await promptFrom(t, await scene(t));
    expect(prompt.rawText).toContain("H: Has anyone counted the lamp oil?");
    expect(prompt.rawText!.endsWith("A: ")).toBe(true);
  });

  test("a built-in cannot be edited or deleted", async () => {
    // Correcting a format for everyone is a release, not a setting: editing
    // ChatML in place would silently change every provider using it.
    const t = await signedIn();
    expect(await statusOf(t, "PATCH", "/api/connections/instruct-templates/chatml", {
      name: "Mine now",
    })).toBe(400);
    expect(await statusOf(t, "DELETE", "/api/connections/instruct-templates/chatml")).toBe(400);
  });

  test("a name that slugs to a shipped id gets its own id instead of shadowing", async () => {
    const t = await signedIn();
    const created = await json<InstructTemplateDto>(
      t,
      "POST",
      "/api/connections/instruct-templates",
      { name: "ChatML" },
    );
    expect(created.id).not.toBe("chatml");
    // And the shipped one still renders as itself.
    const templates = await json<InstructTemplateDto[]>(
      t,
      "GET",
      "/api/connections/instruct-templates",
    );
    expect(templates.find((row) => row.id === "chatml")!.userPrefix).toBe("<|im_start|>user\n");
  });

  test("deleting one clears the providers pointing at it", async () => {
    // Left dangling, the provider would silently fall back to ChatML on its
    // next generation — a prompt change nobody asked for and nothing to see.
    const t = await signedIn();
    const created = await json<InstructTemplateDto>(
      t,
      "POST",
      "/api/connections/instruct-templates",
      { name: "Doomed", userPrefix: "X" },
    );
    expect(await setTemplate(t, created.id)).toBe(200);
    expect(
      await statusOf(t, "DELETE", `/api/connections/instruct-templates/${created.id}`),
    ).toBe(200);

    const providers = await json<ProviderDto[]>(t, "GET", "/api/connections/providers");
    expect(providers[0]!.instructTemplate).toBeNull();
  });
});
