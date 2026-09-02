import { ensureDataDirs, loadConfig } from "./config.ts";
import { openDatabase } from "./db/index.ts";
import { migrate } from "./db/migrate.ts";
import { seedBuiltins } from "./db/queries/options.ts";
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
// The shipped option groups and ban phrases (SPEC §13.5, §13.6). Seeded at
// boot rather than in a migration because they are content, not schema: the
// words improve, and idempotent-by-key means an install gets new built-ins
// without losing anything it has edited.
seedBuiltins(db);

const ctx: AppContext = { db, config, keyring: loadOrCreateKeyring(config) };
const { app, generation, tasks, passes, guides, trackers, autopilot } = createServer(ctx);

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
  // Abort in-flight generations so upstream inference actually stops (§4), and
  // stop admitting side calls — a background task that reaches the database
  // after it is closed is the SIGTERM path, not a test artefact (§7).
  generation.shutdown();
  tasks.shutdown();
  passes.shutdown();
  guides.shutdown();
  trackers.shutdown();
  // The loop ends with the process — a scene writing itself with nobody
  // watching is not the feature the reader turned on (SPEC §6).
  autopilot.shutdown();
  void server.stop();
  db.close();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
