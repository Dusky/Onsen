import { createEstimatingTokenizer } from "../server/prompt/tokenizer.ts";
import type {
  ProviderCapabilities,
  PromptAuthor,
  PromptCharacter,
  PromptContext,
  PromptMessage,
  PromptPersona,
  PromptPreset,
} from "../server/prompt/types.ts";

/**
 * Fixtures for the prompt builder. Deliberately small and explicit: a test that
 * has to read three files to work out what went into the prompt is not a test of
 * prompt assembly.
 */

export function character(
  id: string,
  name: string,
  overrides: Partial<PromptCharacter> = {},
): PromptCharacter {
  return {
    id,
    name,
    description: `${name} is a person in this story.`,
    personality: null,
    scenario: null,
    exampleDialogue: null,
    voiceNotes: null,
    depthPrompt: null,
    depthPromptDepth: 4,
    depthPromptRole: "system",
    systemPrompt: null,
    postHistoryInstructions: null,
    ...overrides,
  };
}

export const BELL = character("bell", "Bell", {
  description: "Bell keeps the ridge station running.",
  personality: "Dry, watchful, slow to trust.",
  voiceNotes: "Short sentences. Never says goodbye.",
});

export const MIRA = character("mira", "Mira", {
  description: "Mira arrived on the last transport.",
});

export const AUTHOR: PromptAuthor = {
  name: "Kestrel",
  personality: "A patient collaborator who likes long silences.",
  writingStyle: "Close third person, present tense, short paragraphs.",
  directingStyle: "Escalates slowly. Lets a scene breathe.",
  oocVoice: "Direct and a little wry.",
  boundaries: "Steers toward consequence, away from gore.",
};

export const PERSONA: PromptPersona = {
  name: "Ridge",
  description: "A surveyor with a bad knee.",
};

export const PRESET: PromptPreset = {
  name: "Default",
  systemPrompt: null,
  jailbreak: null,
  prefill: null,
  postHistoryInstructions: null,
  maxResponseTokens: 200,
  blockOrder: null,
};

export const OPENAI: ProviderCapabilities = {
  separateSystemRole: true,
  supportsPrefill: false,
  requiresStrictAlternation: false,
  mode: "chat",
  needsInstructTemplate: false,
  supportedSamplers: ["temperature", "top_p"],
  samplerOrder: null,
  maxContext: 128_000,
  supportsLogitBias: true,
  supportsStopSequences: true,
  supportsGrammar: false,
  emitsReasoning: false,
  supportsPromptCaching: true,
  tokenizer: null,
};

/** Separate system param, strict alternation, prefill (SPEC §4). */
export const ANTHROPIC: ProviderCapabilities = {
  ...OPENAI,
  supportsPrefill: true,
  requiresStrictAlternation: true,
};

/** No system role, raw completion — llama.cpp and friends. */
export const TEXT_COMPLETION: ProviderCapabilities = {
  ...OPENAI,
  separateSystemRole: false,
  supportsPrefill: true,
  mode: "text",
  needsInstructTemplate: true,
};

let counter = 0;

export function userSays(content: string, overrides: Partial<PromptMessage> = {}): PromptMessage {
  return {
    id: `m${++counter}`,
    kind: "user",
    authorType: "user",
    content,
    isHidden: false,
    characterId: null,
    tokenCount: null,
    ...overrides,
  };
}

export function characterSays(
  characterId: string,
  content: string,
  overrides: Partial<PromptMessage> = {},
): PromptMessage {
  return {
    id: `m${++counter}`,
    kind: "spotlight",
    authorType: "character",
    content,
    isHidden: false,
    characterId,
    tokenCount: null,
    ...overrides,
  };
}

/**
 * An author-mode context: one author, two cast members, Bell spotlighted. Every
 * optional collection is empty, so a test only has to state what it cares about.
 */
export function context(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    scene: { title: "Ridge station", scenarioOverride: null },
    cast: [BELL, MIRA],
    spotlight: BELL,
    author: AUTHOR,
    persona: PERSONA,
    history: [],
    lore: [],
    documents: [],
    summaries: [],
    memory: [],
    trackers: [],
    guides: [],
    preset: PRESET,
    capabilities: OPENAI,
    budget: 8_000,
    tokenizer: createEstimatingTokenizer(),
    now: Date.UTC(2026, 2, 14, 9, 30, 0),
    seed: 12_345,
    ...overrides,
  };
}

/** Single-character mode: no author (SPEC §3). */
export function singleCharacterContext(overrides: Partial<PromptContext> = {}): PromptContext {
  return context({ author: null, cast: [BELL], spotlight: BELL, ...overrides });
}

/** The whole prompt as one string, for "does it contain" assertions. */
export function flatten(built: {
  system?: string | undefined;
  messages: { role: string; content: string }[];
}): string {
  return [built.system ?? "", ...built.messages.map((m) => m.content)].join("\n");
}
