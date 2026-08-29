import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, ensureDataDirs } from "../server/config.ts";
import {
  decryptSecret,
  encryptSecret,
  issueSessionToken,
  loadOrCreateKeyring,
  maskSecret,
  verifySessionToken,
} from "../server/lib/crypto.ts";

function scratchConfig() {
  const dataDir = mkdtempSync(join(tmpdir(), "onsen-crypto-"));
  const config = loadConfig({ ONSEN_DATA_DIR: dataDir } as NodeJS.ProcessEnv);
  ensureDataDirs(config);
  return { config, dispose: () => rmSync(dataDir, { recursive: true, force: true }) };
}

describe("keyring", () => {
  test("generates a root secret with owner-only permissions and reuses it", () => {
    const { config, dispose } = scratchConfig();
    try {
      const first = loadOrCreateKeyring(config, {} as NodeJS.ProcessEnv);
      const path = join(config.dataDir, "secret.key");
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(Buffer.from(readFileSync(path, "utf8").trim(), "base64")).toHaveLength(32);

      const second = loadOrCreateKeyring(config, {} as NodeJS.ProcessEnv);
      expect(second.secretbox.equals(first.secretbox)).toBe(true);
    } finally {
      dispose();
    }
  });

  test("prefers an injected secret and rejects one of the wrong length", () => {
    const { config, dispose } = scratchConfig();
    try {
      const injected = Buffer.alloc(32, 7).toString("base64");
      const keyring = loadOrCreateKeyring(config, {
        ONSEN_SECRET_KEY: injected,
      } as NodeJS.ProcessEnv);
      expect(keyring.secretbox).toHaveLength(32);
      // Encryption and session keys must be distinct derivations of the root.
      expect(keyring.secretbox.equals(keyring.session)).toBe(false);

      expect(() =>
        loadOrCreateKeyring(config, { ONSEN_SECRET_KEY: "c2hvcnQ=" } as NodeJS.ProcessEnv),
      ).toThrow(/32 base64-encoded bytes/);
    } finally {
      dispose();
    }
  });
});

describe("provider credentials", () => {
  test("round-trips and produces a different envelope each time", () => {
    const { config, dispose } = scratchConfig();
    try {
      const keyring = loadOrCreateKeyring(config, {} as NodeJS.ProcessEnv);
      const secret = "sk-test-abcdef123456";
      const a = encryptSecret(keyring, secret);
      const b = encryptSecret(keyring, secret);
      expect(a).not.toBe(b); // fresh nonce per encryption
      expect(a).not.toContain(secret);
      expect(decryptSecret(keyring, a)).toBe(secret);
      expect(decryptSecret(keyring, b)).toBe(secret);
    } finally {
      dispose();
    }
  });

  test("refuses a tampered envelope rather than returning garbage", () => {
    const { config, dispose } = scratchConfig();
    try {
      const keyring = loadOrCreateKeyring(config, {} as NodeJS.ProcessEnv);
      const envelope = encryptSecret(keyring, "sk-test-abcdef123456");
      const parts = envelope.split(".");
      const body = Buffer.from(parts[2]!, "base64url");
      body[0] = (body[0] ?? 0) ^ 0xff;
      const tampered = `${parts[0]}.${parts[1]}.${body.toString("base64url")}`;
      expect(() => decryptSecret(keyring, tampered)).toThrow();
      expect(() => decryptSecret(keyring, "garbage")).toThrow(/envelope/);
    } finally {
      dispose();
    }
  });

  test("masks a credential down to its last four characters", () => {
    expect(maskSecret("sk-test-abcdef123456")).toBe("…3456");
    expect(maskSecret("abc")).toBe("…");
    expect(maskSecret("")).toBe("");
  });
});

describe("session tokens", () => {
  const { config, dispose } = scratchConfig();
  const keyring = loadOrCreateKeyring(config, {} as NodeJS.ProcessEnv);
  const now = 1_700_000_000_000;
  const claims = { iat: now, exp: now + 60_000, gen: 3 };

  test("verifies a token it issued", () => {
    const token = issueSessionToken(keyring, claims);
    expect(verifySessionToken(keyring, token, 3, now)).toMatchObject({ gen: 3 });
  });

  test("rejects a modified payload", () => {
    const token = issueSessionToken(keyring, claims);
    const forged = issueSessionToken(keyring, { ...claims, gen: 4 }).split(".")[0];
    const tampered = `${forged}.${token.split(".")[1]}`;
    expect(verifySessionToken(keyring, tampered, 4, now)).toBeNull();
  });

  test("rejects an expired token", () => {
    const token = issueSessionToken(keyring, claims);
    expect(verifySessionToken(keyring, token, 3, now + 61_000)).toBeNull();
  });

  test("rejects a token from a previous generation, which is how revocation works", () => {
    const token = issueSessionToken(keyring, claims);
    expect(verifySessionToken(keyring, token, 4, now)).toBeNull();
  });

  test("rejects malformed input without throwing", () => {
    expect(verifySessionToken(keyring, "", 3, now)).toBeNull();
    expect(verifySessionToken(keyring, "nodot", 3, now)).toBeNull();
    expect(verifySessionToken(keyring, ".sig", 3, now)).toBeNull();
    dispose();
  });
});
