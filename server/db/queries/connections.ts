import type { Database } from "bun:sqlite";
import { ulid } from "../../lib/ulid.ts";
import { decryptSecret, maskSecret, type Keyring } from "../../lib/crypto.ts";
import {
  MODERN_SAMPLER_DEFAULTS,
  type ConnectionProfileDto,
  type PresetDto,
  type ProviderDto,
  type ProviderKind,
  type SamplerSettings,
} from "../../../shared/types.ts";
import { parseReasoningConfig } from "../../generation/reasoning.ts";

/* ------------------------------------------------------------------ */
/* Row shapes                                                          */
/* ------------------------------------------------------------------ */

interface ProviderRow {
  id: number;
  ulid: string;
  name: string;
  kind: ProviderKind;
  base_url: string | null;
  api_key_encrypted: string | null;
  model: string | null;
  capabilities: string | null;
  enabled: number;
  supports_prefill: number | null;
  instruct_template: string | null;
  created_at: number;
  updated_at: number;
}

interface PresetRow {
  id: number;
  ulid: string;
  name: string;
  sampler_settings: string;
  context_size: number;
  max_response_tokens: number;
  prefill: string | null;
  reasoning_config: string | null;
  is_default: number;
  created_at: number;
  updated_at: number;
}

interface ConnectionProfileRow {
  id: number;
  ulid: string;
  name: string;
  provider_id: number;
  model: string | null;
  preset_id: number | null;
  is_default: number;
  created_at: number;
  updated_at: number;
}

/* ------------------------------------------------------------------ */
/* Mappers                                                             */
/* ------------------------------------------------------------------ */

/**
 * A stored credential is reduced to "there is one" plus its last four
 * characters. Decryption happens here and the plaintext is discarded
 * immediately; it must never reach the client (SPEC §17).
 */
export function toProviderDto(row: ProviderRow, keyring: Keyring): ProviderDto {
  let mask: string | null = null;
  if (row.api_key_encrypted !== null) {
    try {
      mask = maskSecret(decryptSecret(keyring, row.api_key_encrypted));
    } catch {
      // A key encrypted under a different root secret is unreadable rather than
      // fatal — surface it as an unusable credential instead of failing the list.
      mask = "…?";
    }
  }
  return {
    id: row.ulid,
    name: row.name,
    kind: row.kind,
    baseUrl: row.base_url,
    model: row.model,
    hasApiKey: row.api_key_encrypted !== null,
    apiKeyMask: mask,
    enabled: row.enabled === 1,
    supportsPrefill: row.supports_prefill === null ? null : row.supports_prefill === 1,
    instructTemplate: row.instruct_template,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseSamplerSettings(raw: string): SamplerSettings {
  try {
    return JSON.parse(raw) as SamplerSettings;
  } catch {
    return { ...MODERN_SAMPLER_DEFAULTS };
  }
}

export function toPresetDto(row: PresetRow): PresetDto {
  return {
    id: row.ulid,
    name: row.name,
    samplerSettings: parseSamplerSettings(row.sampler_settings),
    contextSize: row.context_size,
    maxResponseTokens: row.max_response_tokens,
    prefill: row.prefill,
    reasoning: parseReasoningConfig(row.reasoning_config),
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toConnectionProfileDto(
  row: ConnectionProfileRow,
  providerUlid: string,
  presetUlid: string | null,
): ConnectionProfileDto {
  return {
    id: row.ulid,
    name: row.name,
    providerId: providerUlid,
    model: row.model,
    presetId: presetUlid,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ------------------------------------------------------------------ */
/* Providers                                                           */
/* ------------------------------------------------------------------ */

export interface NewProvider {
  name: string;
  kind: ProviderKind;
  baseUrl?: string | null;
  /** Already encrypted by the caller — this module never sees plaintext keys. */
  apiKeyEncrypted?: string | null;
  model?: string | null;
}

export function insertProvider(db: Database, input: NewProvider): ProviderRow {
  const now = Date.now();
  return db
    .query(
      `INSERT INTO providers (ulid, name, kind, base_url, api_key_encrypted, model, enabled, created_at, updated_at)
       VALUES ($ulid, $name, $kind, $base_url, $api_key_encrypted, $model, 1, $now, $now)
       RETURNING *`,
    )
    .get({
      ulid: ulid(),
      name: input.name,
      kind: input.kind,
      base_url: input.baseUrl ?? null,
      api_key_encrypted: input.apiKeyEncrypted ?? null,
      model: input.model ?? null,
      now,
    }) as ProviderRow;
}

export function listProviders(db: Database): ProviderRow[] {
  return db.query("SELECT * FROM providers ORDER BY id").all() as ProviderRow[];
}

export function findProviderByUlid(db: Database, value: string): ProviderRow | null {
  return (db.query("SELECT * FROM providers WHERE ulid = $ulid").get({ ulid: value }) ??
    null) as ProviderRow | null;
}

/* ------------------------------------------------------------------ */
/* Presets                                                             */
/* ------------------------------------------------------------------ */

/**
 * Create the preset a fresh install starts from. Named rather than anonymous so
 * the preset editor (phase 17) has something coherent to show.
 */
export function insertDefaultPreset(db: Database, name: string): PresetRow {
  const now = Date.now();
  return db
    .query(
      `INSERT INTO presets (ulid, name, sampler_settings, context_size, max_response_tokens, is_default, created_at, updated_at)
       VALUES ($ulid, $name, $sampler_settings, 32768, 1024, 1, $now, $now)
       RETURNING *`,
    )
    .get({
      ulid: ulid(),
      name,
      sampler_settings: JSON.stringify(MODERN_SAMPLER_DEFAULTS),
      now,
    }) as PresetRow;
}

export function findDefaultPreset(db: Database): PresetRow | null {
  return (db.query("SELECT * FROM presets WHERE is_default = 1").get() ?? null) as PresetRow | null;
}

export function listPresets(db: Database): PresetRow[] {
  return db.query("SELECT * FROM presets ORDER BY id").all() as PresetRow[];
}

/* ------------------------------------------------------------------ */
/* Connection profiles                                                 */
/* ------------------------------------------------------------------ */

export interface NewConnectionProfile {
  name: string;
  providerId: number;
  model?: string | null;
  presetId?: number | null;
  isDefault?: boolean;
}

export function insertConnectionProfile(
  db: Database,
  input: NewConnectionProfile,
): ConnectionProfileRow {
  const now = Date.now();
  // A partial unique index enforces one default, so the old one is cleared
  // first — otherwise adding a profile and asking for it to be the default is
  // a constraint violation rather than the obvious thing happening.
  if (input.isDefault === true) {
    db.query("UPDATE connection_profiles SET is_default = 0").run();
  }
  return db
    .query(
      `INSERT INTO connection_profiles (ulid, name, provider_id, model, preset_id, is_default, created_at, updated_at)
       VALUES ($ulid, $name, $provider_id, $model, $preset_id, $is_default, $now, $now)
       RETURNING *`,
    )
    .get({
      ulid: ulid(),
      name: input.name,
      provider_id: input.providerId,
      model: input.model ?? null,
      preset_id: input.presetId ?? null,
      is_default: input.isDefault ? 1 : 0,
      now,
    }) as ConnectionProfileRow;
}

export function listConnectionProfiles(db: Database): ConnectionProfileRow[] {
  return db.query("SELECT * FROM connection_profiles ORDER BY id").all() as ConnectionProfileRow[];
}

/** Resolve the ULIDs a profile DTO needs without an N+1 per row. */
export function ulidLookup(db: Database, table: "providers" | "presets"): Map<number, string> {
  const rows = db.query(`SELECT id, ulid FROM ${table}`).all() as { id: number; ulid: string }[];
  return new Map(rows.map((row) => [row.id, row.ulid]));
}

export type { ProviderRow, PresetRow, ConnectionProfileRow };

/* ------------------------------------------------------------------ */
/* Editing (SPEC §20 phase 13)                                         */
/* ------------------------------------------------------------------ */

export interface ProviderPatch {
  name?: string;
  baseUrl?: string | null;
  /**
   * Undefined leaves the stored key alone, null clears it, a string replaces
   * it. Three states, because "the field came back empty" must not silently
   * delete a credential the user never touched (SPEC §17).
   */
  apiKeyEncrypted?: string | null;
  model?: string | null;
  enabled?: boolean;
  /** Null restores the adapter's own answer rather than meaning "no" (§13). */
  supportsPrefill?: boolean | null;
  /** Text completion only: which instruct template marks the turns (§4). */
  instructTemplate?: string | null;
}

export function updateProvider(db: Database, id: number, patch: ProviderPatch): ProviderRow {
  const current = db.query("SELECT * FROM providers WHERE id = $id").get({ id }) as ProviderRow;
  return db
    .query(
      `UPDATE providers
          SET name = $name, base_url = $base_url, api_key_encrypted = $key,
              model = $model, enabled = $enabled, supports_prefill = $prefill,
              instruct_template = $instruct, updated_at = $now
        WHERE id = $id
        RETURNING *`,
    )
    .get({
      id,
      name: patch.name ?? current.name,
      base_url: patch.baseUrl === undefined ? current.base_url : patch.baseUrl,
      key: patch.apiKeyEncrypted === undefined ? current.api_key_encrypted : patch.apiKeyEncrypted,
      model: patch.model === undefined ? current.model : patch.model,
      enabled: patch.enabled === undefined ? current.enabled : patch.enabled ? 1 : 0,
      // Three-valued, and the three cases are all real: absent leaves it,
      // null restores the adapter's own answer, a boolean overrides it (§13).
      prefill:
        patch.supportsPrefill === undefined
          ? current.supports_prefill
          : patch.supportsPrefill === null
            ? null
            : patch.supportsPrefill
              ? 1
              : 0,
      instruct:
        patch.instructTemplate === undefined ? current.instruct_template : patch.instructTemplate,
      now: Date.now(),
    }) as ProviderRow;
}

export function findProviderById(db: Database, id: number): ProviderRow | null {
  return (db.query("SELECT * FROM providers WHERE id = $id").get({ id }) ?? null) as
    | ProviderRow
    | null;
}

/**
 * Deleting a provider takes its profiles with it — a profile with no provider
 * has nowhere to send a request. Scenes pointing at those profiles survive with
 * a null, which is the state a scene created before any profile is already in.
 */
export function deleteProvider(db: Database, id: number): void {
  db.query("DELETE FROM providers WHERE id = $id").run({ id });
}

export function findConnectionProfileByUlid(
  db: Database,
  value: string,
): ConnectionProfileRow | null {
  return (db.query("SELECT * FROM connection_profiles WHERE ulid = $ulid").get({ ulid: value }) ??
    null) as ConnectionProfileRow | null;
}

export interface ConnectionProfilePatch {
  name?: string;
  providerId?: number;
  model?: string | null;
  presetId?: number | null;
  isDefault?: boolean;
}

export function updateConnectionProfile(
  db: Database,
  id: number,
  patch: ConnectionProfilePatch,
): ConnectionProfileRow {
  const current = db
    .query("SELECT * FROM connection_profiles WHERE id = $id")
    .get({ id }) as ConnectionProfileRow;

  // One default at a time, cleared before the new one is set so the two can
  // never both be true even for an instant.
  if (patch.isDefault === true) {
    db.query("UPDATE connection_profiles SET is_default = 0").run();
  }

  return db
    .query(
      `UPDATE connection_profiles
          SET name = $name, provider_id = $provider, model = $model, preset_id = $preset,
              is_default = $is_default, updated_at = $now
        WHERE id = $id
        RETURNING *`,
    )
    .get({
      id,
      name: patch.name ?? current.name,
      provider: patch.providerId ?? current.provider_id,
      model: patch.model === undefined ? current.model : patch.model,
      preset: patch.presetId === undefined ? current.preset_id : patch.presetId,
      is_default: patch.isDefault === undefined ? current.is_default : patch.isDefault ? 1 : 0,
      now: Date.now(),
    }) as ConnectionProfileRow;
}

/**
 * Deleting a profile leaves the scenes that used it pointing at nothing, which
 * the schema handles with ON DELETE SET NULL and the generation service reports
 * as "this scene has no connection profile". Losing the setting is recoverable;
 * losing the scene would not be.
 */
export function deleteConnectionProfile(db: Database, id: number): void {
  db.query("DELETE FROM connection_profiles WHERE id = $id").run({ id });
}

/** How many profiles exist, so the last one is not deleted out from under a scene. */
export function countConnectionProfiles(db: Database): number {
  return (db.query("SELECT COUNT(*) AS n FROM connection_profiles").get() as { n: number }).n;
}

/* ------------------------------------------------------------------ */
/* Presets (SPEC §13)                                                  */
/* ------------------------------------------------------------------ */

export interface PresetPatch {
  name?: string;
  samplerSettings?: SamplerSettings;
  contextSize?: number;
  maxResponseTokens?: number;
  prefill?: string | null;
  reasoningConfig?: string;
}

export function findPresetByUlid(db: Database, ulidValue: string): PresetRow | null {
  return (db.query("SELECT * FROM presets WHERE ulid = $ulid").get({ ulid: ulidValue }) ?? null) as
    | PresetRow
    | null;
}

export function updatePreset(db: Database, id: number, patch: PresetPatch): PresetRow {
  const current = db.query("SELECT * FROM presets WHERE id = $id").get({ id }) as PresetRow;
  return db
    .query(
      `UPDATE presets
          SET name = $name, sampler_settings = $samplers, context_size = $context,
              max_response_tokens = $max, prefill = $prefill,
              reasoning_config = $reasoning, updated_at = $now
        WHERE id = $id
        RETURNING *`,
    )
    .get({
      id,
      name: patch.name ?? current.name,
      samplers:
        patch.samplerSettings === undefined
          ? current.sampler_settings
          : JSON.stringify(patch.samplerSettings),
      context: patch.contextSize ?? current.context_size,
      max: patch.maxResponseTokens ?? current.max_response_tokens,
      prefill: patch.prefill === undefined ? current.prefill : patch.prefill,
      reasoning: patch.reasoningConfig ?? current.reasoning_config,
      now: Date.now(),
    }) as PresetRow;
}
