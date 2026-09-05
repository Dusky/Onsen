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
 * What each sampler is allowed to be (SPEC §13).
 *
 * Bounded rather than free-form because these reach a provider verbatim: a
 * temperature of 40 is not an adventurous setting, it is a request that comes
 * back as noise or as a 400, and neither failure points at the field that
 * caused it. The ranges are deliberately wider than the useful range — this is
 * a guard against nonsense, not an opinion about taste.
 */
export const SAMPLER_BOUNDS = {
  temperature: { min: 0, max: 5, step: 0.05 },
  min_p: { min: 0, max: 1, step: 0.01 },
  top_p: { min: 0, max: 1, step: 0.01 },
  top_k: { min: 0, max: 500, step: 1, integer: true },
  repetition_penalty: { min: 0.5, max: 2, step: 0.01 },
  dry_multiplier: { min: 0, max: 5, step: 0.05 },
  dry_base: { min: 0, max: 5, step: 0.05 },
  dry_allowed_length: { min: 0, max: 20, step: 1, integer: true },
  xtc_threshold: { min: 0, max: 1, step: 0.01 },
  xtc_probability: { min: 0, max: 1, step: 0.05 },
} as const satisfies Record<string, { min: number; max: number; step: number; integer?: boolean }>;

export type BoundedSampler = keyof typeof SAMPLER_BOUNDS;

export const BOUNDED_SAMPLERS = Object.keys(SAMPLER_BOUNDS) as BoundedSampler[];

/**
 * Validate a sampler bundle, returning the first thing wrong with it.
 *
 * Shared between the route and the editor so a value the form accepts is never
 * one the server refuses, which is the kind of mismatch that reads as a bug in
 * whichever half the user is looking at.
 */
export function samplerProblem(settings: unknown): string | null {
  if (typeof settings !== "object" || settings === null) return "Expected sampler settings.";
  const record = settings as Record<string, unknown>;

  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;

    if (key === "dry_sequence_breakers") {
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        return "Sequence breakers must be a list of strings.";
      }
      if (value.length > 20) return "That is more sequence breakers than any backend will use.";
      continue;
    }

    if (!(key in SAMPLER_BOUNDS)) return `${key} is not a sampler this app knows.`;
    const bound = SAMPLER_BOUNDS[key as BoundedSampler];
    if (typeof value !== "number" || !Number.isFinite(value)) return `${key} must be a number.`;
    if (value < bound.min || value > bound.max) {
      return `${key} must be between ${bound.min} and ${bound.max}.`;
    }
    if ("integer" in bound && bound.integer && !Number.isInteger(value)) {
      return `${key} must be a whole number.`;
    }
  }
  return null;
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
  /**
   * Whether this endpoint accepts a prefill — a partial assistant turn the
   * model continues from (SPEC §13). Null means the adapter's own default: it
   * is a property of the endpoint rather than the wire format, since OpenAI
   * rejects a trailing assistant message and most local servers speaking the
   * same shape accept one.
   */
  supportsPrefill: boolean | null;
  /**
   * Text completion only: which instruct template marks this model's turns
   * (SPEC §4). Null takes the shipped default. Ignored by the chat adapters,
   * whose providers apply their own.
   */
  instructTemplate: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * An instruct template, shipped or user-authored (SPEC §4).
 *
 * `builtIn` is what separates the two: a shipped template can be chosen and
 * copied but not edited, because correcting a format for everyone is a release,
 * not a setting.
 */
export interface InstructTemplateDto {
  id: string;
  name: string;
  builtIn: boolean;
  bos: string;
  systemPrefix: string;
  systemSuffix: string;
  userPrefix: string;
  userSuffix: string;
  assistantPrefix: string;
  assistantSuffix: string;
  systemInUser: boolean;
  stopSequences: string[];
}

export interface PresetDto {
  id: string;
  name: string;
  samplerSettings: SamplerSettings;
  contextSize: number;
  maxResponseTokens: number;
  /** Seeds the assistant turn, where the endpoint accepts one (SPEC §13). */
  prefill: string | null;
  /** How reasoning is handled for scenes on this preset (SPEC §13). */
  reasoning: ReasoningConfigDto;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * SPEC §13: reasoning is parsed out of the response, hidden from the prose, and
 * **not fed back into multi-turn context by default** — most providers advise
 * against it. Re-injection is an opt-in with a configurable prefix and suffix,
 * and "off" is expressed as zero blocks rather than a separate flag, so there is
 * one thing to read and no way for a flag and a count to disagree.
 */
export interface ReasoningConfigDto {
  reinjectLast: number;
  prefix: string;
  suffix: string;
  /** Strip inline `<think>` tags from the prose. On by default. */
  parseInline: boolean;
}

export interface UpdatePresetRequest {
  name?: string;
  samplerSettings?: SamplerSettings;
  contextSize?: number;
  maxResponseTokens?: number;
  prefill?: string | null;
  reasoning?: Partial<ReasoningConfigDto>;
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
export interface CreateProviderRequest {
  name: string;
  kind: ProviderKind;
  baseUrl?: string | null;
  apiKey?: string | null;
  model?: string | null;
}

export interface UpdateProviderRequest {
  name?: string;
  baseUrl?: string | null;
  /**
   * Omitted leaves the stored key alone; null clears it; a string replaces it.
   * Three states, because a form that came back empty must not silently delete
   * a credential nobody touched (SPEC §17).
   */
  apiKey?: string | null;
  model?: string | null;
  enabled?: boolean;
  /** Null restores the adapter's own answer, rather than meaning "no" (§13). */
  supportsPrefill?: boolean | null;
  /** Text completion only: which instruct template marks the turns (§4). */
  instructTemplate?: string | null;
}

export interface CreateConnectionProfileRequest {
  name: string;
  providerId: string;
  model?: string | null;
  presetId?: string | null;
  isDefault?: boolean;
}

export interface UpdateConnectionProfileRequest {
  name?: string;
  providerId?: string;
  model?: string | null;
  presetId?: string | null;
  isDefault?: boolean;
}

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
  /** The expression the author declared for this segment, if any (§12). */
  expression: string | null;
}

/**
 * What a post-generation pass found (SPEC §7.5).
 *
 * Shown as a small annotation on the message, never a modal: a pass is a second
 * reader's note in the margin, not an interruption.
 */
export interface AnnotationDto {
  id: string;
  passKey: string;
  passLabel: string;
  /** Which part of a beat this is about. Null for the whole message. */
  segmentOrdinal: number | null;
  /**
   * `ok` is reported as well as `flagged`, because "the pass ran and was happy"
   * and "the pass never ran" are different things to know.
   */
  status: "ok" | "flagged" | "revised" | "failed";
  detail: string | null;
  /** True when the pass changed the message and the original is still held. */
  revertable: boolean;
  createdAt: number;
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
  /**
   * The model's own reasoning, hidden from the prose and rendered collapsed
   * (SPEC §13). Never fed back into a later prompt unless the preset asks.
   */
  reasoning: string | null;
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
  /** What the post-generation passes found, in the order they ran (§7.5). */
  annotations: AnnotationDto[];
  /** True while the pipeline is still working on this message. */
  passesPending: boolean;
  /** The expression the author declared for this turn, if any (§12). */
  expression: string | null;
  /**
   * True when a beat arrived with no usable speaker labels and was kept whole
   * as narration (SPEC §3.5). The text is intact; the attribution is not.
   */
  parseDegraded: boolean;
  /**
   * Pictures and audio hanging off this turn (§20 phase 41): an illustration
   * drawn for it, a reading of it, or a picture the reader attached.
   *
   * Empty for almost every message, which is why it is a list rather than three
   * nullable fields — a turn can have all three and often has none.
   */
  media: MediaAssetDto[];
}

/* ------------------------------------------------------------------ */
/* Media (SPEC §20 phase 41)                                           */
/* ------------------------------------------------------------------ */

export type MediaRole = "illustration" | "speech" | "attachment";

export interface MediaAssetDto {
  id: string;
  kind: "image" | "audio";
  role: MediaRole;
  /** Served by this app. A provider URL would expire and leak who looked. */
  url: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  /** What was asked for, so a picture can be explained and tried again. */
  prompt: string | null;
  /** What a vision model saw. This is the text that reaches the prompt. */
  caption: string | null;
  /**
   * Not drawn in the log. Independent of `inPrompt`: where a picture appears
   * and what the author is told about it are different questions, which is the
   * same split §2 makes for a hidden message.
   */
  hidden: boolean;
  /** Whether the caption reaches the prompt. Only meaningful for an attachment. */
  inPrompt: boolean;
  createdAt: number;
}

export interface MediaServiceDto {
  id: string;
  name: string;
  purpose: "image" | "speech";
  kind: string;
  /** Resolved server-side, so no raw enum ever reaches a screen. */
  kindLabel: string;
  baseUrl: string | null;
  model: string | null;
  options: Record<string, unknown>;
  hasApiKey: boolean;
  apiKeyMask: string | null;
  enabled: boolean;
  isDefault: boolean;
}

/** What kinds of service can be added, with the words to describe them. */
export interface MediaKindDto {
  purpose: "image" | "speech";
  kind: string;
  label: string;
  hint: string;
  defaultBaseUrl: string;
  needsKey: boolean;
}

/* ------------------------------------------------------------------ */
/* Regex scripts (SPEC §14)                                            */
/* ------------------------------------------------------------------ */

export const APPLY_STAGES = ["user_input", "ai_output", "display_only", "prompt"] as const;
export type ApplyStage = (typeof APPLY_STAGES)[number];

export const SCRIPT_SCOPES = ["global", "character", "scene"] as const;
export type ScriptScope = (typeof SCRIPT_SCOPES)[number];

export function isApplyStage(value: unknown): value is ApplyStage {
  return typeof value === "string" && (APPLY_STAGES as readonly string[]).includes(value);
}

export function isScriptScope(value: unknown): value is ScriptScope {
  return typeof value === "string" && (SCRIPT_SCOPES as readonly string[]).includes(value);
}

export interface RegexScriptDto {
  id: string;
  name: string;
  pattern: string;
  replacement: string;
  /** A subset of JavaScript's: g, i, m, s, u, y. */
  flags: string;
  enabled: boolean;
  applyTo: ApplyStage;
  scope: ScriptScope;
  /** Set when `scope` is `character`, null otherwise. */
  characterId: string | null;
  /** Set when `scope` is `scene`, null otherwise. */
  sceneId: string | null;
  /** Lower runs first, within a stage. */
  runOrder: number;
  createdAt: number;
  updatedAt: number;
}

/** What one script did to one piece of text, for the test panel (§14). */
export interface ScriptRunDto {
  scriptId: string;
  name: string;
  replacements: number;
  /** Why it did nothing, where that was a misconfiguration rather than no match. */
  error: string | null;
  unknownMacros: string[];
}

/**
 * A dry run against text the user typed into the test panel.
 *
 * `before` comes back alongside `after` so the panel can show the pair without
 * having to trust that it still holds the input it sent.
 */
export interface ScriptTestDto {
  before: string;
  after: string;
  runs: ScriptRunDto[];
}

export const TRIGGER_EVENTS = [
  "scene_start",
  "user_message",
  "before_generation",
  "after_generation",
  "lore_activation",
] as const;
export type TriggerEvent = (typeof TRIGGER_EVENTS)[number];

export const TRIGGER_ACTIONS = ["guide", "tracker", "script"] as const;
export type TriggerAction = (typeof TRIGGER_ACTIONS)[number];

export interface EventTriggerDto {
  id: string;
  name: string;
  event: TriggerEvent;
  action: TriggerAction;
  /** A guide kind, a tracker kind, or a regex script's id. */
  actionRef: string;
  /** `lore_activation` only: which entry's automation id fires this (§10). */
  automationId: string | null;
  scope: "global" | "scene";
  sceneId: string | null;
  enabled: boolean;
  runOrder: number;
  createdAt: number;
  updatedAt: number;
}

/** What one trigger did, for the run-by-hand button. */
export interface TriggerOutcomeDto {
  triggerId: string;
  name: string;
  action: TriggerAction;
  ran: boolean;
  detail: string;
}

/* ------------------------------------------------------------------ */
/* Packs (SPEC §15 tier 2)                                             */
/* ------------------------------------------------------------------ */

export const PACK_KINDS = [
  "characters",
  "lorebooks",
  "presets",
  "authors",
  "options",
  "regex",
  "triggers",
  "banlists",
] as const;
export type PackKind = (typeof PACK_KINDS)[number];

export interface InstalledPackDto {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  hostApiRange: string | null;
  installedAt: number;
  /** How many rows this install owns, and would take with it. */
  rowCount: number;
}

export interface PackListDto {
  hostApiVersion: string;
  packs: InstalledPackDto[];
}

/** One thing an install would do. `skip` never writes. */
/**
 * A theme (SPEC §20 phase 45).
 *
 * `tokens` names only what this theme changes — `--onsen-*` custom properties,
 * without the prefix — so a theme stays small and one written today still works
 * after a token is added tomorrow.
 */
/* ------------------------------------------------------------------ */
/* The agent (SPEC §20 phase 46)                                       */
/* ------------------------------------------------------------------ */

export interface AgentThreadDto {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface AgentMessageDto {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  /** Calls this assistant turn asked for. Empty on every other role. */
  toolCalls: { name: string; arguments: string }[];
  /** Whether a tool result reported failure. */
  isError: boolean;
  createdAt: number;
}

/** A change the agent made, and what the thing looked like before it. */
export interface AgentUndoDto {
  id: string;
  kind: string;
  subjectId: string;
  at: number;
}

export interface ThemeDto {
  id: string;
  name: string;
  base: "dark" | "light";
  tokens: Record<string, string>;
  /** CSS the reader has approved. Served, and applied last. */
  customCss: string;
  /**
   * CSS that arrived with an import and has not been approved. Shown, never
   * applied: an imported theme is somebody else's code, and CSS can reach the
   * network.
   */
  pendingCss: string;
  isBuiltin: boolean;
  createdAt: number;
  updatedAt: number;
}

/** What an imported theme brought, and what it would be allowed to do. */
export interface ThemeImportDto {
  theme: ThemeDto;
  /** One line per thing the pending CSS could do. Empty when it carries none. */
  concerns: string[];
  /** Token pairs the file carried that were refused. */
  droppedTokens: string[];
}

/** What kind of thing a migrated file turned out to be (SPEC §20 phase 44). */
export type MigrationKind =
  | "character"
  | "chat"
  | "group_chat"
  | "persona"
  | "lorebook"
  | "instruct"
  | "context"
  | "regex";

/**
 * One file's fate in a SillyTavern import (SPEC §20 phase 44).
 *
 * The same add/skip shape a pack install and a bulk card import already report,
 * with the path kept: a migration is thousands of files and "which one" is the
 * first thing anybody asks about a line in the report.
 */
export interface MigrationItemDto {
  kind: MigrationKind;
  name: string;
  path: string;
  action: "add" | "skip";
  detail: string;
}

export interface MigrationReportDto {
  added: number;
  skipped: number;
  items: MigrationItemDto[];
}

/**
 * One file's fate in a bulk import (SPEC §9, §20 phase 43). Deliberately the
 * same shape as a pack's plan item, which is the report the app already knows
 * how to read: what it was, whether it landed, and why not.
 */
export interface CharacterImportItemDto {
  /** The character's name where the file parsed, the filename where it did not. */
  name: string;
  filename: string;
  action: "add" | "skip";
  detail: string;
  /** Set when the file landed, or when it was a duplicate of something here. */
  characterId: string | null;
}

export interface BulkImportCharactersResponse {
  added: number;
  skipped: number;
  items: CharacterImportItemDto[];
}

export interface PackPlanItemDto {
  kind: PackKind;
  name: string;
  action: "add" | "skip";
  detail: string;
}

export interface PackPlanDto {
  manifest: {
    name: string;
    version: string;
    author: string;
    description: string;
    hostApiRange: string | null;
  };
  /** Set when the pack cannot be installed at all. Null when it can. */
  problem: string | null;
  items: PackPlanItemDto[];
  strayAssets: number;
}

export interface PackInstallDto {
  packId: string;
  manifest: PackPlanDto["manifest"];
  added: number;
  skipped: number;
  items: PackPlanItemDto[];
  warnings: string[];
}

/** What is installed that a pack could carry, as the export sheet needs it. */
export interface PackExportableDto {
  characters: { ulid: string; name: string }[];
  lorebooks: { ulid: string; name: string }[];
  presets: { ulid: string; name: string }[];
  authors: { ulid: string; name: string }[];
  options: { ulid: string; name: string }[];
  regex: { ulid: string; name: string }[];
  triggers: { ulid: string; name: string }[];
  /** How many phrases the global list holds. It travels whole or not at all. */
  banlist: number;
}

/** What an uninstall would remove, from the record of what install added. */
export interface PackUninstallPreviewDto {
  packId: string;
  name: string;
  version: string;
  rows: { table: string; label: string }[];
}

/* ------------------------------------------------------------------ */
/* Outbound webhooks (SPEC §15)                                        */
/* ------------------------------------------------------------------ */

export const WEBHOOK_EVENTS = [
  "message.created",
  "generation.complete",
  "beat.parsed",
  "tracker.updated",
  "lore.activated",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** One attempt at one delivery, for the log the subscription carries. */
export interface WebhookDeliveryDto {
  event: string;
  status: "ok" | "failed";
  /** The HTTP status, where there was one. Null when nothing answered. */
  responseCode: number | null;
  detail: string | null;
  durationMs: number;
  attempt: number;
  at: number;
}

export interface WebhookDto {
  id: string;
  name: string;
  url: string;
  events: WebhookEvent[];
  /** Null when this listens to every roleplay. */
  sceneId: string | null;
  enabled: boolean;
  /** Consecutive failures. Reset when the subscription is switched back on. */
  failures: number;
  /** Why it was switched off, when the app did that rather than the reader. */
  disabledReason: string | null;
  createdAt: number;
  updatedAt: number;
  deliveries: WebhookDeliveryDto[];
}

/** The signing key is returned once, on the response that created it. */
export interface NewWebhookDto extends WebhookDto {
  secret: string;
}

/* ------------------------------------------------------------------ */
/* The outbound OpenAI-compatible API (SPEC §19)                       */
/* ------------------------------------------------------------------ */

export type ApiHistoryMode = "last_message" | "sync" | "stateless";

/** One request a key made, for the log the key carries. */
export interface ApiRequestDto {
  model: string;
  status: number;
  /** Set when the client's system prompt looked like an assembled card (§19). */
  warning: string | null;
  durationMs: number;
  at: number;
}

export interface ApiKeyDto {
  id: string;
  name: string;
  /** The first few characters. Enough to recognise, far too little to use. */
  hint: string;
  /** Null when the key reaches every roleplay that has opted in. */
  sceneId: string | null;
  sceneTitle: string | null;
  revoked: boolean;
  lastUsedAt: number | null;
  uses: number;
  createdAt: number;
  requests: ApiRequestDto[];
}

/** The token is returned once, on the response that created the key. */
export interface NewApiKeyDto extends ApiKeyDto {
  token: string;
}

export interface SceneApiDto {
  enabled: boolean;
  historyMode: ApiHistoryMode;
  slug: string | null;
  /** What a client puts in its `model` field. Null until switched on. */
  modelId: string | null;
}

/* ------------------------------------------------------------------ */
/* Narrative memory (SPEC §11 layer 3)                                 */
/* ------------------------------------------------------------------ */

export const MEMORY_KINDS = ["person", "place", "object", "event", "fact"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export function isMemoryKind(value: unknown): value is MemoryKind {
  return typeof value === "string" && (MEMORY_KINDS as readonly string[]).includes(value);
}

export interface MemoryEntityDto {
  id: string;
  kind: MemoryKind;
  name: string;
  content: string;
  /** 0-1, as stored. What decay does to it is a function of how long ago. */
  salience: number;
  /** Turns since it was last mentioned. */
  turnsSince: number;
  /** §11: a reader's edit is never overwritten by extraction. */
  userEdited: boolean;
  /** The relations it is on either end of, as prose. */
  links: string[];
  updatedAt: number;
}

/** One recalled memory, with everything needed to say why it was recalled. */
export interface MemoryRecallTrace {
  id: string;
  name: string;
  kind: string;
  /** What the ranking used. */
  score: number;
  /** How close it was to the moment. */
  similarity: number;
  /** As stored, and after decay. Kept apart so the trace can show both. */
  salience: number;
  effectiveSalience: number;
  turnsSince: number;
  userEdited: boolean;
}

/* ------------------------------------------------------------------ */
/* Author memory (SPEC §11)                                            */
/* ------------------------------------------------------------------ */

/**
 * One thing an author wrote down about a reader.
 *
 * A lore entry, because that is literally what it is: §11 implements author
 * memory as a lorebook the author owns, so this carries a lore entry's fields
 * plus the two that say where it came from.
 */
export interface AuthorNoteDto {
  id: string;
  title: string;
  content: string;
  keys: string[];
  enabled: boolean;
  /** §11: "provenance showing the author wrote it." False for the reader's. */
  writtenByAuthor: boolean;
  /** The roleplay it came out of, by title. Null once that roleplay is gone. */
  writtenInScene: string | null;
  updatedAt: number;
}

export interface AuthorMemoryDto {
  enabled: boolean;
  /** Null until the author has written something and the book exists. */
  bookId: string | null;
  /** §11's "separate budget" — the book's own, which §10 already honours. */
  tokenBudget: number;
  entries: AuthorNoteDto[];
}

export interface SceneDto {
  id: string;
  title: string;
  presetId: string | null;
  connectionProfileId: string | null;
  /** The profile's name, so the status bar can say which model answers (§43). */
  connectionProfileName: string | null;
  /**
   * What the scene's last built prompt cost, for the status bar (§16). Null
   * until something has been generated here — a status bar showing an invented
   * number is worse than one showing none.
   */
  lastPromptTokens: number | null;
  /**
   * How many summaries stand behind this scene (§20 phase 50).
   *
   * The Instrument deck states what each subsystem is holding, and memory's
   * figure is this. Before it, the number was reachable only by opening the
   * summaries sheet, which fetches the whole set — far too much to know one
   * count.
   */
  summaryCount: number;
  /**
   * The context window this scene's preset is fitted to (§20 phase 50).
   *
   * `lastPromptTokens` alone says how much was spent and not out of what. A
   * fraction is the readable form, and it needs the denominator.
   */
  contextSize: number | null;
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
  /** Steer (SPEC §7): applied to every turn until cleared. Null when clear. */
  directorNote: string | null;
  /** Whether the post-generation passes run without being asked (§7.5). */
  autoPasses: boolean;
  /** The question the custom guide asks. Null when it has not been written. */
  customGuidePrompt: string | null;
  /**
   * This scene's own framing, replacing the card's (SPEC §2). A card's scenario
   * is written by whoever made it, for a scene nobody has had yet.
   */
  scenarioOverride: string | null;
  /** Rolling summarisation, all of §11's knobs, per scene. */
  summarise: boolean;
  summariseEveryMessages: number;
  summariseEveryWords: number;
  /** Only summaries covering messages older than this are injected (§11). */
  summariseThreshold: number;
  /** Drop the raw messages an injected summary covers (§11). */
  summariseEvict: boolean;
  /**
   * Whether the author may step out of the scene to speak to the reader
   * (SPEC §7). Off by default: an author that volunteers asides is a delight
   * when you want a collaborator and an intrusion when you want a story.
   */
  oocEnabled: boolean;
  /** The earliest it may speak up again, in messages. A nudge, not a schedule. */
  oocInterval: number;
  /** Whether an outside client may drive this roleplay (SPEC §19). */
  apiEnabled: boolean;
  /** What a model id addresses it by. Null until the API is switched on. */
  apiSlug: string | null;
  /** Whether the scene keeps writing itself after a reply (SPEC §6). */
  autopilotEnabled: boolean;
  /** How many turns the loop may write before it stops (SPEC §6). */
  autopilotMaxTurns: number;
  /** Visual novel staging, sprites above the log (SPEC §12). */
  vnModeEnabled: boolean;
  /** Whether a background image is set (served at /scenes/:id/background). */
  hasBackground: boolean;
  /** Whether OOC asides render inline in the log, or only in the channel (§7). */
  oocInline: boolean;
  /** Move the injection point only every N turns, for the prompt cache (§11). */
  summariseFreeze: number;
  /** The cast, in display order. One member until group scenes (phase 8). */
  cast: SceneMemberDto[];
  /** Null while the scene is empty. */
  activeLeafId: string | null;
  messageCount: number;
  /**
   * A few words of the newest turn, for the roleplays list - the one thing that
   * tells two scenes with the same title apart. Null while the scene is empty.
   */
  lastLine: string | null;
  createdAt: number;
  updatedAt: number;
}

/** A scene together with its active path, root first. */
export interface SceneWithHistoryDto {
  scene: SceneDto;
  messages: MessageDto[];
  /** The guides in force right now — versioned per message, so this follows
   * the active path (SPEC §8). */
  guides: GuideDto[];
  /** Null when the cast is empty or entirely benched. */
  nextSpeaker: NextSpeakerDto | null;
  /**
   * Pictures attached but not yet sent (§20 phase 41). They belong to no
   * message until a line is sent, so they travel with the scene.
   */
  pendingMedia: MediaAssetDto[];
}

export interface CheckpointDto {
  id: string;
  sceneId: string;
  messageId: string;
  name: string;
  /**
   * A line of the message this marks. Resolved server-side: a mark often points
   * off the active path, which the client is not holding.
   */
  excerpt: string | null;
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
/* Background tasks (SPEC §7)                                          */
/* ------------------------------------------------------------------ */

export type TaskStage = "pre_generation" | "sidecar" | "post_generation";

/**
 * The configuration of one kind of side call. The kind itself is code; this is
 * what a user gets to change about it (SPEC §7's per-op row).
 */
export type InjectionRole = "system" | "user" | "assistant";

export const INJECTION_ROLES: readonly InjectionRole[] = ["system", "user", "assistant"];

export function isInjectionRole(value: unknown): value is InjectionRole {
  return typeof value === "string" && (INJECTION_ROLES as readonly string[]).includes(value);
}

export interface TaskDto {
  key: string;
  label: string;
  description: string;
  stage: TaskStage;
  /**
   * A side call runs off the main path on its own model; a turn instruction is
   * words inside a user-facing generation's prompt. Routing and a timeout only
   * mean something for the first.
   */
  runs: "side_call" | "turn";
  enabled: boolean;
  /** Null means the scene's own model, which works and costs more. */
  connectionProfileId: string | null;
  /** Null means the built-in prompt. */
  promptTemplate: string | null;
  /** The built-in words, so an editor can start from them rather than blank. */
  defaultTemplate: string;
  /** This op's own variables, beyond the ordinary macro set. */
  variables: readonly string[];
  /** Where the op's text lands. Which works best varies by model (§7). */
  injectionRole: InjectionRole;
  /** Whether its button is shown. Hidden is not the same as turned off. */
  buttonVisible: boolean;
  /** Whether this pass runs automatically after a reply (SPEC §7.5). */
  autoTrigger: boolean;
  /**
   * What a pass does to the message it read. `flag` looks and reports;
   * `replace` rewrites and keeps the original. Null for an op that is not a
   * pass at all.
   */
  effect: "flag" | "replace" | null;
  /** False when hiding this op's button would mean nothing. */
  hideable: boolean;
  timeoutMs: number;
}

/**
 * How one run went.
 *
 * `skipped` means the task decided there was nothing to ask. `unusable` means
 * an answer came back that could not be read — which is a different problem
 * from `failed`, and worth telling apart when a cheap model is misbehaving.
 */
export type TaskRunStatus = "ok" | "skipped" | "unusable" | "failed" | "timeout" | "cancelled";

/**
 * A record of one side call. Background tasks must never fail a user-facing
 * generation (SPEC §7), so every failure they have is swallowed by design;
 * this is where the swallowed ones can still be read.
 */
export interface TaskRunDto {
  id: string;
  taskKey: string;
  sceneId: string | null;
  status: TaskRunStatus;
  provider: string | null;
  model: string | null;
  prompt: string | null;
  output: string | null;
  detail: string | null;
  durationMs: number;
  createdAt: number;
}

export interface UpdateTaskRequest {
  enabled?: boolean;
  connectionProfileId?: string | null;
  promptTemplate?: string | null;
  injectionRole?: InjectionRole;
  buttonVisible?: boolean;
  autoTrigger?: boolean;
}

/* ------------------------------------------------------------------ */
/* Persistent guides (SPEC §8)                                         */
/* ------------------------------------------------------------------ */

export type GuideKind = "situational" | "thinking" | "clothes" | "state" | "rules" | "custom";

export const GUIDE_KINDS: readonly GuideKind[] = [
  "situational",
  "thinking",
  "clothes",
  "state",
  "rules",
  "custom",
];

export function isGuideKind(value: unknown): value is GuideKind {
  return typeof value === "string" && (GUIDE_KINDS as readonly string[]).includes(value);
}

/**
 * State a side call writes once and the prompt injects every turn until it is
 * flushed (SPEC §8). Free-form prose on purpose: there is no parse step, so
 * there is nothing to fail.
 */
export interface GuideDto {
  id: string;
  kind: GuideKind;
  label: string;
  content: string;
  /** Cached: SPEC §8 requires Show to state what a guide costs. */
  tokenCount: number;
  /** A person wrote this version, so a refresh leaves it alone. */
  isPinned: boolean;
  updatedAt: number;
}

export interface UpdateGuideRequest {
  content: string;
}

export interface RebuildGuidesRequest {
  /** Omitted rebuilds every guide that is switched on. */
  kind?: GuideKind;
}

/* ------------------------------------------------------------------ */
/* Character dossiers (SPEC §11, §20 phase 32)                         */
/* ------------------------------------------------------------------ */

/** The three tiers §11 asks for. `buried` never reaches a prompt. */
export interface DossierKnowledgeDto {
  public: string;
  private: string;
  buried: string;
}

export interface DossierDto {
  id: string;
  name: string;
  role: string;
  voice: string;
  canonLock: string;
  knowledge: DossierKnowledgeDto;
  standing: string;
  /** How many turns mentioned the name when this was proposed. */
  mentions: number;
  /** True once it has earned a character card; its entry is then off. */
  promoted: boolean;
  /**
   * Exactly what the prompt gets. Shown to the reader so the absence of the
   * buried tier is visible rather than a claim in a hint.
   */
  injected: string;
  /** The lore entry it renders into, for the token cost and the trace. */
  entry: LoreEntryDto | null;
  createdAt: number;
  updatedAt: number;
}

/** A dossier the model proposed, before the reader has accepted it. */
export interface DossierProposalDto {
  name: string;
  role: string;
  voice: string;
  canonLock: string;
  knowledge: DossierKnowledgeDto;
  standing: string;
}

/** A name the scene keeps returning to that has no sheet yet. */
export interface RecurringNameDto {
  name: string;
  mentions: number;
}

/* ------------------------------------------------------------------ */
/* Lorebooks (SPEC §10)                                                */
/* ------------------------------------------------------------------ */

export type LoreSecondaryLogic = "and_any" | "and_all" | "not_any" | "not_all";
export type LoreGroupSelection = "weight" | "prioritize" | "score";
export type LoreDelayFrom = "scene_start" | "branch_point";
export type LorePosition =
  | "before_character"
  | "after_character"
  | "before_examples"
  | "after_examples"
  | "before_history"
  | "at_depth"
  | "outlet";
export type LoreBindingScope = "global" | "scene" | "character" | "persona";

export const LORE_POSITIONS: readonly LorePosition[] = [
  "before_character",
  "after_character",
  "before_examples",
  "after_examples",
  "before_history",
  "at_depth",
  "outlet",
];

export interface LorebookDto {
  id: string;
  name: string;
  description: string | null;
  /**
   * True when the app writes this book rather than the reader — a dossier book
   * (§11). Shown, so where those tokens go is visible, but not detachable:
   * unhooking it would leave dossiers rendering into a book that reaches
   * nothing, and nothing would say so.
   */
  managed: boolean;
  /**
   * The author whose memory this is (§11), by name. Null for every other book.
   *
   * It has no bindings and never will: ownership is what attaches it, so a list
   * that showed it as unbound would be describing the one book that always
   * reaches its scenes as the one that reaches none.
   */
  ownerAuthorName: string | null;
  /** Lowest-priority entries drop when this is exceeded. 0 is no budget (§10). */
  tokenBudget: number;
  scanDepth: number;
  recursionDepth: number;
  entryCount: number;
  /** What this book is attached to, and how. */
  bindings: LoreBindingDto[];
  createdAt: number;
  updatedAt: number;
}

export interface LoreBindingDto {
  id: string;
  scope: LoreBindingScope;
  /** The thing bound to, for every scope but `global`. */
  targetId: string | null;
  targetName: string | null;
}

export interface LoreEntryDto {
  id: string;
  lorebookId: string;
  title: string;
  content: string;
  enabled: boolean;
  tokenCount: number;

  keys: string[];
  secondaryKeys: string[];
  secondaryLogic: LoreSecondaryLogic;
  caseSensitive: boolean;
  matchWholeWords: boolean;
  useRegex: boolean;
  probability: number;
  isConstant: boolean;
  /** Null uses the book's depth. */
  scanDepth: number | null;
  /** Character ULIDs; empty means every character (§10). */
  characterFilter: string[];

  sticky: number;
  cooldown: number;
  delay: number;
  delayFrom: LoreDelayFrom;

  inclusionGroup: string | null;
  groupWeight: number;
  groupSelection: LoreGroupSelection;

  position: LorePosition;
  insertionOrder: number;
  insertionDepth: number;
  insertionRole: InjectionRole;
  outletName: string | null;

  recursionLevel: number;
  nonRecursable: boolean;
  preventFurtherRecursion: boolean;
  automationId: string | null;

  updatedAt: number;
}

/** A book and its entries: what the editor screen loads in one call. */
export interface LorebookWithEntriesDto {
  lorebook: LorebookDto;
  entries: LoreEntryDto[];
}

/** What an imported world info file turned into, and how much of it there was. */
export interface ImportLorebookResponse {
  lorebook: LorebookDto;
  entries: number;
}

export type UpdateLoreEntryRequest = Partial<
  Omit<LoreEntryDto, "id" | "lorebookId" | "tokenCount" | "updatedAt">
>;

export interface CreateLorebookRequest {
  name: string;
  description?: string | null;
}

export interface UpdateLorebookRequest {
  name?: string;
  description?: string | null;
  tokenBudget?: number;
  scanDepth?: number;
  recursionDepth?: number;
}

/**
 * What fired for a scene right now, and what did not (SPEC §10, §3's inspector).
 * The activation test tool in §16 is this endpoint with a scene attached.
 */
export interface LoreActivationDto {
  entryId: string;
  title: string;
  matchedKey: string | null;
  round: number;
  sticky: boolean;
  constant: boolean;
  /** Null when it fired. Otherwise why it did not. */
  skipped: string | null;
}

/* ------------------------------------------------------------------ */
/* Autopilot (SPEC §6)                                                 */
/* ------------------------------------------------------------------ */

/** Why an autopilot loop ended, in one word the row can carry (SPEC §6). */
export type AutopilotStopReason =
  | "cap" /** wrote its allotted turns */
  | "user" /** the reader sent a message */
  | "stopped" /** the stop control */
  | "addressed" /** a character turned to face the reader */
  | "off" /** the scene switched autopilot off mid-run */
  | "error" /** a turn failed */;

/**
 * Where a scene's autopilot stands. The loop itself is memory, not a row: it
 * is an activity this process is performing, and a restart ending it is the
 * honest behaviour rather than a defect to paper over.
 */
export interface AutopilotStateDto {
  active: boolean;
  /** Turns the loop has written this run. */
  turns: number;
  /** The scene's cap, read fresh, so a settings change is reflected at once. */
  maxTurns: number;
  /** Set when the loop has ended; null while it runs or before it ever ran. */
  stopReason: AutopilotStopReason | null;
  /** The generation in flight for the loop, if it is mid-turn. */
  generationId: string | null;
}

/* ------------------------------------------------------------------ */
/* The prompt inspector (SPEC §3, §16, §20 phase 25)                  */
/* ------------------------------------------------------------------ */

/** Where a block sits in the assembled prompt. */
export type BlockPlacement =
  | { kind: "prefix" }
  | { kind: "depth"; depth: number }
  | { kind: "outlet"; name: string };

/** One assembled piece of the prompt, as the inspector shows it (§3). */
export interface PromptBlock {
  id: string;
  /** Human label. */
  label: string;
  /** Where the content came from, for the provenance line. */
  source: string;
  role: "system" | "user" | "assistant";
  content: string;
  placement: BlockPlacement;
  tokens: number;
}

export type EvictionReason = "history_budget" | "hidden" | "summarized";

/** What the budget could not carry, and why (§3). */
export interface EvictedItem {
  blockId: string;
  /** Message identifier where the evicted item was a message. */
  itemId: string | null;
  label: string;
  tokens: number;
  reason: EvictionReason;
}

export type SkipReason =
  | "disabled"
  | "delayed"
  | "cooling_down"
  | "no_match"
  | "secondary_keys"
  | "character_filter"
  | "probability"
  | "group_not_chosen"
  | "book_budget";

/** One lore entry the activation engine considered, and its verdict (§10). */
export interface ActivationTrace {
  entryId: string;
  title: string;
  /** Which key matched, for the "why did this fire" line. */
  matchedKey: string | null;
  /** 0 for the first pass; higher once recursion picked it up. */
  round: number;
  sticky: boolean;
  constant: boolean;
  skipped: SkipReason | null;
}

/**
 * The prompt as it was assembled for one generation: every block, what was
 * evicted, and which lore entries fired and why (§3, §16).
 */
export interface PromptDebugInfo {
  mode: "author" | "single_character";
  tokensAreEstimated: boolean;
  tokenizerId: string;

  budget: number;
  reservedForResponse: number;
  available: number;
  fixedTokens: number;
  historyTokens: number;
  totalTokens: number;
  headroom: number;

  blocks: PromptBlock[];
  evicted: EvictedItem[];
  /** Message identifiers the prompt carried, oldest first. */
  historyIncluded: string[];
  unresolvedOutlets: string[];
  unknownMacros: string[];
  /** Every lore entry considered for this prompt, fired or not (§10). */
  loreTrace: ActivationTrace[];
  /** Chunks the data bank recalled, with their scores (§11). */
  retrievedChunks: RetrievedDocumentTrace[];
  /**
   * What narrative memory recalled, and why (§11 layer 3).
   *
   * §11 asks for a "full retrieval trace in the inspector: what was recalled,
   * its score, why". The two halves of the blend are kept apart here rather
   * than merged into the score, because "it scored 0.7" answers nothing and
   * "similar, but mostly it just matters a lot" answers the question.
   */
  memoryTrace: MemoryRecallTrace[];
}

/** One recalled chunk, for the inspector's retrieval trace (§11). */
export interface RetrievedDocumentTrace {
  documentTitle: string;
  score: number;
  excerpt: string;
}

/** The inspector's answer for one message: the prompt that wrote it. */
export interface PromptInspectorDto {
  generationId: string;
  /** The message the generation produced, when it produced one. */
  messageId: string | null;
  createdAt: number;
  debug: PromptDebugInfo;
}

/* ------------------------------------------------------------------ */
/* Self-update (SPEC §17)                                              */
/* ------------------------------------------------------------------ */

/** How this deployment can be updated, if it can be. */
export type UpdateMode = "git" | "no_git" | "not_a_repo";

/** Where the running code stands against its remote (SPEC §17). */
export interface UpdateStatusDto {
  mode: UpdateMode;
  branch: string | null;
  /** Full sha of HEAD. */
  commit: string | null;
  /** First line of HEAD's commit message. */
  subject: string | null;
  remoteUrl: string | null;
  /** Tracked files with local modifications — an update would be refused. */
  dirty: boolean;
  /** Commits the remote is ahead. Null before the first check. */
  behind: number | null;
  /** Commits this checkout is ahead of the remote. */
  ahead: number | null;
  /** ISO timestamp of the last successful check this process performed. */
  lastCheckedAt: string | null;
  /** Why the last check failed, when it did. */
  error: string | null;
  /** Set once an update is pulled; cleared only by a process restart. */
  restartRequired: boolean;
}

/* ------------------------------------------------------------------ */
/* Prompt option groups and the ban list (SPEC §13.5, §13.6)           */
/* ------------------------------------------------------------------ */

export type OptionCardinality = "one_of" | "any_of";

/**
 * One toggleable prompt fragment (SPEC §13.5). The token count travels with it
 * because that is the argument for modelling this natively: every option is
 * visible as a labelled block with a cost, rather than a switch whose effect on
 * the prompt you cannot see.
 */
export interface OptionDto {
  id: string;
  key: string;
  name: string;
  fragment: string;
  tokenCount: number;
  selected: boolean;
  isBuiltin: boolean;
}

export interface OptionGroupDto {
  id: string;
  key: string;
  name: string;
  description: string;
  /** `one_of` is enforced on write: picking one clears the rest of its group. */
  cardinality: OptionCardinality;
  options: OptionDto[];
}

export interface SceneOptionsDto {
  groups: OptionGroupDto[];
  /** False while the scene is running on the shipped configuration (§22). */
  configured: boolean;
  /** What every selected option costs on every turn, together. */
  tokenCount: number;
}

/**
 * A banned construction (SPEC §13.6). `proposed` is what the analyser writes
 * and is not enforced until somebody accepts it — a task that silently banned
 * phrases would be editing the user's prose on its own authority.
 */
export interface BanPhraseDto {
  id: string;
  phrase: string;
  origin: "builtin" | "user" | "proposed";
  /** How often the analyser has seen it. Recurrence is the evidence (§13.6). */
  hits: number;
  enabled: boolean;
  isGlobal: boolean;
}

export interface BanListDto {
  phrases: BanPhraseDto[];
  /** What the ban block costs on every turn. */
  tokenCount: number;
}

export interface AddBanRequest {
  phrase: string;
  /** Global by default; a scene's own list is the exception (§13.6). */
  scoped?: boolean;
}

/* ------------------------------------------------------------------ */
/* Rolling summarisation (SPEC §11)                                    */
/* ------------------------------------------------------------------ */

/**
 * A condensed record of a run of messages (SPEC §11 layer 1). Unlike a guide,
 * which is the current state of one thing, a summary covers a fixed range and
 * they accumulate — so the prompt carries the paragraph instead of the turns.
 */
export interface SummaryDto {
  id: string;
  content: string;
  coversFromMessageId: string;
  coversToMessageId: string;
  messageCount: number;
  tokenCount: number;
  /** 0 summarises messages, 1 summarises summaries, and so on (§11). */
  level: number;
  /** A person wrote this, so regeneration leaves it alone (§11). */
  isEdited: boolean;
  updatedAt: number;
}

/** What the scene's summaries look like right now, and what is pending. */
export interface SummaryStateDto {
  summaries: SummaryDto[];
  /** Which of them the prompt is carrying, after threshold and freeze (§11). */
  injectedIds: string[];
  /** Messages waiting to be summarised, and how close the trigger is. */
  pendingMessages: number;
  pendingWords: number;
  /** How many raw messages the injected summaries stand in for. */
  coveredMessages: number;
}

export interface UpdateSummaryRequest {
  content: string;
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
  /**
   * What this character answers to beyond their name, for §6's `mention` turn
   * strategy. Ours rather than the card's, so it exports under
   * `extensions.onsen.mention_keywords`.
   */
  mentionKeywords: string[];

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
  /** A loose grouping label, not a tree (SPEC §9). Null means unsorted. */
  folder: string | null;
  /** The card this one was derived from, where it is a variant. */
  parentId: string | null;
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
  mentionKeywords?: string[];
  depthPrompt?: string | null;
  depthPromptDepth?: number;
  depthPromptRole?: PromptRoleName;
  systemPrompt?: string | null;
  postHistoryInstructions?: string | null;
  creatorNotes?: string | null;
  tags?: string[];
  creator?: string | null;
  characterVersion?: string | null;
  folder?: string | null;
}

/** One snapshot in a character's version history (SPEC §9). */
export interface CharacterVersionDto {
  id: string;
  /** The character's name at that point — a rename is itself a version. */
  name: string;
  createdAt: number;
}

/** A full snapshot, for diff and restore (SPEC §9). */
export interface CharacterSnapshotDto {
  id: string;
  createdAt: number;
  /** The editable fields, in the editor's own shape. */
  character: UpdateCharacterRequest & { name: string };
}

/** A saved filter over the library (SPEC §9). */
export interface SavedFilterDto {
  id: string;
  name: string;
  query: CharacterFilterQuery;
}

export interface CharacterFilterQuery {
  q?: string;
  tag?: string;
  folder?: string;
}

/** A bulk edit over a multi-selection (SPEC §9). */
export interface BulkCharacterRequest {
  ids: string[];
  op: "tag" | "untag" | "move" | "delete";
  /** For tag/untag. */
  tag?: string;
  /** For move. */
  folder?: string;
}

export interface BulkCharacterResponse {
  /** Characters touched, in their new state. */
  characters: CharacterDto[];
  deleted: number;
}

/** What an import produced, including anything worth telling the user. */
export interface ImportCharacterResponse {
  character: CharacterDto;
  /** True when the file matched a character already in the library. */
  duplicateOf: string | null;
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Expressions and sprites (SPEC §12, §20 phase 29)                   */
/* ------------------------------------------------------------------ */

/** One labelled sprite in a character's pack. */
export interface ExpressionDto {
  id: string;
  label: string;
  variantIndex: number;
  hasImage: boolean;
}

/** A character's expression pack — the tag-to-sprite binding. */
export interface ExpressionPackDto {
  id: string;
  characterId: string;
  expressions: ExpressionDto[];
}

/** A document in the data bank (SPEC §11). */
export interface DocumentDto {
  id: string;
  sceneId: string | null;
  title: string;
  chunkCount: number;
  createdAt: number;
}

/** The data bank's embeddings provider (SPEC §11). */
export interface EmbeddingsConfigDto {
  baseUrl: string | null;
  model: string | null;
  hasApiKey: boolean;
  apiKeyMask: string | null;
}

/* ------------------------------------------------------------------ */
/* Structured trackers (SPEC §8, phase 31)                            */
/* ------------------------------------------------------------------ */

export type TrackerKind = "scene" | "characters";

/** One tracker's state, as JSON the panel renders field by field. */
export interface TrackerDto {
  id: string;
  kind: TrackerKind;
  /** The state as a JSON string — the schema is enforced at parse time. */
  content: string;
  tokenCount: number;
  isPinned: boolean;
  updatedAt: number;
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
/**
 * Producing a better version of a turn that already exists (SPEC §7).
 *
 * The result is always a sibling of the target, so the original stays one swipe
 * away — asking for a longer version and disliking it must cost nothing.
 */
export type ReviseMode = "expand" | "correct" | "continue";

export const REVISE_MODES: readonly ReviseMode[] = ["expand", "correct", "continue"];

export function isReviseMode(value: unknown): value is ReviseMode {
  return typeof value === "string" && (REVISE_MODES as readonly string[]).includes(value);
}

export interface ReviseRequest {
  mode: ReviseMode;
  /** What to change. Only `correct` reads it. */
  instructions?: string;
}

/**
 * Expand a brief outline into a full message in the reader's own voice
 * (SPEC §7). The result lands in the composer and never auto-sends — it is a
 * draft for the user to accept, edit or throw away.
 */
export type ImpersonatePerson = "first" | "second" | "third";

export const IMPERSONATE_PEOPLE: readonly ImpersonatePerson[] = ["first", "second", "third"];

export function isImpersonatePerson(value: unknown): value is ImpersonatePerson {
  return typeof value === "string" && (IMPERSONATE_PEOPLE as readonly string[]).includes(value);
}

export interface ImpersonateRequest {
  /** The user's outline. May be empty: "write something for me" is a real ask. */
  outline?: string;
  person?: ImpersonatePerson;
}

export interface ImpersonateResponse {
  /** Null when the model could not be reached; `detail` says what happened. */
  text: string | null;
  detail: string | null;
}

export interface SceneSetupRequest {
  authorId?: string | null;
  personaId?: string | null;
  presetId?: string | null;
  connectionProfileId?: string | null;
  turnStrategy?: TurnStrategy;
  /** Where the classifier runs. Null falls back to the scene's own profile. */
  directorProfileId?: string | null;
  /** Steer: a persistent director note, applied until cleared (SPEC §7). */
  directorNote?: string | null;
  /** Whether the post-generation passes run without being asked (§7.5). */
  autoPasses?: boolean;
  /** The question the custom guide asks (SPEC §8). */
  customGuidePrompt?: string | null;
  scenarioOverride?: string | null;
  summarise?: boolean;
  summariseEveryMessages?: number;
  summariseEveryWords?: number;
  summariseThreshold?: number;
  summariseEvict?: boolean;
  oocEnabled?: boolean;
  oocInterval?: number;
  oocInline?: boolean;
  autopilotEnabled?: boolean;
  autopilotMaxTurns?: number;
  vnModeEnabled?: boolean;
  summariseFreeze?: number;
  title?: string;
}
