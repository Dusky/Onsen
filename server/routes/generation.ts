import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import { findScene, findMessage, activePath, speakerLookup } from "../db/queries/history.ts";
import {
  isBeatBound,
  isImpersonatePerson,
  isReviseMode,
  isTurnScope,
  type ImpersonateResponse,
} from "../../shared/types.ts";
import { buildImpersonatePrompt, cleanImpersonation } from "../generation/impersonate.ts";
import { createEstimatingTokenizer } from "../prompt/index.ts";
import { IMPERSONATE, taskKind } from "../tasks/registry.ts";
import type { TaskRunner } from "../tasks/runner.ts";
import type { PassPipeline } from "../passes/pipeline.ts";
import type { GuideRunner } from "../guides/runner.ts";
import type { SummaryRunner } from "../summaries/runner.ts";
import type { BanAnalyser } from "../options/runner.ts";
import { activateForScene } from "../lore/scene.ts";
import {
  acceptBan,
  addBan,
  deleteBan,
  findBan,
  findOptionByUlid,
  listBans,
  listGroups,
  listOptions,
  resetSceneOptions,
  sceneHasChosen,
  selectedOptions,
  setBanEnabled,
  setSceneOption,
  toBanDto,
  toGroupDto,
  activeBans,
} from "../db/queries/options.ts";
import {
  activeSummaries,
  countWords,
  deleteSummaries,
  deleteSummary,
  editSummary,
  findSummary,
  injectedSummaries,
  pendingForSummary,
  toSummaryDto,
} from "../db/queries/summaries.ts";
import {
  activeGuides,
  editGuide,
  findGuide,
  flushGuides,
  toGuideDto,
} from "../db/queries/guides.ts";
import { isGuideKind } from "../../shared/types.ts";
import { findAnnotation, revertAnnotation } from "../db/queries/annotations.ts";
import { appendMessage, messageDto } from "../db/queries/history.ts";
import { capabilitiesFor } from "../adapters/index.ts";
import type { ProviderKind } from "../../shared/types.ts";
import type { SceneRow } from "../db/queries/history.ts";
import { GenerationError, type GenerationEvent, type GenerationService } from "../generation/service.ts";

/**
 * Generation over HTTP (SPEC §5).
 *
 * The client starts a generation and gets an identifier back immediately, then
 * opens a separate SSE stream for the output. Splitting them is what makes the
 * stream resumable: the request that started the work is long gone by the time
 * a phone comes back from being suspended, and the stream can be reopened from
 * any offset as many times as the network requires.
 */

/**
 * Which provider a scene generates on, for the capability checks an op has to
 * make before offering itself. Unknown means unknown, not "assume the best":
 * an op that pretends to work is worse than one that says it cannot.
 */
interface SceneProvider {
  kind: ProviderKind;
  model: string | null;
  /** The operator's override, where they set one. Null means "ask the adapter". */
  supportsPrefill: boolean | null;
}

function providerOf(ctx: AppContext, scene: SceneRow): SceneProvider | null {
  if (scene.connection_profile_id === null) return null;
  const row = ctx.db
    .query(
      `SELECT p.kind AS kind, p.model AS model, p.supports_prefill AS prefill
         FROM connection_profiles cp JOIN providers p ON p.id = cp.provider_id
        WHERE cp.id = $id`,
    )
    .get({ id: scene.connection_profile_id }) as
    | { kind: ProviderKind; model: string | null; prefill: number | null }
    | null;
  if (row === null) return null;
  return {
    kind: row.kind,
    model: row.model,
    supportsPrefill: row.prefill === null ? null : row.prefill === 1,
  };
}

/**
 * Continue needs the provider to accept a partial assistant turn (SPEC §7).
 * Where it cannot, the op says so rather than producing a fresh turn that
 * pretends to be a continuation.
 *
 * Three things can answer, in order of authority. The operator's own
 * `supportsPrefill` wins, because they know their endpoint — that field exists
 * precisely because prefill is a property of the endpoint rather than of the
 * wire format. Otherwise the adapter decides, and for Anthropic that depends on
 * the model: prefill was removed from the 4.6 generation onward, so the same
 * provider row answers differently depending on which Claude it names.
 */
function canContinue(ctx: AppContext, scene: SceneRow): boolean {
  const provider = providerOf(ctx, scene);
  if (provider === null) return false;
  if (provider.supportsPrefill !== null) return provider.supportsPrefill;
  return capabilitiesFor(provider.kind, provider.model ?? undefined).supportsPrefill;
}

/** SPEC §5: heartbeat every 15s so proxies do not close an idle stream. */
const HEARTBEAT_MS = 15_000;

function sseFrame(event: GenerationEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Mounted under /scenes, alongside the scene routes.
 *
 * Kept separate from the /generations router rather than mounting one router at
 * the API root: a router's wildcard middleware applies to everything under its
 * prefix, and at the root that would make this module's auth guard swallow the
 * API's own 404 handler.
 */
export function sceneGenerationRoutes(
  ctx: AppContext,
  service: GenerationService,
  tasks: TaskRunner,
  passes: PassPipeline,
  guides: GuideRunner,
  summaries: SummaryRunner,
  bans: BanAnalyser,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  /**
   * Start generating. Returns as soon as the work is queued; the generation
   * continues whether or not anyone is listening.
   */
  app.post("/:sceneId/generate", async (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }

    let body: {
      parentId?: string | null;
      connectionProfileId?: string | null;
      characterId?: string | null;
      scope?: unknown;
      beatBound?: unknown;
      nudge?: unknown;
    } = {};
    try {
      const parsed: unknown = await c.req.json();
      if (typeof parsed === "object" && parsed !== null) body = parsed;
    } catch {
      // An empty body is the common case: generate from the active leaf using
      // the scene's own profile.
    }

    // Naming a parent is how a reroll asks for a sibling rather than a
    // continuation, and how a branch generates from a rewound point.
    let parentId: number | null | undefined;
    if (body.parentId === null) {
      parentId = null;
    } else if (typeof body.parentId === "string") {
      const parent = findMessage(ctx.db, body.parentId);
      if (parent === null || parent.scene_id !== scene.id) {
        return c.json({ error: { code: "not_found", message: "No such parent message." } }, 404);
      }
      parentId = parent.id;
    }

    let profileId: number | null | undefined;
    if (typeof body.connectionProfileId === "string") {
      const profile = ctx.db
        .query("SELECT id FROM connection_profiles WHERE ulid = $ulid")
        .get({ ulid: body.connectionProfileId }) as { id: number } | null;
      if (profile === null) {
        return c.json(
          { error: { code: "not_found", message: "No such connection profile." } },
          404,
        );
      }
      profileId = profile.id;
    }

    // Naming a character forces who speaks this turn.
    let spotlightId: number | undefined;
    if (typeof body.characterId === "string") {
      const member = ctx.db
        .query(
          `SELECT c.id FROM scene_members m JOIN characters c ON c.id = m.character_id
            WHERE m.scene_id = $scene_id AND c.ulid = $ulid`,
        )
        .get({ scene_id: scene.id, ulid: body.characterId }) as { id: number } | null;
      if (member === null) {
        return c.json(
          { error: { code: "not_found", message: "That character is not in this roleplay." } },
          404,
        );
      }
      spotlightId = member.id;
    }

    // One character or several (SPEC §3.5). An unrecognised scope is a client
    // sending something this server does not have; a spotlight is the safe read.
    const scope = isTurnScope(body.scope) ? body.scope : undefined;
    if (body.beatBound !== undefined && !isBeatBound(body.beatBound)) {
      return c.json(
        { error: { code: "bad_request", message: "That is not a beat bound." } },
        400,
      );
    }
    const beatBound = isBeatBound(body.beatBound) ? body.beatBound : undefined;

    // A one-shot instruction for this generation only (SPEC §7). Never stored
    // as a message: direction is not something the reader said.
    if (body.nudge !== undefined && typeof body.nudge !== "string") {
      return c.json({ error: { code: "bad_request", message: "The nudge must be text." } }, 400);
    }
    const nudge = typeof body.nudge === "string" && body.nudge.trim() !== "" ? body.nudge : undefined;

    try {
      const snapshot = service.start({
        scene,
        ...(parentId === undefined ? {} : { parentId }),
        ...(profileId === undefined ? {} : { connectionProfileId: profileId }),
        ...(spotlightId === undefined ? {} : { spotlightId }),
        ...(scope === undefined ? {} : { scope }),
        ...(beatBound === undefined ? {} : { beatBound }),
        ...(nudge === undefined ? {} : { nudge }),
      });
      return c.json(snapshot, 201);
    } catch (caught) {
      if (caught instanceof GenerationError) {
        const status = caught.code === "already_generating" ? 409 : 400;
        return c.json({ error: { code: caught.code, message: caught.message } }, status);
      }
      throw caught;
    }
  });

  /**
   * Produce a better version of a turn that already exists (SPEC §7).
   *
   * Expand, correct and continue are one endpoint because they are one shape:
   * hand the model what it wrote and ask for something different. The result is
   * always a sibling of the target, so asking for a longer version and
   * disliking it costs a swipe and nothing else.
   */
  app.post("/:sceneId/messages/:messageId/revise", async (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }
    const message = findMessage(ctx.db, c.req.param("messageId"));
    if (message === null || message.scene_id !== scene.id) {
      return c.json({ error: { code: "not_found", message: "No such message." } }, 404);
    }

    let body: { mode?: unknown; instructions?: unknown } = {};
    try {
      const parsed: unknown = await c.req.json();
      if (typeof parsed === "object" && parsed !== null) body = parsed;
    } catch {
      /* Falls through to the validation below. */
    }
    if (!isReviseMode(body.mode)) {
      return c.json(
        { error: { code: "bad_request", message: "Expand, correct or continue?" } },
        400,
      );
    }
    if (body.instructions !== undefined && typeof body.instructions !== "string") {
      return c.json(
        { error: { code: "bad_request", message: "The instructions must be text." } },
        400,
      );
    }
    // Continue needs the provider to accept a partial assistant turn. Where it
    // cannot, saying so beats producing a fresh turn that pretends to be a
    // continuation (SPEC §7).
    if (body.mode === "continue" && !canContinue(ctx, scene)) {
      return c.json(
        {
          error: {
            code: "unsupported",
            message: "This provider cannot continue a message it has already finished.",
          },
        },
        422,
      );
    }

    const instructions =
      typeof body.instructions === "string" && body.instructions.trim() !== ""
        ? body.instructions.trim()
        : undefined;

    try {
      return c.json(
        service.start({
          scene,
          revise: {
            message,
            mode: body.mode,
            ...(instructions === undefined ? {} : { instructions }),
          },
        }),
        201,
      );
    } catch (caught) {
      if (caught instanceof GenerationError) {
        const status =
          caught.code === "already_generating" ? 409 : caught.code === "not_revisable" ? 422 : 400;
        return c.json({ error: { code: caught.code, message: caught.message } }, status);
      }
      throw caught;
    }
  });

  /**
   * Impersonate (SPEC §7): expand an outline into a turn in the reader's voice.
   *
   * The result lands in the composer and never auto-sends, which is what makes
   * this op safe — it is the one place the author is asked to write the
   * reader's character, and nothing it produces reaches the story without the
   * user pressing send.
   */
  app.post("/:sceneId/impersonate", async (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }

    let body: { outline?: unknown; person?: unknown } = {};
    try {
      const parsed: unknown = await c.req.json();
      if (typeof parsed === "object" && parsed !== null) body = parsed;
    } catch {
      /* An empty body is "write something for me", which is a real ask. */
    }
    const outline = typeof body.outline === "string" ? body.outline : "";
    const person = isImpersonatePerson(body.person) ? body.person : "first";

    const speakers = speakerLookup(ctx.db);
    const persona =
      scene.persona_id === null
        ? { name: null, description: null }
        : ((ctx.db
            .query("SELECT name, description FROM personas WHERE id = $id")
            .get({ id: scene.persona_id }) as { name: string; description: string | null } | null) ??
          { name: null, description: null });
    const author =
      scene.author_id === null
        ? null
        : ((ctx.db.query("SELECT name FROM authors WHERE id = $id").get({ id: scene.author_id }) as
            | { name: string }
            | null)?.name ?? null);

    const outcome = await tasks.run({
      kind: taskKind(IMPERSONATE)!,
      sceneId: scene.id,
      fallbackProfileId: scene.connection_profile_id,
      prompt: buildImpersonatePrompt(
        {
          persona,
          outline,
          person,
          author,
          history: activePath(ctx.db, scene.id)
            .filter((row) => row.is_hidden === 0)
            .slice(-8)
            .map((row) => ({
              speaker:
                row.character_id === null
                  ? row.author_type === "user"
                    ? (persona.name ?? "The reader")
                    : "Narration"
                  : (speakers.nameById.get(row.character_id) ?? "Someone"),
              content: row.content,
            })),
        },
        createEstimatingTokenizer(),
      ),
    });

    const response: ImpersonateResponse = outcome.ok
      ? { text: cleanImpersonation(outcome.text), detail: null }
      : { text: null, detail: outcome.detail };
    return c.json(response, outcome.ok ? 200 : 502);
  });

  /* -------------------------------------------------------------- */
  /* Persistent guides (SPEC §8)                                     */
  /* -------------------------------------------------------------- */

  /**
   * Write or rewrite one guide, or every guide that is switched on.
   *
   * Awaited: the user pressed rebuild and is looking at the panel, so the
   * answer comes back with the response rather than making them poll.
   */
  app.post("/:sceneId/guides/rebuild", async (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }

    let kind: unknown;
    try {
      const parsed: unknown = await c.req.json();
      if (typeof parsed === "object" && parsed !== null) kind = (parsed as { kind?: unknown }).kind;
    } catch {
      /* No body means every guide that is on. */
    }
    if (kind !== undefined && !isGuideKind(kind)) {
      return c.json({ error: { code: "bad_request", message: "No such guide." } }, 400);
    }

    await guides.refresh(scene, {
      automatic: false,
      ...(kind === undefined ? {} : { kinds: [kind] }),
    });
    return c.json(activeGuides(ctx.db, scene.id).map(toGuideDto));
  });

  /** Hand-edit a guide, which pins it against the next refresh (SPEC §8). */
  app.patch("/:sceneId/guides/:guideId", async (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }
    const guide = findGuide(ctx.db, c.req.param("guideId"));
    if (guide === null || guide.scene_id !== scene.id) {
      return c.json({ error: { code: "not_found", message: "No such guide." } }, 404);
    }

    let content: unknown;
    try {
      const parsed: unknown = await c.req.json();
      if (typeof parsed === "object" && parsed !== null) {
        content = (parsed as { content?: unknown }).content;
      }
    } catch {
      /* Falls through to the check below. */
    }
    if (typeof content !== "string" || content.trim() === "") {
      return c.json(
        { error: { code: "bad_request", message: "A guide with nothing in it is a flush." } },
        400,
      );
    }

    return c.json(toGuideDto(editGuide(ctx.db, guide.id, content.trim())));
  });

  /**
   * Flush one guide, or all of them (SPEC §8).
   *
   * Every version goes, not just the one in force: a flush means "stop
   * injecting this", and leaving older versions behind would resurrect one the
   * moment the reader rewound.
   */
  app.delete("/:sceneId/guides/:kind", (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }
    const raw = c.req.param("kind");
    if (raw !== "all" && !isGuideKind(raw)) {
      return c.json({ error: { code: "not_found", message: "No such guide." } }, 404);
    }
    flushGuides(ctx.db, scene.id, raw === "all" ? null : raw);
    return c.json(activeGuides(ctx.db, scene.id).map(toGuideDto));
  });

  /**
   * Ask the author something out of character, and have it answer (SPEC §12).
   *
   * Two messages, not one. The question is appended to the tree first, because
   * unlike a nudge an OOC question *is* something the reader said — the answer
   * would make no sense beside a transcript that did not contain it, and a
   * reader scrolling back should find both halves of the exchange.
   *
   * Both are `ooc` messages; what separates them is `author_type`, which is who
   * spoke. That is the distinction §2 draws between the partner and the roles
   * it plays, and the one the blue pencil marks in the design.
   */
  app.post("/:sceneId/ooc", async (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }

    let question = "";
    try {
      const parsed: unknown = await c.req.json();
      if (typeof parsed === "object" && parsed !== null) {
        const value = (parsed as { question?: unknown }).question;
        if (typeof value === "string") question = value.trim();
      }
    } catch {
      /* Handled by the emptiness check below. */
    }
    if (question === "") {
      return c.json({ error: { code: "bad_request", message: "Say something first." } }, 400);
    }

    const asked = appendMessage(ctx.db, {
      sceneId: scene.id,
      parentId: scene.active_leaf_id,
      kind: "ooc",
      authorType: "user",
      content: question,
      characterId: null,
    });

    try {
      // Generating from the question rather than from the leaf as it was: the
      // answer is a reply to it, and the author has to be able to see it.
      const snapshot = service.start({
        scene: findScene(ctx.db, c.req.param("sceneId"))!,
        parentId: asked.id,
        ooc: { question },
      });
      return c.json({ question: messageDto(ctx.db, asked, scene.ulid), generation: snapshot }, 201);
    } catch (caught) {
      if (caught instanceof GenerationError) {
        // The question stays: the reader said it, and deleting it because the
        // scene was busy would lose what they typed.
        const status = caught.code === "already_generating" ? 409 : 400;
        return c.json({ error: { code: caught.code, message: caught.message } }, status);
      }
      throw caught;
    }
  });

  /**
   * What lore would fire for this scene right now, and what would not (§10).
   *
   * §16 asks the lorebook editor for "an activation test tool that shows what
   * would fire against the current scene". This is that, and it runs the same
   * engine a generation runs — a test tool with its own second implementation
   * would be a tool that lies.
   */
  app.get("/:sceneId/lore", (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }
    const present = ctx.db
      .query(
        `SELECT c.ulid AS ulid FROM scene_members m
           JOIN characters c ON c.id = m.character_id
          WHERE m.scene_id = $scene AND m.is_active = 1`,
      )
      .all({ scene: scene.id }) as { ulid: string }[];

    const result = activateForScene({
      db: ctx.db,
      scene,
      presentCharacterIds: present.map((row) => row.ulid),
      // Fixed rather than per-generation: the tool answers "what does this
      // scene do", and a number that changed on every refresh would make a
      // probability entry impossible to reason about.
      seed: 1,
    });
    return c.json(result.trace);
  });

  /* -------------------------------------------------------------- */
  /* Prompt options and the ban list (SPEC §13.5, §13.6)             */
  /* -------------------------------------------------------------- */

  function optionsState(scene: { id: number }) {
    const chosen = new Set(selectedOptions(ctx.db, scene.id).map((row) => row.id));
    const groups = listGroups(ctx.db).map((group) =>
      toGroupDto(group, listOptions(ctx.db, group.id), chosen),
    );
    return {
      groups,
      // False while the scene is still running on the shipped configuration,
      // which is a different state from "everything happens to be off" (§22).
      configured: sceneHasChosen(ctx.db, scene.id),
      tokenCount: groups
        .flatMap((group) => group.options)
        .filter((option) => option.selected)
        .reduce((sum, option) => sum + option.tokenCount, 0),
    };
  }

  app.get("/:sceneId/options", (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }
    return c.json(optionsState(scene));
  });

  /** Switch one option on or off. Cardinality is enforced in the query (§13.5). */
  app.put("/:sceneId/options/:optionId", async (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }
    const option = findOptionByUlid(ctx.db, c.req.param("optionId"));
    if (option === null) {
      return c.json({ error: { code: "not_found", message: "No such option." } }, 404);
    }

    let on = true;
    try {
      const parsed: unknown = await c.req.json();
      if (typeof parsed === "object" && parsed !== null) {
        const value = (parsed as { on?: unknown }).on;
        if (typeof value === "boolean") on = value;
      }
    } catch {
      /* No body means on, which is what pressing an option means. */
    }

    setSceneOption(ctx.db, scene.id, option, on);
    return c.json(optionsState(scene));
  });

  /** Back to the shipped configuration, which is not the same as all off. */
  app.delete("/:sceneId/options", (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }
    resetSceneOptions(ctx.db, scene.id);
    return c.json(optionsState(scene));
  });

  function banState(scene: { id: number }) {
    const tokenizer = createEstimatingTokenizer();
    return {
      phrases: listBans(ctx.db, scene.id).map(toBanDto),
      // What the block actually costs, which is the enforced list rather than
      // everything on screen: proposals are not injected.
      tokenCount: activeBans(ctx.db, scene.id).reduce(
        (sum, row) => sum + tokenizer.count(row.phrase),
        0,
      ),
    };
  }

  app.get("/:sceneId/bans", (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }
    return c.json(banState(scene));
  });

  app.post("/:sceneId/bans", async (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }

    let phrase: unknown;
    let scoped = false;
    try {
      const parsed: unknown = await c.req.json();
      if (typeof parsed === "object" && parsed !== null) {
        phrase = (parsed as { phrase?: unknown }).phrase;
        scoped = (parsed as { scoped?: unknown }).scoped === true;
      }
    } catch {
      /* Falls through to the check below. */
    }
    if (typeof phrase !== "string" || phrase.trim() === "") {
      return c.json({ error: { code: "bad_request", message: "A phrase to ban?" } }, 400);
    }

    addBan(ctx.db, { sceneId: scoped ? scene.id : null, phrase: phrase.trim() });
    return c.json(banState(scene));
  });

  /**
   * Ask what this scene keeps reaching for (§13.6).
   *
   * Awaited, like every other thing a user pressed a button for. What comes
   * back is a proposal: nothing is enforced until it is accepted.
   */
  app.post("/:sceneId/bans/analyse", async (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }
    const result = await bans.run(scene);
    return c.json({ ...banState(scene), detail: result.detail });
  });

  app.patch("/:sceneId/bans/:banId", async (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }
    const ban = findBan(ctx.db, c.req.param("banId"));
    if (ban === null) {
      return c.json({ error: { code: "not_found", message: "No such phrase." } }, 404);
    }

    let body: { accept?: unknown; enabled?: unknown } = {};
    try {
      const parsed: unknown = await c.req.json();
      if (typeof parsed === "object" && parsed !== null) body = parsed;
    } catch {
      /* An empty body changes nothing, which the response will show. */
    }
    if (body.accept === true) acceptBan(ctx.db, ban.id);
    if (typeof body.enabled === "boolean") setBanEnabled(ctx.db, ban.id, body.enabled);
    return c.json(banState(scene));
  });

  app.delete("/:sceneId/bans/:banId", (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }
    const ban = findBan(ctx.db, c.req.param("banId"));
    if (ban === null) {
      return c.json({ error: { code: "not_found", message: "No such phrase." } }, 404);
    }
    deleteBan(ctx.db, ban.id);
    return c.json(banState(scene));
  });

  /* -------------------------------------------------------------- */
  /* Rolling summarisation (SPEC §11)                                */
  /* -------------------------------------------------------------- */

  /** What the scene remembers, what it is carrying, and what is waiting. */
  function summaryState(scene: ReturnType<typeof findScene> & object) {
    const rows = activeSummaries(ctx.db, scene.id);
    const injected = injectedSummaries(ctx.db, scene);
    const injectedIds = new Set(injected.summaries.map((row) => row.id));
    const pending = pendingForSummary(ctx.db, scene);
    return {
      summaries: rows.map((row) => toSummaryDto(ctx.db, row)),
      injectedIds: rows.filter((row) => injectedIds.has(row.id)).map((row) => row.ulid),
      pendingMessages: pending.length,
      pendingWords: pending.reduce((sum, row) => sum + countWords(row.content), 0),
      coveredMessages: injected.coveredMessageIds.size,
    };
  }

  app.get("/:sceneId/summaries", (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }
    return c.json(summaryState(scene));
  });

  /**
   * Summarise now, without waiting for a threshold.
   *
   * Awaited, like the guides' rebuild and for the same reason: the user pressed
   * a button and is looking at the panel.
   */
  app.post("/:sceneId/summaries", async (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }
    await summaries.run(scene, { automatic: false });
    const after = findScene(ctx.db, c.req.param("sceneId"));
    return c.json(summaryState(after ?? scene));
  });

  /** Write one again over the same range (§11). An edit is overwritten: they asked. */
  app.post("/:sceneId/summaries/:summaryId/rewrite", async (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }
    const summary = findSummary(ctx.db, c.req.param("summaryId"));
    if (summary === null || summary.scene_id !== scene.id) {
      return c.json({ error: { code: "not_found", message: "No such summary." } }, 404);
    }
    await summaries.rewrite(scene, summary);
    return c.json(summaryState(scene));
  });

  /** Hand-edit a summary, which marks it against regeneration (§11). */
  app.patch("/:sceneId/summaries/:summaryId", async (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }
    const summary = findSummary(ctx.db, c.req.param("summaryId"));
    if (summary === null || summary.scene_id !== scene.id) {
      return c.json({ error: { code: "not_found", message: "No such summary." } }, 404);
    }

    let content: unknown;
    try {
      const parsed: unknown = await c.req.json();
      if (typeof parsed === "object" && parsed !== null) {
        content = (parsed as { content?: unknown }).content;
      }
    } catch {
      /* Falls through to the check below. */
    }
    if (typeof content !== "string" || content.trim() === "") {
      return c.json(
        { error: { code: "bad_request", message: "A summary with nothing in it is a delete." } },
        400,
      );
    }

    editSummary(ctx.db, summary.id, content.trim());
    return c.json(summaryState(scene));
  });

  /**
   * Forget one summary, or all of them.
   *
   * The messages it covered become pending again, so the next trigger writes a
   * new one — which is what makes this "do that again" rather than "lose that
   * stretch of the story".
   */
  app.delete("/:sceneId/summaries/:summaryId", (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }
    const raw = c.req.param("summaryId");
    if (raw === "all") {
      deleteSummaries(ctx.db, scene.id);
      return c.json(summaryState(scene));
    }
    const summary = findSummary(ctx.db, raw);
    if (summary === null || summary.scene_id !== scene.id) {
      return c.json({ error: { code: "not_found", message: "No such summary." } }, 404);
    }
    deleteSummary(ctx.db, summary.id);
    return c.json(summaryState(scene));
  });

  /**
   * Read a finished turn by hand (SPEC §7.5: auto-run per scene, or manual per
   * message).
   *
   * Awaited, unlike the automatic run — the user asked and is waiting, so the
   * response carries the findings rather than making them poll for something
   * they just pressed a button for.
   */
  app.post("/:sceneId/messages/:messageId/passes", async (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }
    const message = findMessage(ctx.db, c.req.param("messageId"));
    if (message === null || message.scene_id !== scene.id) {
      return c.json({ error: { code: "not_found", message: "No such message." } }, 404);
    }
    if (message.author_type === "user") {
      return c.json(
        {
          error: {
            code: "bad_request",
            message: "These passes read what the author wrote, not what you wrote.",
          },
        },
        400,
      );
    }

    await passes.run({ scene, message, automatic: false });
    return c.json(messageDto(ctx.db, findMessage(ctx.db, message.ulid)!, scene.ulid));
  });

  /**
   * Put back what a pass changed (SPEC §7.5: the original is always retained so
   * the user can see and revert).
   */
  app.post("/:sceneId/annotations/:annotationId/revert", (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }
    const annotation = findAnnotation(ctx.db, c.req.param("annotationId"));
    if (annotation === null) {
      return c.json({ error: { code: "not_found", message: "No such note." } }, 404);
    }
    const message = ctx.db
      .query("SELECT * FROM messages WHERE id = $id")
      .get({ id: annotation.message_id }) as { ulid: string; scene_id: number } | null;
    if (message === null || message.scene_id !== scene.id) {
      return c.json({ error: { code: "not_found", message: "No such note." } }, 404);
    }
    if (annotation.original_content === null) {
      return c.json(
        { error: { code: "bad_request", message: "That note did not change anything." } },
        400,
      );
    }

    revertAnnotation(ctx.db, annotation, findMessage(ctx.db, message.ulid)!);
    return c.json(messageDto(ctx.db, findMessage(ctx.db, message.ulid)!, scene.ulid));
  });

  /**
   * Recast one character's part of a beat (SPEC §7).
   *
   * The rest of the beat is held fixed and passed as context, and the result is
   * spliced into that segment's offsets. This is the per-character correction
   * affordance: swiping rerolls the whole exchange, which is a different and
   * much blunter thing to want.
   */
  app.post("/:sceneId/messages/:messageId/recast", async (c) => {
    const scene = findScene(ctx.db, c.req.param("sceneId"));
    if (scene === null) {
      return c.json({ error: { code: "not_found", message: "No such scene." } }, 404);
    }
    const message = findMessage(ctx.db, c.req.param("messageId"));
    if (message === null || message.scene_id !== scene.id) {
      return c.json({ error: { code: "not_found", message: "No such message." } }, 404);
    }
    if (message.kind !== "beat") {
      return c.json(
        {
          error: {
            code: "bad_request",
            message: "Only a beat has parts to recast. Reroll the message instead.",
          },
        },
        400,
      );
    }

    let ordinal: unknown;
    try {
      const parsed: unknown = await c.req.json();
      if (typeof parsed === "object" && parsed !== null) {
        ordinal = (parsed as { ordinal?: unknown }).ordinal;
      }
    } catch {
      // Falls through to the validation below.
    }
    if (typeof ordinal !== "number" || !Number.isInteger(ordinal) || ordinal < 0) {
      return c.json(
        { error: { code: "bad_request", message: "Which part of the beat?" } },
        400,
      );
    }

    try {
      return c.json(service.start({ scene, recast: { message, ordinal } }), 201);
    } catch (caught) {
      if (caught instanceof GenerationError) {
        const status =
          caught.code === "already_generating" ? 409 : caught.code === "not_recastable" ? 422 : 400;
        return c.json({ error: { code: caught.code, message: caught.message } }, status);
      }
      throw caught;
    }
  });

  return app;
}

/** Mounted under /generations. */
export function generationRoutes(service: GenerationService): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  /** A snapshot, for a client that would rather poll than hold a stream open. */
  app.get("/:generationId", (c) => {
    const snapshot = service.get(c.req.param("generationId"));
    return snapshot === null
      ? c.json({ error: { code: "not_found", message: "No such generation." } }, 404)
      : c.json(snapshot);
  });

  /**
   * The stream. `?offset=N` replays everything past N and then continues live,
   * so a client that missed part of the output loses nothing (SPEC §5.3–5.4).
   */
  app.get("/:generationId/stream", (c) => {
    const id = c.req.param("generationId");
    const requested = Number(c.req.query("offset") ?? "0");
    const offset = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 0;

    if (service.get(id) === null) {
      return c.json({ error: { code: "not_found", message: "No such generation." } }, 404);
    }

    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const send = (text: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            // The client went away between the check and the write.
            closed = true;
          }
        };

        const finish = () => {
          if (closed) return;
          closed = true;
          if (heartbeat !== null) clearInterval(heartbeat);
          unsubscribe?.();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };

        unsubscribe = service.subscribe(id, offset, (event) => {
          send(sseFrame(event));
          // Only the three terminal events end the stream. A `director` event
          // is news about the turn, not the end of it — closing on anything
          // that merely is not a chunk would cut the stream off before a word
          // of prose arrived.
          if (event.type === "done" || event.type === "cancelled" || event.type === "error") {
            finish();
          }
        });

        if (unsubscribe === null) {
          finish();
          return;
        }

        // A comment line is a no-op to the client and enough to keep a proxy
        // from closing an idle connection.
        heartbeat = setInterval(() => send(": heartbeat\n\n"), HEARTBEAT_MS);
      },

      cancel() {
        // The client disconnected. The generation keeps running (SPEC §5.4) —
        // this only stops us writing to a socket that is gone.
        if (heartbeat !== null) clearInterval(heartbeat);
        unsubscribe?.();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // Tells nginx not to buffer, which would defeat streaming entirely.
        "X-Accel-Buffering": "no",
      },
    });
  });

  /** Abort, keeping whatever was produced (SPEC §5.6). */
  app.post("/:generationId/cancel", (c) => {
    const snapshot = service.cancel(c.req.param("generationId"));
    return snapshot === null
      ? c.json({ error: { code: "not_found", message: "No such generation." } }, 404)
      : c.json(snapshot);
  });

  return app;
}
