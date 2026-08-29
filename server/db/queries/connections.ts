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
