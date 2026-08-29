/**
 * The contract between client and server (HANDOFF conventions). Identifiers in
 * every type here are ULIDs — internal integer primary keys never cross the
 * boundary.
 *
 * Only phase 1 entities are modelled. The scene, message, and character types
 * arrive with their phases.
 */

/** SPEC §4: the adapters required for v1. */
export type ProviderKind = "openai_compatible" | "anthropic" | "text_completion";

export const PROVIDER_KINDS: readonly ProviderKind[] = [
  "openai_compatible",
  "anthropic",
  "text_completion",
];

export function isProviderKind(value: unknown): value is ProviderKind {
  return typeof value === "string" && (PROVIDER_KINDS as readonly string[]).includes(value);
}

/**
 * SPEC §13 sampler settings. Every field is optional because a provider only
 * receives the samplers it declares support for (SPEC §4
 * `ProviderCapabilities.supportedSamplers`).
 */
export interface SamplerSettings {
  temperature?: number;
  min_p?: number;
  top_p?: number;
  top_k?: number;
  repetition_penalty?: number;
  dry_multiplier?: number;
  dry_base?: number;
  dry_allowed_length?: number;
  dry_sequence_breakers?: string[];
  xtc_threshold?: number;
  xtc_probability?: number;
}

/**
 * SPEC §13, "Ship modern defaults, not 2023 defaults". High repetition penalty
 * with low temperature actively degrades current models; DRY and XTC are the
 * modern replacements. Shipping these on rather than off is deliberate — a
 * preset that arrives entirely disabled is a bad first run (SPEC §13.5).
 */
export const MODERN_SAMPLER_DEFAULTS: SamplerSettings = {
  temperature: 1.0,
  min_p: 0.05,
  repetition_penalty: 1.0,
  dry_multiplier: 0.8,
  dry_base: 1.75,
  dry_allowed_length: 2,
  dry_sequence_breakers: ["\n", ":", '"', "*"],
  xtc_threshold: 0.1,
  xtc_probability: 0.5,
};

/**
 * A provider as the client sees it. The API key is represented only by
 * `apiKeyMask` — the plaintext is never serialised (SPEC §17).
 */
export interface ProviderDto {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string | null;
  model: string | null;
  hasApiKey: boolean;
  apiKeyMask: string | null;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PresetDto {
  id: string;
  name: string;
  samplerSettings: SamplerSettings;
  contextSize: number;
  maxResponseTokens: number;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ConnectionProfileDto {
  id: string;
  name: string;
  providerId: string;
  model: string | null;
  presetId: string | null;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

/* ------------------------------------------------------------------ */
/* Requests and responses                                              */
/* ------------------------------------------------------------------ */

/** What the client needs before deciding which screen to show. */
export interface BootstrapDto {
  /** False until the setup wizard has completed (SPEC §17). */
  setupCompleted: boolean;
  authenticated: boolean;
}

export interface SetupRequest {
  password: string;
  connection: {
    profileName: string;
    providerName: string;
    kind: ProviderKind;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
  };
}

export interface SetupResponse {
  provider: ProviderDto;
  profile: ConnectionProfileDto;
  preset: PresetDto;
}

export interface LoginRequest {
  password: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    /** Present on 429 (SPEC §17 rate-limits auth attempts): seconds to wait. */
    retryAfter?: number;
  };
}

/** Password rules are enforced on the server; the client mirrors them for UX. */
export const MIN_PASSWORD_LENGTH = 8;

/* ------------------------------------------------------------------ */
/* History tree (SPEC §0.3, §2)                                        */
/* ------------------------------------------------------------------ */

/**
 * What a turn is. A *spotlight* voices exactly one cast member; a *beat* is one
 * generation in which the author writes several characters interacting
 * (SPEC §0.4, §3.5). Both are meant to be switched on exhaustively.
 */
export type MessageKind = "spotlight" | "beat" | "user" | "system" | "narrator" | "ooc";

export type MessageAuthorType = "user" | "character" | "system" | "narrator" | "ooc";

export const MESSAGE_KINDS: readonly MessageKind[] = [
  "spotlight",
  "beat",
  "user",
  "system",
  "narrator",
  "ooc",
];

export const MESSAGE_AUTHOR_TYPES: readonly MessageAuthorType[] = [
  "user",
  "character",
  "system",
  "narrator",
  "ooc",
];

export function isMessageKind(value: unknown): value is MessageKind {
  return typeof value === "string" && (MESSAGE_KINDS as readonly string[]).includes(value);
}

export function isMessageAuthorType(value: unknown): value is MessageAuthorType {
  return (
    typeof value === "string" && (MESSAGE_AUTHOR_TYPES as readonly string[]).includes(value)
  );
}

/**
 * One speaker's part of a beat (SPEC §2, §3.5).
 *
 * Offsets address the parent message's canonical content and cover the prose
 * alone, not the speaker label — replacing that range is what recast does.
 */
export interface MessageSegmentDto {
  ordinal: number;
  speakerType: "character" | "narration";
  /** Null for narration, and for a speaker who is not in the cast. */
  characterId: string | null;
  /** The name as the author wrote it. Null for narration. */
  speakerName: string | null;
  content: string;
  charStart: number;
  charEnd: number;
}

export interface MessageDto {
  id: string;
  sceneId: string;
  parentId: string | null;
  kind: MessageKind;
  authorType: MessageAuthorType;
  /** Which cast member voiced this turn. Null for user and system turns. */
  characterId: string | null;
  /** Resolved for display, so the log does not need the character list. */
  speakerName: string | null;
  content: string;
  /** Excluded from the prompt, still rendered in the log. */
  isHidden: boolean;
  /** Null when never counted, or invalidated by an edit. */
  tokenCount: number | null;
  createdAt: number;
  editedAt: number | null;

  /**
   * Position among siblings, and how many there are. Siblings under one parent
   * are swipes; the UI shows the counter only when `siblingCount > 1`, never an
   * empty 1/1.
   */
  siblingIndex: number;
  siblingCount: number;

  /**
   * The parsed view of a beat, in order. Null for every other kind of message:
   * a spotlight turn has exactly one segment and it is the message's own
   * content, so sending it again would double the payload of every log.
   */
  segments: MessageSegmentDto[] | null;
  /**
   * True when a beat arrived with no usable speaker labels and was kept whole
   * as narration (SPEC §3.5). The text is intact; the attribution is not.
   */
  parseDegraded: boolean;
}

export interface SceneDto {
  id: string;
  title: string;
  presetId: string | null;
  connectionProfileId: string | null;
  turnStrategy: TurnStrategy;
  /**
   * Where the classifier turn director runs (SPEC §6). Null means the scene's
   * own profile — correct, but it spends a roleplay model on a one-line
   * question, which is what naming a cheap one here avoids.
   */
  directorProfileId: string | null;
  /** Null selects single-character mode (SPEC §3). */
  authorId: string | null;
  authorName: string | null;
  personaId: string | null;
  personaName: string | null;
  /** The cast, in display order. One member until group scenes (phase 8). */
  cast: SceneMemberDto[];
  /** Null while the scene is empty. */
  activeLeafId: string | null;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

/** A scene together with its active path, root first. */
export interface SceneWithHistoryDto {
  scene: SceneDto;
  messages: MessageDto[];
  /** Null when the cast is empty or entirely benched. */
  nextSpeaker: NextSpeakerDto | null;
}

export interface CheckpointDto {
  id: string;
  sceneId: string;
  messageId: string;
  name: string;
  createdAt: number;
}

export interface CreateSceneRequest {
  title?: string;
  presetId?: string | null;
  connectionProfileId?: string | null;
}

export interface UpdateSceneRequest {
  title?: string;
  presetId?: string | null;
  connectionProfileId?: string | null;
}

export interface AppendMessageRequest {
  kind: MessageKind;
  authorType: MessageAuthorType;
  content: string;
  /**
   * Where to attach. Omitted means the scene's active leaf, which is the normal
   * case. Naming an earlier message forks the timeline there — that is what
   * "branch" is, and what a swipe produces when it lands on a parent.
   */
  parentId?: string | null;
  isHidden?: boolean;
}

/**
 * What a generation is asked to produce (SPEC §3.5).
 *
 * `spotlight` voices one character; `beat` writes several interacting. The
 * turn director deciding between them is `auto`, and belongs to the classifier
 * (§20 phase 10) — it is not offered until it exists.
 */
export type TurnScope = "spotlight" | "beat" | "auto";

/** What a turn actually became. `auto` is a request, never an outcome. */
export type ResolvedTurnScope = "spotlight" | "beat";

/**
 * How long a beat runs. An unbounded beat is a stalling beat, so the bound is
 * part of the request rather than a setting.
 */
export type BeatBound =
  | { kind: "exchanges"; count: number }
  | { kind: "until"; condition: string }
  | { kind: "open" };

export const DEFAULT_BEAT_BOUND: BeatBound = { kind: "exchanges", count: 2 };

/** A beat longer than this is a scene, not a beat, and will not fit a budget. */
export const MAX_BEAT_EXCHANGES = 6;

export function isTurnScope(value: unknown): value is TurnScope {
  return value === "spotlight" || value === "beat" || value === "auto";
}

export function isBeatBound(value: unknown): value is BeatBound {
  if (typeof value !== "object" || value === null) return false;
  const bound = value as { kind?: unknown; count?: unknown; condition?: unknown };
  switch (bound.kind) {
    case "exchanges":
      return (
        typeof bound.count === "number" &&
        Number.isInteger(bound.count) &&
        bound.count >= 1 &&
        bound.count <= MAX_BEAT_EXCHANGES
      );
    case "until":
      return typeof bound.condition === "string" && bound.condition.trim() !== "";
    case "open":
      return true;
    default:
      return false;
  }
}

export interface UpdateMessageRequest {
  content?: string;
  isHidden?: boolean;
}

export interface SetActiveLeafRequest {
  messageId: string;
  /**
   * When the target has descendants, follow the most recent child down to a
   * leaf rather than stopping on the target. This is what makes swiping back
   * and forth restore each sibling's own continuation. Defaults to true.
   */
  descend?: boolean;
}

/** Regenerate one character's part of a beat, holding the rest fixed (SPEC §7). */
export interface RecastSegmentRequest {
  ordinal: number;
}

export interface CreateCheckpointRequest {
  name: string;
  /** Defaults to the scene's active leaf. */
  messageId?: string;
}

/* ------------------------------------------------------------------ */
/* Characters (SPEC §2, §9)                                            */
/* ------------------------------------------------------------------ */

export type CardFormat = "png_v2" | "png_v3" | "json" | "charx" | "native";
export type CardExportFormat = "png" | "charx" | "json";

/**
 * Per-field token costs, computed server-side so the editor can print them on
 * each field's label row. SPEC §16: cost is always expressed as a share of the
 * context window, not an abstract number.
 */
export interface CardTokenCosts {
  description: number;
  personality: number;
  scenario: number;
  firstMessage: number;
  exampleDialogue: number;
  voiceNotes: number;
  depthPrompt: number;
  /** What the character contributes to a prompt when spotlighted. */
  total: number;
  /** True while only the estimator ships (§3). */
  estimated: boolean;
}

export interface CharacterDto {
  id: string;
  name: string;
  hasAvatar: boolean;

  description: string | null;
  personality: string | null;
  scenario: string | null;
  firstMessage: string | null;
  alternateGreetings: string[];
  groupGreetings: string[];
  exampleDialogue: string | null;
  voiceNotes: string | null;

  depthPrompt: string | null;
  depthPromptDepth: number;
  depthPromptRole: PromptRoleName;

  systemPrompt: string | null;
  postHistoryInstructions: string | null;
  creatorNotes: string | null;
  tags: string[];
  creator: string | null;
  characterVersion: string | null;

  /** How the card arrived, so export can offer its original format. */
  format: CardFormat;
  /**
   * Fields present in the original card that this app does not model. They are
   * preserved verbatim and survive export; this names them so the user knows.
   */
  unmodelledFields: string[];

  tokens: CardTokenCosts;
  createdAt: number;
  updatedAt: number;
}

export type PromptRoleName = "system" | "user" | "assistant";

export interface UpdateCharacterRequest {
  name?: string;
  description?: string | null;
  personality?: string | null;
  scenario?: string | null;
  firstMessage?: string | null;
  alternateGreetings?: string[];
  groupGreetings?: string[];
  exampleDialogue?: string | null;
  voiceNotes?: string | null;
  depthPrompt?: string | null;
  depthPromptDepth?: number;
  depthPromptRole?: PromptRoleName;
  systemPrompt?: string | null;
  postHistoryInstructions?: string | null;
  creatorNotes?: string | null;
  tags?: string[];
  creator?: string | null;
  characterVersion?: string | null;
}

/** What an import produced, including anything worth telling the user. */
export interface ImportCharacterResponse {
  character: CharacterDto;
  /** True when the file matched a character already in the library. */
  duplicateOf: string | null;
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Authors and personas (SPEC §0.2, §2)                                */
/* ------------------------------------------------------------------ */

/**
 * The AI's own identity: the writing partner who puppets the cast.
 *
 * This is the product's defining bet (SPEC §0.2). The author is the identity in
 * the system prompt and characters are roles it plays — not three independent
 * bots sharing a scene, which is where group roleplay breaks everywhere else.
 */
export interface AuthorDto {
  id: string;
  name: string;
  hasAvatar: boolean;
  /** Who the partner is as a collaborator. */
  personality: string | null;
  /** Prose style, tense, point of view, paragraph length. */
  writingStyle: string | null;
  /** Pacing habits, how much it escalates, how it handles silence. */
  directingStyle: string | null;
  /** How it talks to the user out of character. */
  oocVoice: string | null;
  /** Content it steers toward or away from. */
  boundaries: string | null;
  /** Opt-in cross-scene memory (§11). Off by default and not yet read. */
  memoryEnabled: boolean;
  isDefault: boolean;
  tokens: AuthorTokenCosts;
  createdAt: number;
  updatedAt: number;
}

export interface AuthorTokenCosts {
  personality: number;
  writingStyle: number;
  directingStyle: number;
  oocVoice: number;
  boundaries: number;
  /** What the author block costs every prompt. */
  total: number;
  estimated: boolean;
}

export interface UpdateAuthorRequest {
  name?: string;
  personality?: string | null;
  writingStyle?: string | null;
  directingStyle?: string | null;
  oocVoice?: string | null;
  boundaries?: string | null;
  memoryEnabled?: boolean;
  isDefault?: boolean;
}

/** Who the user is. The name the user-lock is stated in terms of. */
export interface PersonaDto {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface UpdatePersonaRequest {
  name?: string;
  description?: string | null;
  isDefault?: boolean;
}

/** SPEC §6. `mention` and `classifier` are accepted but not yet implemented. */
export type TurnStrategy = "manual" | "round_robin" | "mention" | "classifier";

export const TURN_STRATEGIES: readonly TurnStrategy[] = [
  "manual",
  "round_robin",
  "mention",
  "classifier",
];

/** A character taking part in a scene. */
export interface SceneMemberDto {
  characterId: string;
  name: string;
  hasAvatar: boolean;
  displayOrder: number;
  /** A benched character keeps their history but is not chosen to speak. */
  isActive: boolean;
}

/**
 * Who the director says speaks next, and why.
 *
 * The reason is shown verbatim in the UI (SPEC §6): a decision nobody can read
 * is the arbitrary dice roll this is meant to replace.
 */
export interface NextSpeakerDto {
  characterId: string;
  name: string;
  hasAvatar: boolean;
  source: "user" | "director";
  reason: string;
}

/** Everything the scene setup screen edits. */
export interface SceneSetupRequest {
  authorId?: string | null;
  personaId?: string | null;
  presetId?: string | null;
  connectionProfileId?: string | null;
  turnStrategy?: TurnStrategy;
  /** Where the classifier runs. Null falls back to the scene's own profile. */
  directorProfileId?: string | null;
  title?: string;
}
