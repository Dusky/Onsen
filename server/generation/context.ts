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
import {
  castRowsOf,
  findAuthorById,
  findPersonaById,
  type AuthorRow,
  type CastRow,
  type PersonaRow,
} from "../db/queries/authors.ts";
import type { CharacterRow } from "../db/queries/characters.ts";

/**
 * Assembling a PromptContext from the database.
 *
 * This is the seam between stored state and the pure builder: everything the
 * builder reads is gathered here, so the builder itself never touches a query.
 */

/**
 * Used only when a scene has no cast at all — a roleplay started before any
 * character was added. The builder requires a spotlight, and refusing to
 * generate would be a worse answer than writing as an unnamed narrator.
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

function toPromptMessage(
  row: MessageRowWithSiblings,
  characterUlids: Map<number, string>,
): PromptMessage {
  return {
    id: row.ulid,
    kind: row.kind,
    authorType: row.author_type,
    content: row.content,
    isHidden: row.is_hidden === 1,
    characterId:
      row.character_id === null ? null : (characterUlids.get(row.character_id) ?? null),
    tokenCount: row.token_count,
  };
}

/**
 * A stored character, as the prompt builder wants to read it.
 *
 * The join point needs the *message's* external id, which only the caller that
 * has the history can resolve, so it is passed in rather than looked up.
 */
export function toPromptCharacter(
  row: CharacterRow,
  joinedAfterMessageUlid: string | null = null,
): PromptCharacter {
  return {
    joinedAfterMessageId: joinedAfterMessageUlid,
    id: row.ulid,
    name: row.name,
    description: row.description,
    personality: row.personality,
    scenario: row.scenario,
    exampleDialogue: row.example_dialogue,
    voiceNotes: row.voice_notes,
    depthPrompt: row.depth_prompt,
    depthPromptDepth: row.depth_prompt_depth,
    depthPromptRole: row.depth_prompt_role,
    systemPrompt: row.system_prompt,
    postHistoryInstructions: row.post_history_instructions,
  };
}

function toPromptAuthor(row: AuthorRow) {
  return {
    name: row.name,
    personality: row.personality,
    writingStyle: row.writing_style,
    directingStyle: row.directing_style,
    oocVoice: row.ooc_voice,
    boundaries: row.boundaries,
  };
}

function toPromptPersona(row: PersonaRow | null) {
  // No persona is a real state, not a missing value: the builder phrases the
  // user-lock around the reader rather than around an invented name.
  return row === null
    ? { name: null, description: null }
    : { name: row.name, description: row.description };
}

export interface BuildContextOptions {
  db: Database;
  scene: SceneRow;
  capabilities: ProviderCapabilities;
  /**
   * Whose turn this is. Defaults to the first cast member; the turn director
   * chooses in phase 8, and a guided op can force a speaker.
   */
  spotlightId?: number | null;
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

  const castRows = castRowsOf(options.db, options.scene.id);
  const characterUlids = new Map(castRows.map((row) => [row.id, row.ulid]));

  // Presence is expressed in message identifiers, so the internal ids stored on
  // membership have to be resolved against the history being rendered.
  const messageUlids = new Map(history.map((row) => [row.id, row.ulid]));
  const joinedAfterOf = (row: CastRow) =>
    row.joined_after_message_id === null
      ? null
      : (messageUlids.get(row.joined_after_message_id) ?? null);

  const cast = castRows.map((row) => toPromptCharacter(row, joinedAfterOf(row)));

  // Whoever the turn director chose, otherwise the first active member.
  const spotlightRow =
    options.spotlightId == null
      ? (castRows.find((row) => row.is_active === 1) ?? castRows[0])
      : (castRows.find((row) => row.id === options.spotlightId) ?? castRows[0]);
  const spotlight =
    spotlightRow === undefined
      ? PLACEHOLDER_SPOTLIGHT
      : toPromptCharacter(spotlightRow, joinedAfterOf(spotlightRow));

  const authorRow =
    options.scene.author_id === null ? null : findAuthorById(options.db, options.scene.author_id);
  const personaRow =
    options.scene.persona_id === null
      ? null
      : findPersonaById(options.db, options.scene.persona_id);

  return {
    scene: { title: options.scene.title, scenarioOverride: null },
    cast: cast.length === 0 ? [spotlight] : cast,
    spotlight,
    // A null author selects single-character mode: standard card-in-system-
    // prompt rendering rather than the co-author framing (SPEC §3).
    author: authorRow === null ? null : toPromptAuthor(authorRow),
    persona: toPromptPersona(personaRow),
    history: history.map((row) => toPromptMessage(row, characterUlids)),
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
