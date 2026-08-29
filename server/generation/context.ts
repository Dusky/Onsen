import type { Database } from "bun:sqlite";
import { MODERN_SAMPLER_DEFAULTS, type SamplerSettings } from "../../shared/types.ts";
import { createEstimatingTokenizer } from "../prompt/index.ts";
import type {
  ProviderCapabilities,
  PromptCharacter,
  PromptContext,
  PromptMessage,
  PromptPreset,
} from "../prompt/index.ts";
import { activePath, type MessageRowWithSiblings, type SceneRow } from "../db/queries/history.ts";

/**
 * Assembling a PromptContext from the database.
 *
 * This is the seam between stored state and the pure builder: everything the
 * builder reads is gathered here, so the builder itself never touches a query.
 */

/**
 * A scene has no cast yet — characters are phase 6, author personas phase 7,
 * and group casts phase 8 — but the builder requires a spotlight. Until those
 * phases land, generation runs in single-character mode against this stand-in.
 *
 * It is deliberately plain rather than a fake character card: a placeholder that
 * looked like a real one would invite code to depend on it.
 */
export const PLACEHOLDER_SPOTLIGHT: PromptCharacter = {
  id: "placeholder",
  name: "Assistant",
  description: null,
  personality: null,
  scenario: null,
  exampleDialogue: null,
  voiceNotes: null,
  depthPrompt: null,
  depthPromptDepth: 4,
  depthPromptRole: "system",
  systemPrompt: null,
  postHistoryInstructions: null,
};

interface PresetRow {
  name: string;
  sampler_settings: string;
  system_prompt: string | null;
  jailbreak: string | null;
  prefill: string | null;
  context_size: number;
  max_response_tokens: number;
}

export interface ResolvedPreset {
  preset: PromptPreset;
  samplers: SamplerSettings;
  contextSize: number;
}

/** Read a preset row, falling back to the modern defaults when there is none. */
export function resolvePreset(db: Database, presetId: number | null): ResolvedPreset {
  const row =
    presetId === null
      ? null
      : ((db.query("SELECT * FROM presets WHERE id = $id").get({ id: presetId }) ??
          null) as PresetRow | null);

  let samplers: SamplerSettings = { ...MODERN_SAMPLER_DEFAULTS };
  if (row !== null) {
    try {
      samplers = JSON.parse(row.sampler_settings) as SamplerSettings;
    } catch {
      // A corrupt preset should not stop a generation; the defaults are sane.
    }
  }

  return {
    preset: {
      name: row?.name ?? "Default",
      systemPrompt: row?.system_prompt ?? null,
      jailbreak: row?.jailbreak ?? null,
      prefill: row?.prefill ?? null,
      postHistoryInstructions: null,
      maxResponseTokens: row?.max_response_tokens ?? 1024,
      blockOrder: null,
    },
    samplers,
    contextSize: row?.context_size ?? 32_768,
  };
}

function toPromptMessage(row: MessageRowWithSiblings): PromptMessage {
  return {
    id: row.ulid,
    kind: row.kind,
    authorType: row.author_type,
    content: row.content,
    isHidden: row.is_hidden === 1,
    // Characters arrive in phase 6; until then no message names one.
    characterId: null,
    tokenCount: row.token_count,
  };
}

export interface BuildContextOptions {
  db: Database;
  scene: SceneRow;
  capabilities: ProviderCapabilities;
  /**
   * History to generate from. Defaults to the scene's active path; a rerolled
   * or branched generation passes the path it is attaching to instead.
   */
  history?: MessageRowWithSiblings[];
  now: number;
  seed: number;
}

/**
 * Gather everything the builder needs. Lore, documents, summaries, memory,
 * trackers and guides are all empty here because their subsystems arrive in
 * later phases; the builder already handles each being absent.
 */
export function buildPromptContext(options: BuildContextOptions): PromptContext {
  const { preset, contextSize } = resolvePreset(options.db, options.scene.preset_id);
  const history = options.history ?? activePath(options.db, options.scene.id);

  return {
    scene: { title: options.scene.title, scenarioOverride: null },
    cast: [PLACEHOLDER_SPOTLIGHT],
    spotlight: PLACEHOLDER_SPOTLIGHT,
    // Null selects single-character mode. Author personas are phase 7.
    author: null,
    persona: { name: "You", description: null },
    history: history.map(toPromptMessage),
    lore: [],
    documents: [],
    summaries: [],
    memory: [],
    trackers: [],
    guides: [],
    preset,
    capabilities: options.capabilities,
    // The window is the smaller of what the preset asks for and what the
    // provider actually has: exceeding the latter fails at the provider.
    budget: Math.min(contextSize, options.capabilities.maxContext),
    tokenizer: createEstimatingTokenizer(),
    now: options.now,
    seed: options.seed,
  };
}
