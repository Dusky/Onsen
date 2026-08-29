import type { Database } from "bun:sqlite";
import type { Config } from "./config.ts";
import type { Keyring } from "./lib/crypto.ts";

/**
 * Everything a route needs, passed in rather than imported, so that tests can
 * construct an app over an in-memory database.
 */
export interface AppContext {
  db: Database;
  config: Config;
  keyring: Keyring;
}

/** Hono variable map for authenticated requests. */
export interface AppVariables {
  authenticated: boolean;
}

export interface AppEnv {
  Variables: AppVariables;
}
