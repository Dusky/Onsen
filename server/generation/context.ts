import type { Database } from "bun:sqlite";
import { MODERN_SAMPLER_DEFAULTS, type SamplerSettings } from "../../shared/types.ts";
import { createEstimatingTokenizer } from "../prompt/index.ts";
import type {
  BeatBound,
  ProviderCapabilities,
  PromptCharacter,
  PromptContext,
  PromptMessage,
  PromptPreset,
  PromptTurn,
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
import { activeGuides } from "../db/queries/guides.ts";
import { injectedSummaries } from "../db/queries/summaries.ts";
import { guideOpKey } from "../tasks/registry.ts";
import { taskConfig, templateOf } from "../db/queries/tasks.ts";
import { fillTemplate } from "../prompt/index.ts";
import { CONTINUE, CORRECT, EXPAND, NUDGE, opKind, STEER } from "../tasks/registry.ts";
import type { PromptOpConfig } from "../prompt/index.ts";

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
  summarized: Set<number>,
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
    isSummarized: summarized.has(row.id),
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
  /**
   * What is being asked for (SPEC §3.5). Omitted means an ordinary spotlight.
   * A beat's participants are resolved here rather than passed in: they are the
   * active cast, which only the database knows.
   */
  turn?:
    | { kind: "spotlight" }
    | { kind: "beat"; bound: BeatBound }
    | { kind: "recast"; beatText: string }
    | {
        kind: "revise";
        mode: "expand" | "correct" | "continue";
        original: string;
        instructions?: string;
      };
  /**
   * A one-shot instruction for this generation only (SPEC §7). Never persisted
   * as a message — that is what separates a nudge from something the reader
   * said.
   */
  nudge?: string;
  now: number;
  seed: number;
}

/**
 * Resolve the per-op configuration this turn's prompt honours (SPEC §7).
 *
 * Each op's own variables are filled here, because only the caller knows what
 * `{{original}}` and `{{input}}` are. Everything else in a template is the
 * ordinary macro set and is filled at assembly, so `{{char}}` inside an
 * override resolves exactly as it does inside a preset.
 */
function resolveOps(options: BuildContextOptions): Partial<Record<string, PromptOpConfig>> {
  const ops: Partial<Record<string, PromptOpConfig>> = {};
  const turn = options.turn;

  const put = (key: string, values: Record<string, string>) => {
    const kind = opKind(key);
    if (kind === null) return;
    const row = taskConfig(options.db, kind);
    const text = fillTemplate(templateOf(row, kind), values).trim();
    ops[key] = {
      enabled: row.enabled === 1,
      role: row.injection_role,
      ...(text === "" ? {} : { text }),
    };
  };

  if (options.nudge !== undefined) put(NUDGE, { input: options.nudge });
  if (options.scene.director_note !== null) {
    put(STEER, { input: options.scene.director_note });
  }
  if (turn?.kind === "revise") {
    const key = turn.mode === "expand" ? EXPAND : turn.mode === "correct" ? CORRECT : CONTINUE;
    put(key, {
      original: turn.original.trim(),
      // The sentence the built-in template wraps around the user's words, so an
      // empty correction still reads as an instruction rather than a fragment.
      input:
        turn.instructions === undefined || turn.instructions.trim() === ""
          ? "Write it again, better."
          : `Write it again, with this changed: ${turn.instructions.trim()}`,
    });
  }

  return ops;
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

  // Rolling summarisation (SPEC §11): which summaries this prompt carries, and
  // which raw messages they stand in for.
  const injected = injectedSummaries(options.db, options.scene, history);

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

  // A beat writes everyone who is actually in play. Benched members are not in
  // it, and a beat needs somebody to talk to, so a cast of one degrades to a
  // spotlight rather than instructing the author to hold a conversation alone.
  const participants = castRows
    .filter((row) => row.is_active === 1)
    .map((row) => toPromptCharacter(row, joinedAfterOf(row)));
  const requested = options.turn ?? { kind: "spotlight" };
  const turn: PromptTurn =
    requested.kind === "beat"
      ? participants.length < 2
        ? { kind: "spotlight" }
        : { kind: "beat", participants, bound: requested.bound }
      : requested;

  return {
    scene: { title: options.scene.title, scenarioOverride: null },
    // Steer: a persistent note on the scene, applied until cleared (SPEC §7).
    ...(options.scene.director_note === null
      ? {}
      : { directorNote: options.scene.director_note }),
    ...(options.nudge === undefined ? {} : { nudge: options.nudge }),
    // §11's raw eviction, off unless the scene asks: it saves the most and it
    // loses the most.
    evictSummarized: options.scene.summarise_evict === 1,
    ops: resolveOps(options),
    cast: cast.length === 0 ? [spotlight] : cast,
    spotlight,
    turn,
    // A null author selects single-character mode: standard card-in-system-
    // prompt rendering rather than the co-author framing (SPEC §3).
    author: authorRow === null ? null : toPromptAuthor(authorRow),
    persona: toPromptPersona(personaRow),
    history: history.map((row) => toPromptMessage(row, characterUlids, injected.coveredMessageIds)),
    lore: [],
    documents: [],
    // Rolling summarisation (SPEC §11). Which of the scene's summaries reach
    // the prompt is decided by the threshold and the freeze, not by this call.
    summaries: injected.summaries.map((row) => ({
      id: row.ulid,
      content: row.content,
      coversFromMessageId: messageUlids.get(row.covers_from_message_id) ?? null,
      coversToMessageId: messageUlids.get(row.covers_to_message_id) ?? null,
    })),
    memory: [],
    trackers: [],
    // Written once by a side call and injected every turn until flushed
    // (SPEC §8). Versioned per message, so this follows the active path.
    guides: activeGuides(options.db, options.scene.id).map((row) => ({
      name: opKind(guideOpKey(row.kind))?.label ?? row.kind,
      content: row.content,
    })),
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
