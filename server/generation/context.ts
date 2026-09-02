import type { Database } from "bun:sqlite";
import { MODERN_SAMPLER_DEFAULTS, type SamplerSettings } from "../../shared/types.ts";
import { createEstimatingTokenizer } from "../prompt/index.ts";
import type {
  BeatBound,
  InstructTemplate,
  ProviderCapabilities,
  PromptCharacter,
  PromptContext,
  PromptDocumentChunk,
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
import { activeBans, listGroups, selectedOptions } from "../db/queries/options.ts";
import { activateForScene } from "../lore/scene.ts";
import { parseReasoningConfig, type ReasoningConfig } from "./reasoning.ts";
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
  reasoning_config: string | null;
}

export interface ResolvedPreset {
  preset: PromptPreset;
  samplers: SamplerSettings;
  contextSize: number;
  /** How reasoning is handled for this preset (SPEC §13). */
  reasoning: ReasoningConfig;
}

/**
 * Which preset a generation runs under (SPEC §2, §13).
 *
 * Two things can carry one — a scene, and the connection profile it routes
 * through — and until phase 17 the two halves of the answer disagreed: the
 * samplers were read from the profile's preset and the prompt from the scene's,
 * so a preset attached to one drove half the generation and a preset attached
 * to the other drove the other half. Nobody had noticed because both are
 * usually null and the hardcoded defaults covered for it.
 *
 * One rule now, applied to both: the scene's own preset if it has one,
 * otherwise the profile's, otherwise the one marked default. A preset the user
 * can edit but no scene reads is the same as no preset editor at all.
 */
export function presetIdFor(
  db: Database,
  scene: SceneRow,
  routePresetId: number | null,
): number | null {
  if (scene.preset_id !== null) return scene.preset_id;
  if (routePresetId !== null) return routePresetId;
  const row = db.query("SELECT id FROM presets WHERE is_default = 1").get() as
    | { id: number }
    | null;
  return row?.id ?? null;
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
    reasoning: parseReasoningConfig(row?.reasoning_config ?? null),
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
    reasoning: row.reasoning,
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

/**
 * Is the author due an out-of-character aside (SPEC §7)?
 *
 * The interval is the earliest it may speak up *again*, so a scene that has
 * never had one is due immediately — the first invitation should not wait
 * twelve messages to arrive. After that it is measured from the last aside on
 * this path.
 */
export function oocDueFor(
  scene: { ooc_enabled: number; ooc_interval: number },
  history: { kind: string }[],
): boolean {
  if (scene.ooc_enabled !== 1) return false;
  for (let at = history.length - 1; at >= 0; at -= 1) {
    if (history[at]?.kind === "ooc") return history.length - 1 - at >= scene.ooc_interval;
  }
  return true;
}

export interface BuildContextOptions {
  db: Database;
  scene: SceneRow;
  capabilities: ProviderCapabilities;
  /** Text-completion mode only: how this model's turns are marked (SPEC §4). */
  instruct?: InstructTemplate;
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
   * The preset this generation runs under. Defaults to `presetIdFor`, so a
   * caller that does not know its route still gets the same answer the service
   * would have computed.
   */
  presetId?: number | null;
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
      }
    | { kind: "ooc"; question: string };
  /**
   * A one-shot instruction for this generation only (SPEC §7). Never persisted
   * as a message — that is what separates a nudge from something the reader
   * said.
   */
  nudge?: string;
  now: number;
  seed: number;
  /** Retrieved document chunks, resolved in the I/O layer before the build (§11). */
  documents?: PromptDocumentChunk[];
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
  const { preset, contextSize, reasoning } = resolvePreset(
    options.db,
    options.presetId === undefined
      ? presetIdFor(options.db, options.scene, null)
      : options.presetId,
  );
  const history = options.history ?? activePath(options.db, options.scene.id);
  // One tokenizer for the whole context: the lore budget and the prompt budget
  // must agree about what a token is.
  const tokenizer = createEstimatingTokenizer();

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
  // Resolved once: an option knows its group by id, and the inspector wants
  // the group's name on every block it produces.
  const groupNames = new Map(listGroups(options.db).map((row) => [row.id, row.name]));

  /* ---------------- lorebooks (SPEC §10) ---------------- */

  // The activation model is pure and lives in /lore; this is only the part that
  // reads rows and counts messages. §10's probability and weighted groups are
  // seeded from the generation, so the same turn always activates the same lore
  // — a reroll that quietly matched different entries would be untraceable.
  const lore = activateForScene({
    db: options.db,
    scene: options.scene,
    history,
    presentCharacterIds: castRows.filter((row) => row.is_active === 1).map((row) => row.ulid),
    seed: options.seed,
    tokenizer,
  });

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
    scene: {
      title: options.scene.title,
      // Read by the scenario block and by {{scenario}} since phase 3, and
      // hardcoded null until the schema review noticed the column was missing.
      scenarioOverride: options.scene.scenario_override,
    },
    // Steer: a persistent note on the scene, applied until cleared (SPEC §7).
    ...(options.scene.director_note === null
      ? {}
      : { directorNote: options.scene.director_note }),
    ...(options.nudge === undefined ? {} : { nudge: options.nudge }),
    // §11's raw eviction, off unless the scene asks: it saves the most and it
    // loses the most.
    evictSummarized: options.scene.summarise_evict === 1,
    // §13: off unless the preset asks, because most providers advise against
    // feeding reasoning back into multi-turn context.
    reasoning: {
      reinjectLast: reasoning.reinjectLast,
      prefix: reasoning.prefix,
      suffix: reasoning.suffix,
    },
    ops: resolveOps(options),
    cast: cast.length === 0 ? [spotlight] : cast,
    spotlight,
    turn,
    // A null author selects single-character mode: standard card-in-system-
    // prompt rendering rather than the co-author framing (SPEC §3).
    author: authorRow === null ? null : toPromptAuthor(authorRow),
    persona: toPromptPersona(personaRow),
    history: history.map((row) => toPromptMessage(row, characterUlids, injected.coveredMessageIds)),
    // Already matched and resolved by the activation model (§10).
    lore: lore.activated.map((entry) => ({
      id: entry.id,
      content: entry.content,
      isConstant: entry.isConstant,
      position: entry.position,
      insertionOrder: entry.insertionOrder,
      insertionDepth: entry.insertionDepth,
      insertionRole: entry.insertionRole,
      outletName: entry.outletName,
    })),
    // The trace rides along untouched: the inspector's "which lore fired and
    // why" is this, and it is captured at build time because a later
    // recomputation could disagree — the RNG is seeded per generation (§10).
    loreTrace: lore.trace,
    documents: options.documents ?? [],
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
    // The scene's prompt options (SPEC §13.5) and ban list (§13.6). An option
    // with an empty fragment is a real choice — "no planning", "immersive
    // prose" — that simply contributes nothing to the prompt.
    options: selectedOptions(options.db, options.scene.id)
      .filter((row) => row.fragment.trim() !== "")
      .map((row) => ({
        groupName: groupNames.get(row.group_id) ?? "Option",
        name: row.name,
        fragment: row.fragment,
        placement:
          row.position === "prefix"
            ? ({ kind: "prefix" } as const)
            : row.position === "outlet" && row.outlet_name !== null
              ? ({ kind: "outlet", name: row.outlet_name } as const)
              : ({ kind: "depth", depth: row.depth } as const),
        role: row.role,
      })),
    bans: activeBans(options.db, options.scene.id).map((row) => row.phrase),
    // Whether the author may step out of the scene this turn (SPEC §7).
    // Counted along the active path rather than the scene, for the same reason
    // §10's timed effects are: an aside on a branch the reader walked away from
    // did not happen here, and should not still be suppressing the next one.
    oocDue: oocDueFor(options.scene, history),
    preset,
    capabilities: options.capabilities,
    ...(options.instruct === undefined ? {} : { instruct: options.instruct }),
    // The window is the smaller of what the preset asks for and what the
    // provider actually has: exceeding the latter fails at the provider.
    budget: Math.min(contextSize, options.capabilities.maxContext),
    tokenizer,
    now: options.now,
    seed: options.seed,
  };
}
