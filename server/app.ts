import { Hono } from "hono";
import type { AppContext, AppEnv } from "./context.ts";
import { sessionMiddleware } from "./middleware/session.ts";
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
import { SummaryRunner } from "./summaries/runner.ts";
import { taskRoutes } from "./routes/tasks.ts";
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
  summaryRunner?: SummaryRunner;
  /** Injected in tests so no live provider is ever contacted (§23). */
  createAdapter?: typeof createAdapter;
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
  /** Rolling summarisation (SPEC §11), for the same reason. */
  summaries: SummaryRunner;
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
  const summaries = options.summaryRunner ?? new SummaryRunner({ db: ctx.db, tasks });
  const generation =
    options.generationService ??
    new GenerationService({ db: ctx.db, keyring: ctx.keyring, tasks, passes, guides, summaries });
  const app = new Hono<AppEnv>();

  app.use("*", sessionMiddleware(ctx));

  const api = new Hono<AppEnv>();
  api.get("/health", (c) => c.json({ ok: true }));
  api.route("/", authRoutes(ctx));
  api.route("/", setupRoutes(ctx));
  api.route("/connections", connectionRoutes(ctx));
  api.route("/scenes", sceneRoutes(ctx));
  api.route("/scenes", sceneGenerationRoutes(ctx, generation, tasks, passes, guides, summaries));
  api.route("/generations", generationRoutes(generation));
  api.route("/characters", characterRoutes(ctx));
  api.route("/authors", authorRoutes(ctx));
  api.route("/personas", personaRoutes(ctx));
  api.route("/tasks", taskRoutes(ctx));

  // An unknown API path is an API error, not the SPA shell — returning HTML
  // from a fetch is the kind of thing that costs an hour to diagnose.
  api.all("*", (c) =>
    c.json({ error: { code: "not_found", message: `No route for ${c.req.path}` } }, 404),
  );

  app.route("/api", api);

  if (options.serveClient !== false) {
    app.use("*", spaStatic(ctx.config.clientDir));
  }

  return { app, generation, tasks, passes, guides, summaries };
}

/** The app alone, for callers that do not need the services. */
export function createApp(ctx: AppContext, options: CreateAppOptions = {}): Hono<AppEnv> {
  return createServer(ctx, options).app;
}
