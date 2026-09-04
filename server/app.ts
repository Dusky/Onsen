import { Hono } from "hono";
import type { AppContext, AppEnv } from "./context.ts";
import { sessionMiddleware } from "./middleware/session.ts";
import { withOrigin } from "./sync/channel.ts";
import { authRoutes } from "./routes/auth.ts";
import { setupRoutes } from "./routes/setup.ts";
import { connectionRoutes } from "./routes/connections.ts";
import { sceneRoutes } from "./routes/scenes.ts";
import { characterRoutes } from "./routes/characters.ts";
import { authorRoutes, personaRoutes } from "./routes/authors.ts";
import { generationRoutes, sceneGenerationRoutes } from "./routes/generation.ts";
import { GenerationService } from "./generation/service.ts";
import { TaskRunner } from "./tasks/runner.ts";
import { PassPipeline } from "./passes/pipeline.ts";
import { GuideRunner } from "./guides/runner.ts";
import { TrackerRunner } from "./trackers/runner.ts";
import { SummaryRunner } from "./summaries/runner.ts";
import { BanAnalyser } from "./options/runner.ts";
import { AutopilotRunner } from "./generation/autopilot.ts";
import { taskRoutes } from "./routes/tasks.ts";
import { systemRoutes } from "./routes/system.ts";
import { filterRoutes } from "./routes/filters.ts";
import { authoringRoutes } from "./routes/authoring.ts";
import { dossierRoutes } from "./routes/dossiers.ts";
import { documentRoutes } from "./routes/documents.ts";
import { demoRoutes } from "./routes/demo.ts";
import { loreRoutes } from "./routes/lore.ts";
import { scriptRoutes } from "./routes/scripts.ts";
import { triggerRoutes } from "./routes/triggers.ts";
import { packRoutes } from "./routes/packs.ts";
import { webhookRoutes } from "./routes/webhooks.ts";
import { openAiRoutes } from "./routes/openai.ts";
import { apiKeyRoutes, sceneApiRoutes } from "./routes/api-keys.ts";
import { memoryRoutes } from "./routes/memory.ts";
import { createRateLimiter } from "./middleware/rate-limit.ts";
import { hashToken } from "./db/queries/api-keys.ts";
import { WebhookSender } from "./webhooks/sender.ts";
import { MemoryRunner } from "./memory/runner.ts";
import { AuthorMemory } from "./memory/author.ts";
import { TriggerRunner } from "./triggers/runner.ts";
import type { createAdapter } from "./adapters/index.ts";
import { spaStatic } from "./static.ts";

export interface CreateAppOptions {
  /** Off in tests, where there is no built client to serve. */
  serveClient?: boolean;
  /**
   * Supplied by tests so no live provider is contacted (§23). In production the
   * app owns its generation service, and hands it back so the process can
   * cancel everything in flight on shutdown.
   */
  generationService?: GenerationService;
  /** Injected together with a generation service, so both share one runner. */
  taskRunner?: TaskRunner;
  passPipeline?: PassPipeline;
  guideRunner?: GuideRunner;
  trackerRunner?: TrackerRunner;
  summaryRunner?: SummaryRunner;
  banAnalyser?: BanAnalyser;
  /** Injected in tests so no live provider is ever contacted (§23). */
  createAdapter?: typeof createAdapter;
  /** Injected in tests, so no webhook request ever leaves the process (§23). */
  webhookSender?: WebhookSender;
  memoryRunner?: MemoryRunner;
}

export interface CreatedApp {
  app: Hono<AppEnv>;
  generation: GenerationService;
  /** Side calls (SPEC §7). Owned here so shutdown can stop admitting them. */
  tasks: TaskRunner;
  /** The post-generation pipeline (SPEC §7.5), for the same reason. */
  passes: PassPipeline;
  /** The persistent guides (SPEC §8), for the same reason. */
  guides: GuideRunner;
  /** The structured trackers (SPEC §8), for the same reason. */
  trackers: TrackerRunner;
  /** Rolling summarisation (SPEC §11), for the same reason. */
  summaries: SummaryRunner;
  /** Proposing bans (SPEC §13.6), for the same reason. */
  bans: BanAnalyser;
  /** The scene-writing loop (SPEC §6). Owned so shutdown can stop it. */
  autopilot: AutopilotRunner;
  /** §14's event triggers, for the same reason. */
  triggers: TriggerRunner;
  /** §15's outbound webhooks, for the same reason. */
  webhooks: WebhookSender;
  /** §11 layer 3's extractor, for the same reason. */
  memory: MemoryRunner;
}

/** Build the app and the services it owns. */
export function createServer(ctx: AppContext, options: CreateAppOptions = {}): CreatedApp {
  const tasks =
    options.taskRunner ??
    new TaskRunner({
      db: ctx.db,
      keyring: ctx.keyring,
      ...(options.createAdapter === undefined ? {} : { createAdapter: options.createAdapter }),
    });
  const passes = options.passPipeline ?? new PassPipeline({ db: ctx.db, tasks });
  const guides = options.guideRunner ?? new GuideRunner({ db: ctx.db, tasks });
  const trackers = options.trackerRunner ?? new TrackerRunner({ db: ctx.db, tasks });
  const summaries = options.summaryRunner ?? new SummaryRunner({ db: ctx.db, tasks });
  const bans = options.banAnalyser ?? new BanAnalyser({ db: ctx.db, tasks });
  const generation =
    options.generationService ??
    new GenerationService({ db: ctx.db, keyring: ctx.keyring, tasks, passes, guides, trackers, summaries });  const triggers = new TriggerRunner({ db: ctx.db, guides, trackers });
  generation.setTriggers(triggers);
  const webhooks =
    options.webhookSender ??
    new WebhookSender({ db: ctx.db, keyring: ctx.keyring });
  generation.setWebhooks(webhooks);
  trackers.setWebhooks(webhooks);
  const memory = options.memoryRunner ?? new MemoryRunner({ db: ctx.db, keyring: ctx.keyring, tasks });
  generation.setMemory(memory);
  const authorMemory = new AuthorMemory({ db: ctx.db, tasks });
  const autopilot = new AutopilotRunner({ db: ctx.db, tasks });
  // Bound both ways, late, because each needs the other: the service reports
  // landings, the runner starts turns (SPEC §6).
  generation.setAutopilot(autopilot);
  autopilot.attach(generation);
  const app = new Hono<AppEnv>();

  /**
   * Which device is making this request (SPEC §5).
   *
   * A header the client sets per tab, carried through the handler so that when
   * the storage layer announces a leaf move it can say who moved it. Without
   * it, last-write-wins has no loser: every client would prompt itself about
   * its own write.
   */
  app.use("*", async (c, next) => {
    const origin = c.req.header("X-Onsen-Client") ?? null;
    await withOrigin(origin === null ? null : origin.slice(0, 64), () => next());
  });

  /**
   * §19's outbound API, mounted before the session middleware and outside
   * `/api`.
   *
   * Deliberately outside both. This surface is addressed by machines holding
   * bearer tokens; a cookie has no business here, and a cookie that *worked*
   * here would make every page on the internet able to drive a scene through
   * the reader's own browser.
   *
   * Rate-limited per key, as §19 asks: it is machine-accessible, so the failure
   * mode is a loop nobody is watching rather than a person clicking twice.
   */
  const apiLimiter = createRateLimiter({
    limit: 120,
    windowMs: 60_000,
    scope: "outbound-api",
    // The bearer token, hashed, so the bucket is the key rather than the
    // address every tunnelled request shares.
    identify: (request) => {
      const header = request.headers.get("Authorization");
      const match = header === null ? null : /^Bearer\s+(.+)$/i.exec(header.trim());
      return match === null ? null : hashToken(match[1]!.trim());
    },
  });
  app.use("/v1/*", apiLimiter.middleware);
  app.route("/v1", openAiRoutes({ ctx, generation }));

  app.use("*", sessionMiddleware(ctx));

  const api = new Hono<AppEnv>();
  api.get("/health", (c) => c.json({ ok: true }));
  api.route("/", authRoutes(ctx));
  api.route("/", setupRoutes(ctx));
  api.route("/connections", connectionRoutes(ctx));
  api.route("/scenes", sceneRoutes(ctx, autopilot, triggers, webhooks));
  api.route(
    "/scenes",
    sceneGenerationRoutes(ctx, generation, tasks, passes, guides, trackers, summaries, bans, autopilot),
  );
  api.route("/generations", generationRoutes(generation));
  api.route("/characters", characterRoutes(ctx, tasks));
  api.route("/authors", authorRoutes(ctx));
  api.route("/personas", personaRoutes(ctx));
  api.route("/tasks", taskRoutes(ctx));
  api.route("/system", systemRoutes(ctx));
  api.route("/filters", filterRoutes(ctx));
  api.route("/authoring", authoringRoutes(ctx, tasks));
  api.route("/documents", documentRoutes(ctx));
  api.route("/demo", demoRoutes(ctx));
  api.route("/scripts", scriptRoutes(ctx));
  api.route("/triggers", triggerRoutes(ctx, triggers));
  api.route("/packs", packRoutes(ctx));
  api.route("/webhooks", webhookRoutes(ctx, webhooks));
  api.route("/api-keys", apiKeyRoutes(ctx));
  api.route("/scene-api", sceneApiRoutes(ctx));
  api.route("/memory", memoryRoutes(ctx, memory, authorMemory));
  api.route("/lorebooks", loreRoutes(ctx));
  api.route("/dossiers", dossierRoutes(ctx));

  // An unknown API path is an API error, not the SPA shell — returning HTML
  // from a fetch is the kind of thing that costs an hour to diagnose.
  api.all("*", (c) =>
    c.json({ error: { code: "not_found", message: `No route for ${c.req.path}` } }, 404),
  );

  app.route("/api", api);

  if (options.serveClient !== false) {
    app.use("*", spaStatic(ctx.config.clientDir));
  }

  return {
    app,
    generation,
    tasks,
    passes,
    guides,
    trackers,
    summaries,
    bans,
    autopilot,
    triggers,
    webhooks,
    memory,
  };
}

/** The app alone, for callers that do not need the services. */
export function createApp(ctx: AppContext, options: CreateAppOptions = {}): Hono<AppEnv> {
  return createServer(ctx, options).app;
}
