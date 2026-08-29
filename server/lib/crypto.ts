import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { Config } from "../config.ts";

/**
 * All symmetric key material derives from one 32-byte root secret, either
 * supplied by the operator or generated into the data directory on first boot.
 * Provider API keys are encrypted with it at rest (SPEC §17), and session
 * cookies are signed with it.
 */

const KEY_BYTES = 32;
const IV_BYTES = 12; // GCM standard nonce length
const SECRET_FILENAME = "secret.key";

export interface Keyring {
  /** AES-256-GCM key for provider credentials. */
  secretbox: Buffer;
  /** HMAC-SHA256 key for session cookies. */
  session: Buffer;
}

function derive(root: Buffer, info: string): Buffer {
  return Buffer.from(hkdfSync("sha256", root, Buffer.alloc(0), info, KEY_BYTES));
}

/**
 * Resolve the root secret. `ONSEN_SECRET_KEY` (base64, 32 bytes) wins so that
 * container deployments can inject it; otherwise it is persisted to the data
 * directory with owner-only permissions.
 */
export function loadOrCreateKeyring(config: Config, env: NodeJS.ProcessEnv = process.env): Keyring {
  let root: Buffer;
  const fromEnv = env.ONSEN_SECRET_KEY;

  if (fromEnv) {
    root = Buffer.from(fromEnv, "base64");
    if (root.length !== KEY_BYTES) {
      throw new Error(
        `ONSEN_SECRET_KEY must be ${KEY_BYTES} base64-encoded bytes, got ${root.length}`,
      );
    }
  } else {
    const path = join(config.dataDir, SECRET_FILENAME);
    if (existsSync(path)) {
      root = Buffer.from(readFileSync(path, "utf8").trim(), "base64");
      if (root.length !== KEY_BYTES) {
        throw new Error(`${path} is corrupt: expected ${KEY_BYTES} bytes of key material`);
      }
    } else {
      root = randomBytes(KEY_BYTES);
      writeFileSync(path, root.toString("base64"), { encoding: "utf8", mode: 0o600 });
      chmodSync(path, 0o600); // in case the file pre-existed with a laxer mode
    }
  }

  return {
    secretbox: derive(root, "onsen:secretbox:v1"),
    session: derive(root, "onsen:session:v1"),
  };
}

/** Encrypt a provider credential for storage. Output is self-describing. */
export function encryptSecret(keyring: Keyring, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyring.secretbox, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${Buffer.concat([body, tag]).toString("base64url")}`;
}

export function decryptSecret(keyring: Keyring, envelope: string): string {
  const parts = envelope.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") {
    throw new Error("cannot decrypt: unrecognised secret envelope");
  }
  const iv = Buffer.from(parts[1]!, "base64url");
  const payload = Buffer.from(parts[2]!, "base64url");
  if (payload.length < 16) throw new Error("cannot decrypt: truncated payload");
  const body = payload.subarray(0, payload.length - 16);
  const tag = payload.subarray(payload.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", keyring.secretbox, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

/**
 * What the client is allowed to see of a credential. API keys are never
 * returned in full (SPEC §17); the tail is enough to tell two keys apart.
 */
export function maskSecret(plaintext: string): string {
  if (plaintext.length === 0) return "";
  if (plaintext.length <= 4) return "…";
  return `…${plaintext.slice(-4)}`;
}

/* ------------------------------------------------------------------ */
/* Session tokens                                                      */
/* ------------------------------------------------------------------ */

export interface SessionClaims {
  /** Issued-at, epoch ms. */
  iat: number;
  /** Expiry, epoch ms. */
  exp: number;
  /**
   * Invalidation generation. Bumped on password change so existing cookies
   * stop verifying without needing a session table.
   */
  gen: number;
}

function sign(keyring: Keyring, payload: string): string {
  return createHmac("sha256", keyring.session).update(payload).digest("base64url");
}

export function issueSessionToken(keyring: Keyring, claims: SessionClaims): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${payload}.${sign(keyring, payload)}`;
}

/**
 * Verify a cookie value. Returns the claims, or null for anything malformed,
 * mis-signed, expired, or issued before the current generation.
 */
export function verifySessionToken(
  keyring: Keyring,
  token: string,
  currentGeneration: number,
  now: number = Date.now(),
): SessionClaims | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const provided = Buffer.from(token.slice(dot + 1), "base64url");
  const expected = Buffer.from(sign(keyring, payload), "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  let claims: SessionClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionClaims;
  } catch {
    return null;
  }
  if (typeof claims.exp !== "number" || typeof claims.gen !== "number") return null;
  if (claims.exp <= now) return null;
  if (claims.gen !== currentGeneration) return null;
  return claims;
}
