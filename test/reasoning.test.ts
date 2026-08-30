import { afterEach, describe, expect, test } from "bun:test";
import {
  ScriptedAdapter,
  completeSetup,
  createHarness,
  until,
  type TestHarness,
} from "./helpers.ts";
import { V2_CARD, pngCard } from "./card-fixtures.ts";
import {
  REASONING_DEFAULTS,
  ReasoningSplitter,
  parseReasoningConfig,
  splitReasoning,
} from "../server/generation/reasoning.ts";
import { buildPromptContext } from "../server/generation/context.ts";
import { buildPrompt } from "../server/prompt/index.ts";
import { OPENAI_COMPATIBLE_CAPABILITIES } from "../server/adapters/index.ts";
import { findScene } from "../server/db/queries/history.ts";
import { samplerProblem, MODERN_SAMPLER_DEFAULTS } from "../shared/types.ts";
import type {
  CharacterDto,
  ConnectionProfileDto,
  MessageDto,
  PresetDto,
  ProviderDto,
  SceneDto,
  SceneWithHistoryDto,
} from "../shared/types.ts";
import type { GenerationSnapshot } from "../server/generation/service.ts";

/**
 * Reasoning, prefill and the sampler defaults (SPEC §13, §20 phase 17).
 *
 * The splitter carries most of the risk, and it carries it for one reason: a
 * tag can be split across frames, so a version of this that scanned each chunk
 * on its own would show the reader a stray `<think>` and then take it back.
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
    content: "Anyone counted the lamp oil?",
  });
  return { sceneId: created.id };
}

/** Stream a turn, one scripted piece at a time. */
async function generate(t: TestHarness, sceneId: string, pieces: (string | { think: string })[]) {
  const started = await json<GenerationSnapshot>(t, "POST", `/api/scenes/${sceneId}/generate`, {});
  await adapter.started;
  for (const piece of pieces) {
    if (typeof piece === "string") adapter.push(piece);
    else adapter.pushReasoning(piece.think);
  }
  adapter.end();
  await until(() => t.generation.get(started.id)?.status === "complete");
  return started.id;
}

async function lastMessage(t: TestHarness, sceneId: string): Promise<MessageDto> {
  const read = await json<SceneWithHistoryDto>(t, "GET", `/api/scenes/${sceneId}`);
  return read.messages.at(-1)!;
}

describe("the splitter", () => {
  test("a whole string and the same string one character at a time agree", () => {
    const cases = [
      "<think>She is lying.</think>She did not look up.",
      "Before. <THINK>hidden</THINK> After.",
      "<think>never closed",
      "no tags at all",
      // The case that makes this a streaming problem: `<t` is a prefix of a
      // tag and turns out to be ordinary text.
      "a < b and 3 <t 4",
      "<thinking>one</thinking><reasoning>two</reasoning>done",
    ];
    for (const whole of cases) {
      const once = splitReasoning(whole);
      const splitter = new ReasoningSplitter();
      let prose = "";
      let reasoning = "";
      for (const character of whole) {
        const out = splitter.push(character);
        prose += out.prose;
        reasoning += out.reasoning;
      }
      const rest = splitter.flush();
      expect(prose + rest.prose, whole).toBe(once.prose);
      expect(reasoning + rest.reasoning, whole).toBe(once.reasoning);
    }
  });

  test("a partial tag is never shown as prose", () => {
    const splitter = new ReasoningSplitter();
    // `<thi` could still become `<think>`, so nothing is released yet.
    expect(splitter.push("Hello <thi").prose).toBe("Hello ");
    expect(splitter.push("nk>secret</think> there").prose).toBe(" there");
  });

  test("what turns out not to be a tag is released intact", () => {
    const splitter = new ReasoningSplitter();
    expect(splitter.push("3 <t").prose).toBe("3 ");
    // The held `<t` was ordinary text after all, and none of it is lost.
    expect(splitter.push("han 4").prose).toBe("<than 4");
  });

  test("an unclosed block is reasoning, not prose", () => {
    // The failure this prevents is the worst one available: a model's private
    // planning printed into the scene because it forgot a closing tag.
    const split = splitReasoning("<think>She is lying and I should not say so");
    expect(split.prose).toBe("");
    expect(split.reasoning).toContain("should not say so");
  });

  test("nothing is lost, whatever the shape", () => {
    const whole = "one <think>two</think> three <thinking>four</thinking> five";
    const split = splitReasoning(whole);
    for (const word of ["one", "two", "three", "four", "five"]) {
      expect(`${split.prose}${split.reasoning}`, word).toContain(word);
    }
  });
});

describe("the config", () => {
  test("re-injection is off by default", () => {
    // §13: most providers advise against feeding reasoning back.
    expect(REASONING_DEFAULTS.reinjectLast).toBe(0);
    expect(parseReasoningConfig(null).reinjectLast).toBe(0);
    expect(parseReasoningConfig(null).parseInline).toBe(true);
  });

  test("unreadable or absurd config falls back rather than failing", () => {
    expect(parseReasoningConfig("not json").reinjectLast).toBe(0);
    expect(parseReasoningConfig('{"reinjectLast":9999}').reinjectLast).toBe(20);
    expect(parseReasoningConfig('{"reinjectLast":-4}').reinjectLast).toBe(0);
    expect(parseReasoningConfig('{"prefix":12}').prefix).toBe(REASONING_DEFAULTS.prefix);
  });
});

describe("a turn that thinks", () => {
  test("inline tags are stripped from the prose and kept on the message", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await generate(t, sceneId, ["<think>She is ly", "ing.</think>She did not look up."]);

    const message = await lastMessage(t, sceneId);
    expect(message.content).toBe("She did not look up.");
    expect(message.reasoning).toBe("She is lying.");
  });

  test("a provider's own reasoning field lands the same way", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await generate(t, sceneId, [{ think: "She is lying." }, "She did not look up."]);

    const message = await lastMessage(t, sceneId);
    expect(message.content).toBe("She did not look up.");
    expect(message.reasoning).toBe("She is lying.");
  });

  test("a turn with no reasoning stores none", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await generate(t, sceneId, ["She did not look up."]);
    expect((await lastMessage(t, sceneId)).reasoning).toBeNull();
  });

  test("the buffer a client resumes from never contains the reasoning", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    const id = await generate(t, sceneId, ["<think>hidden</think>She did not look up."]);
    const snapshot = t.generation.get(id)!;
    expect(snapshot.buffer).toBe("She did not look up.");
    expect(snapshot.buffer).not.toContain("hidden");
  });

  test("time to first token ignores the thinking", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    const started = await json<GenerationSnapshot>(t, "POST", `/api/scenes/${sceneId}/generate`, {});
    await adapter.started;
    adapter.pushReasoning("a long deliberation");
    // Reasoning is not the first token: §13 hides it, and a speed that counted
    // planning the reader never sees would be a number about nothing.
    await new Promise((resolve) => setTimeout(resolve, 30));
    adapter.push("She did not look up.");
    adapter.end();
    await until(() => t.generation.get(started.id)?.status === "complete");

    const meta = t.generation.get(started.id)!.meta!;
    expect(meta.ttftMs).not.toBeNull();
  });
});

describe("feeding it back", () => {
  async function withReasoning(t: TestHarness) {
    const made = await scene(t);
    await generate(t, made.sceneId, ["<think>She is lying.</think>She did not look up."]);
    return made;
  }

  function promptText(t: TestHarness, sceneId: string): string {
    const row = findScene(t.ctx.db, sceneId)!;
    const built = buildPrompt(
      buildPromptContext({
        db: t.ctx.db,
        scene: row,
        capabilities: OPENAI_COMPATIBLE_CAPABILITIES,
        now: Date.now(),
        seed: 1,
      }),
    );
    return built.messages.map((message) => message.content).join("\n");
  }

  async function preset(t: TestHarness): Promise<PresetDto> {
    return (await json<PresetDto[]>(t, "GET", "/api/connections/presets"))[0]!;
  }

  test("by default it never reaches the next prompt", async () => {
    const t = await signedIn();
    const { sceneId } = await withReasoning(t);
    const text = promptText(t, sceneId);
    expect(text).toContain("She did not look up.");
    expect(text).not.toContain("She is lying.");
  });

  test("switched on, the last blocks ride with their wrapper", async () => {
    const t = await signedIn();
    const { sceneId } = await withReasoning(t);
    const row = await preset(t);
    await json<PresetDto>(t, "PATCH", `/api/connections/presets/${row.id}`, {
      reasoning: { reinjectLast: 2, prefix: "You thought:", suffix: "(end)" },
    });

    const text = promptText(t, sceneId);
    expect(text).toContain("She is lying.");
    expect(text).toContain("You thought:");
    expect(text).toContain("(end)");
  });

  test("only the last N, oldest dropped first", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await generate(t, sceneId, ["<think>first thought</think>One."]);
    await json(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "Go on.",
    });
    await generate(t, sceneId, ["<think>second thought</think>Two."]);

    const row = await preset(t);
    await json<PresetDto>(t, "PATCH", `/api/connections/presets/${row.id}`, {
      reasoning: { reinjectLast: 1 },
    });
    const text = promptText(t, sceneId);
    expect(text).toContain("second thought");
    expect(text).not.toContain("first thought");
  });
});

describe("prefill", () => {
  test("no provider accepts one until it is told to", async () => {
    const t = await signedIn();
    expect(OPENAI_COMPATIBLE_CAPABILITIES.supportsPrefill).toBe(false);
    const providers = await json<ProviderDto[]>(t, "GET", "/api/connections/providers");
    expect(providers[0]!.supportsPrefill).toBeNull();
  });

  test("the override is three-valued, and null is not no", async () => {
    const t = await signedIn();
    const providers = await json<ProviderDto[]>(t, "GET", "/api/connections/providers");
    const id = providers[0]!.id;

    let updated = await json<ProviderDto>(t, "PATCH", `/api/connections/providers/${id}`, {
      supportsPrefill: true,
    });
    expect(updated.supportsPrefill).toBe(true);

    updated = await json<ProviderDto>(t, "PATCH", `/api/connections/providers/${id}`, {
      supportsPrefill: false,
    });
    expect(updated.supportsPrefill).toBe(false);

    // Back to "whatever the adapter says", which is a third state and not `no`.
    updated = await json<ProviderDto>(t, "PATCH", `/api/connections/providers/${id}`, {
      supportsPrefill: null,
    });
    expect(updated.supportsPrefill).toBeNull();
  });

  test("a prefill only reaches the prompt where it is accepted", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    const row = (await json<PresetDto[]>(t, "GET", "/api/connections/presets"))[0]!;
    await json<PresetDto>(t, "PATCH", `/api/connections/presets/${row.id}`, {
      prefill: "*She did not look up.*",
    });

    const build = (supportsPrefill: boolean) =>
      buildPrompt(
        buildPromptContext({
          db: t.ctx.db,
          scene: findScene(t.ctx.db, sceneId)!,
          capabilities: { ...OPENAI_COMPATIBLE_CAPABILITIES, supportsPrefill },
          now: Date.now(),
          seed: 1,
        }),
      );

    expect(build(false).prefill).toBeUndefined();
    expect(build(true).prefill).toBe("*She did not look up.*");
  });

  test("a non-boolean override is refused", async () => {
    const t = await signedIn();
    const providers = await json<ProviderDto[]>(t, "GET", "/api/connections/providers");
    expect(
      await statusOf(t, "PATCH", `/api/connections/providers/${providers[0]!.id}`, {
        supportsPrefill: "yes",
      }),
    ).toBe(400);
  });
});

describe("the samplers", () => {
  test("the shipped defaults are §13's, not 2023's", () => {
    // The table in §13, and the reason it exists: high repetition penalty with
    // low temperature actively degrades current models.
    expect(MODERN_SAMPLER_DEFAULTS.temperature).toBe(1.0);
    expect(MODERN_SAMPLER_DEFAULTS.min_p).toBe(0.05);
    expect(MODERN_SAMPLER_DEFAULTS.repetition_penalty).toBe(1.0);
    expect(MODERN_SAMPLER_DEFAULTS.dry_multiplier).toBe(0.8);
    expect(MODERN_SAMPLER_DEFAULTS.dry_base).toBe(1.75);
    expect(MODERN_SAMPLER_DEFAULTS.dry_allowed_length).toBe(2);
    expect(MODERN_SAMPLER_DEFAULTS.xtc_threshold).toBe(0.1);
    expect(MODERN_SAMPLER_DEFAULTS.xtc_probability).toBe(0.5);
    // Top-P and Top-K disabled, which is expressed by their absence.
    expect(MODERN_SAMPLER_DEFAULTS.top_p).toBeUndefined();
    expect(MODERN_SAMPLER_DEFAULTS.top_k).toBeUndefined();
    expect(MODERN_SAMPLER_DEFAULTS.dry_sequence_breakers).toEqual(["\n", ":", '"', "*"]);
  });

  test("the validator accepts the defaults and rejects nonsense", () => {
    expect(samplerProblem(MODERN_SAMPLER_DEFAULTS)).toBeNull();
    expect(samplerProblem({ temperature: 40 })).not.toBeNull();
    expect(samplerProblem({ temperature: "hot" })).not.toBeNull();
    expect(samplerProblem({ top_k: 1.5 })).not.toBeNull();
    expect(samplerProblem({ made_up: 1 })).not.toBeNull();
    expect(samplerProblem({ dry_sequence_breakers: [1] })).not.toBeNull();
  });

  test("a preset can be edited, and a bad value is refused", async () => {
    const t = await signedIn();
    const row = (await json<PresetDto[]>(t, "GET", "/api/connections/presets"))[0]!;
    expect(row.samplerSettings.temperature).toBe(1.0);

    const updated = await json<PresetDto>(t, "PATCH", `/api/connections/presets/${row.id}`, {
      samplerSettings: { ...MODERN_SAMPLER_DEFAULTS, temperature: 0.85 },
    });
    expect(updated.samplerSettings.temperature).toBe(0.85);

    expect(
      await statusOf(t, "PATCH", `/api/connections/presets/${row.id}`, {
        samplerSettings: { temperature: 99 },
      }),
    ).toBe(400);
    expect(
      await statusOf(t, "PATCH", `/api/connections/presets/${row.id}`, { contextSize: 3 }),
    ).toBe(400);
  });

  test("editing one reasoning field leaves the others alone", async () => {
    const t = await signedIn();
    const row = (await json<PresetDto[]>(t, "GET", "/api/connections/presets"))[0]!;
    await json<PresetDto>(t, "PATCH", `/api/connections/presets/${row.id}`, {
      reasoning: { prefix: "You thought:" },
    });
    const after = await json<PresetDto>(t, "PATCH", `/api/connections/presets/${row.id}`, {
      reasoning: { reinjectLast: 3 },
    });
    // A client that sends one field must not silently reset the other three.
    expect(after.reasoning.prefix).toBe("You thought:");
    expect(after.reasoning.reinjectLast).toBe(3);
    expect(after.reasoning.parseInline).toBe(true);
  });

  test("editing the default preset reaches a scene that never chose one", async () => {
    const t = await signedIn();
    const row = (await json<PresetDto[]>(t, "GET", "/api/connections/presets"))[0]!;
    expect(row.isDefault).toBe(true);
    await json<PresetDto>(t, "PATCH", `/api/connections/presets/${row.id}`, {
      maxResponseTokens: 2048,
    });

    const { sceneId } = await scene(t);
    const built = buildPrompt(
      buildPromptContext({
        db: t.ctx.db,
        scene: findScene(t.ctx.db, sceneId)!,
        capabilities: OPENAI_COMPATIBLE_CAPABILITIES,
        now: Date.now(),
        seed: 1,
      }),
    );
    // Before phase 17 this read hardcoded defaults, so an edited preset that no
    // scene had explicitly chosen changed nothing anywhere.
    expect(built.debug.reservedForResponse).toBe(2048);
  });

  test("the samplers a preset holds are what the turn is generated with", async () => {
    const t = await signedIn();
    const row = (await json<PresetDto[]>(t, "GET", "/api/connections/presets"))[0]!;
    await json<PresetDto>(t, "PATCH", `/api/connections/presets/${row.id}`, {
      samplerSettings: { ...MODERN_SAMPLER_DEFAULTS, temperature: 0.42 },
    });
    const { sceneId } = await scene(t);
    const id = await generate(t, sceneId, ["She did not look up."]);
    expect(t.generation.get(id)!.meta!.samplers.temperature).toBe(0.42);
  });
});
