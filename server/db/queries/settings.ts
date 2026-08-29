import type { Database } from "bun:sqlite";

/** Keys used in `app_settings`. Kept in one place so they cannot drift. */
export const SettingKey = {
  passwordHash: "auth.password_hash",
  /**
   * Bumped on password change so every previously issued session cookie stops
   * verifying (server/lib/crypto.ts).
   */
  sessionGeneration: "auth.session_generation",
  setupCompletedAt: "setup.completed_at",
} as const;

export type SettingKeyName = (typeof SettingKey)[keyof typeof SettingKey];

export function getSetting(db: Database, key: string): string | null {
  const row = db.query("SELECT value FROM app_settings WHERE key = $key").get({ key }) as
    | { value: string }
    | null;
  return row?.value ?? null;
}

export function setSetting(db: Database, key: string, value: string): void {
  db.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($key, $value, $updated_at)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run({ key, value, updated_at: Date.now() });
}

export function getNumericSetting(db: Database, key: string, fallback: number): number {
  const raw = getSetting(db, key);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** True once the setup wizard has stored a password (SPEC §17). */
export function isSetupCompleted(db: Database): boolean {
  return getSetting(db, SettingKey.setupCompletedAt) !== null;
}

export function getSessionGeneration(db: Database): number {
  return getNumericSetting(db, SettingKey.sessionGeneration, 1);
}

export function bumpSessionGeneration(db: Database): number {
  const next = getSessionGeneration(db) + 1;
  setSetting(db, SettingKey.sessionGeneration, String(next));
  return next;
}
