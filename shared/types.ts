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
}

export interface SceneDto {
  id: string;
  title: string;
  presetId: string | null;
  connectionProfileId: string | null;
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

/** A character taking part in a scene. */
export interface SceneMemberDto {
  characterId: string;
  name: string;
  hasAvatar: boolean;
  displayOrder: number;
}

/** Everything the scene setup screen edits. */
export interface SceneSetupRequest {
  authorId?: string | null;
  personaId?: string | null;
  presetId?: string | null;
  connectionProfileId?: string | null;
  title?: string;
}
