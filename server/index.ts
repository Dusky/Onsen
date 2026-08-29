import { ensureDataDirs, loadConfig } from "./config.ts";
import { openDatabase } from "./db/index.ts";
import { migrate } from "./db/migrate.ts";
import { loadOrCreateKeyring } from "./lib/crypto.ts";
import { createServer } from "./app.ts";
import { isSetupCompleted } from "./db/queries/settings.ts";
import type { AppContext } from "./context.ts";

const config = loadConfig();
ensureDataDirs(config);

const db = openDatabase(config.dbPath);
const result = migrate(db);
if (result.applied.length > 0) {
  console.log(`onsen: applied migrations ${result.applied.join(", ")}`);
}

const ctx: AppContext = { db, config, keyring: loadOrCreateKeyring(config) };
const { app, generation } = createServer(ctx);

const server = Bun.serve({
  port: config.port,
  hostname: config.host,
  fetch: app.fetch,
});

console.log(`onsen: listening on http://${config.host}:${server.port}`);
console.log(`onsen: data directory ${config.dataDir}`);
if (!isSetupCompleted(db)) {
  console.log("onsen: not set up yet — open the app to run the setup wizard");
}

function shutdown(signal: string): void {
  console.log(`onsen: ${signal}, shutting down`);
  // Abort in-flight generations so upstream inference actually stops (§4).
  generation.shutdown();
  void server.stop();
  db.close();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
