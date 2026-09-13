import type { Database } from "bun:sqlite";
import { decryptSecret, type Keyring } from "../lib/crypto.ts";
import type { ProviderKind } from "../../shared/types.ts";

/**
 * Turning a connection profile into everything needed to reach a provider.
 *
 * Shared rather than private to the generation service because per-operation
 * routing is the point (SPEC §7): a background task runs on its own profile and
 * control returns to the scene's. Both paths resolve a profile the same way, so
 * both should fail the same way too — with a message that says which provider
 * and what is wrong with it, rather than "request failed".
 */

export interface ResolvedRoute {
  kind: ProviderKind;
  providerName: string;
  baseUrl: string;
  apiKey: string | null;
  model: string;
  presetId: number | null;
  /**
   * Whether this endpoint accepts a prefill (§13). Null means the adapter's own
   * default stands — prefill is a property of the endpoint, not the wire
   * format, so an operator can say what their local server actually does.
   */
  supportsPrefill: boolean | null;
  /**
   * Text completion only: which instruct template marks the turns (§4). Null
   * takes the shipped default. Named rather than resolved here so this module
   * stays a plain read of the two rows.
   */
  instructTemplateId: string | null;
}

export class RouteError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RouteError";
    this.code = code;
  }
}

export interface RouteRequest {
  /** The profile to run on. Null is a real state: nothing has been chosen. */
  profileId: number | null;
  /**
   * A model this one scene has chosen, beating the profile's (§20 phase 180).
   * Null or absent means the profile decides, which is the ordinary case.
   */
  model?: string | null;
  /**
   * A provider this one scene has chosen, beating the profile's (§20 phase
   * 181). Null or absent means the profile's provider, as ever.
   */
  providerId?: number | null;
}

export function resolveRoute(
  db: Database,
  keyring: Keyring,
  request: RouteRequest,
): ResolvedRoute {
  if (request.profileId === null) {
    throw new RouteError(
      "no_connection",
      "This scene has no connection profile. Choose one before generating.",
    );
  }

  /*
   * The profile and the provider are fetched separately rather than joined,
   * because a scene can now override the provider (§20 phase 181) and the
   * join hardcoded "the profile's". The profile still supplies the preset and
   * its own model; which provider serves the turn is a separate question.
   */
  const profile = db
    .query("SELECT model AS profile_model, preset_id, provider_id FROM connection_profiles WHERE id = $id")
    .get({ id: request.profileId }) as
    | { profile_model: string | null; preset_id: number | null; provider_id: number }
    | null;

  if (profile === null) {
    throw new RouteError("no_connection", "That connection profile no longer exists.");
  }

  /** The scene's own provider if it named one, else the profile's. */
  const overridden = request.providerId != null && request.providerId !== profile.provider_id;
  const providerId = overridden ? request.providerId! : profile.provider_id;

  const row = db
    .query(
      `SELECT name AS provider_name, kind, base_url, api_key_encrypted,
              model AS provider_model, enabled, supports_prefill, instruct_template
         FROM providers WHERE id = $id`,
    )
    .get({ id: providerId }) as
    | {
        provider_name: string;
        kind: ProviderKind;
        base_url: string | null;
        api_key_encrypted: string | null;
        provider_model: string | null;
        enabled: number;
        supports_prefill: number | null;
        instruct_template: string | null;
      }
    | null;

  if (row === null) {
    // A provider removed under a scene that had chosen it. `ON DELETE SET
    // NULL` makes this unreachable through the app, but a hand-edited
    // database should say what is wrong rather than crash.
    throw new RouteError("no_connection", "That provider no longer exists.");
  }
  if (row.enabled !== 1) {
    throw new RouteError("provider_disabled", `${row.provider_name} is disabled.`);
  }

  /*
   * Narrowest wins: the scene's own choice, then the profile's, then the
   * provider's default — except that a scene which overrode the *provider*
   * skips the profile's model. A model id belongs to the provider that serves
   * it, so carrying `gpt-4o` across to Anthropic because the profile happened
   * to name it would fail the turn with a model nobody chose.
   */
  const model = request.model ?? (overridden ? row.provider_model : (profile.profile_model ?? row.provider_model));
  if (model === null) {
    throw new RouteError("no_model", `No model is set for ${row.provider_name}.`);
  }
  if (row.base_url === null) {
    throw new RouteError("no_base_url", `No address is set for ${row.provider_name}.`);
  }

  let apiKey: string | null = null;
  if (row.api_key_encrypted !== null) {
    try {
      apiKey = decryptSecret(keyring, row.api_key_encrypted);
    } catch {
      throw new RouteError(
        "unreadable_key",
        `The stored API key for ${row.provider_name} cannot be decrypted. Re-enter it.`,
      );
    }
  }

  return {
    kind: row.kind,
    providerName: row.provider_name,
    baseUrl: row.base_url,
    apiKey,
    model,
    presetId: profile.preset_id,
    supportsPrefill: row.supports_prefill === null ? null : row.supports_prefill === 1,
    instructTemplateId: row.instruct_template,
  };
}
