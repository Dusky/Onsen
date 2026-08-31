import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Deployment configuration (SPEC §17). Everything the operator can change lives
 * here and comes from the environment, so a container only needs a mounted
 * volume and a port.
 */
export interface Config {
  /** Root of all mutable state: database, avatars, sprites, uploads. */
  dataDir: string;
  dbPath: string;
  uploadsDir: string;
  avatarsDir: string;
  port: number;
  host: string;
  /** Cookies get the Secure attribute only when we know we are behind TLS. */
  secureCookies: boolean;
  /** Directory holding the built SPA, served by the same process as the API. */
  clientDir: string;
  /** Git checkout the updater pulls from (§17). Falls back to the cwd. */
  repoDir: string;
}

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = resolve(env.ONSEN_DATA_DIR ?? "./data");
  return {
    dataDir,
    dbPath: env.ONSEN_DB_PATH ? resolve(env.ONSEN_DB_PATH) : join(dataDir, "onsen.db"),
    uploadsDir: join(dataDir, "uploads"),
    avatarsDir: join(dataDir, "avatars"),
    port: Number(env.ONSEN_PORT ?? env.PORT ?? 8787),
    host: env.ONSEN_HOST ?? "0.0.0.0",
    secureCookies: envFlag("ONSEN_SECURE_COOKIES", false),
    clientDir: resolve(env.ONSEN_CLIENT_DIR ?? "./dist/client"),
    repoDir: resolve(env.ONSEN_REPO_DIR ?? "."),
  };
}

/** Create the data directories. Safe to call repeatedly. */
export function ensureDataDirs(config: Config): void {
  for (const dir of [config.dataDir, config.uploadsDir, config.avatarsDir]) {
    mkdirSync(dir, { recursive: true });
  }
}
