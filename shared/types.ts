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
