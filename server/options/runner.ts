import type { Database } from "bun:sqlite";
import { createEstimatingTokenizer, defaultTemplateOf } from "../prompt/index.ts";
import type { BuiltPrompt } from "../prompt/index.ts";
import { activePath, type SceneRow } from "../db/queries/history.ts";
import { addBan, listBans } from "../db/queries/options.ts";
import { taskConfig, templateOf } from "../db/queries/tasks.ts";
import { ANALYSE_SLOP, taskKind } from "../tasks/registry.ts";
import type { TaskRunner } from "../tasks/runner.ts";
import { analyseQuestion, parseAnalysis, repeatedPhrases, type PhraseCount } from "./analyse.ts";

/**
 * Proposing bans (SPEC §13.6's auto-analyse).
 *
 * Two halves, deliberately split at the seam where judgement begins. Counting
 * recurrence is code: exact, free, repeatable, and something a model is
 * genuinely bad at. Deciding whether a recurring phrase is a tic or is the
 * story — a name, a place, a thing somebody says on purpose — is the part that
 * needs a reader, and it is all the model is asked.
 *
 * Nothing it proposes is enforced. A background task that started banning
 * phrases on its own authority would be editing somebody's prose without being
 * asked, which is the opposite of what a ban list is for.
 */

/** How much of the scene the counter reads. Enough for a habit to show. */
const RECENT_TURNS = 20;
/** More than this and the question stops being a question. */
const MAX_CANDIDATES = 25;

export function buildAnalysePrompt(
  question: string,
  tokenizer = createEstimatingTokenizer(),
): BuiltPrompt {
  const system =
    `You read prose and tell filler apart from substance. You reply with a plain list and ` +
    `nothing else — no preamble, no explanation, no numbering.`;
  const tokens = tokenizer.count(system) + tokenizer.count(question);
  return {
    system,
    messages: [{ role: "user", content: question }],
    outlets: {},
    debug: {
      mode: "author",
      tokensAreEstimated: tokenizer.isEstimate,
      tokenizerId: tokenizer.id,
      budget: tokens,
      reservedForResponse: 0,
      available: tokens,
      fixedTokens: tokenizer.count(system),
      historyTokens: tokenizer.count(question),
      totalTokens: tokens,
      headroom: 0,
      blocks: [
        {
          id: "system_prompt",
          label: "Ban analysis",
          // The marker every side call carries, so the task log and the test
          // harness can tell one from a turn.
          source: "guided op",
          role: "system",
          content: system,
          placement: { kind: "prefix" },
          tokens: tokenizer.count(system),
        },
        {
          id: "ban_list",
          label: "Candidates",
          source: "guided op",
          role: "user",
          content: question,
          placement: { kind: "depth", depth: 0 },
          tokens: tokenizer.count(question),
        },
      ],
      evicted: [],
      historyIncluded: [],
      unresolvedOutlets: [],
      unknownMacros: [],
    },
  };
}

export interface AnalyseResult {
  /** What the counter found, before the model saw it. */
  candidates: PhraseCount[];
  /** What was written to the list as a proposal. */
  proposed: PhraseCount[];
  /** Why nothing happened, when nothing did. */
  detail: string | null;
}

export class BanAnalyser {
  private readonly db: Database;
  private readonly tasks: TaskRunner;
  private stopped = false;

  constructor(options: { db: Database; tasks: TaskRunner }) {
    this.db = options.db;
    this.tasks = options.tasks;
  }

  shutdown(): void {
    this.stopped = true;
  }

  /** The phrases this scene keeps reaching for, that are not already known. */
  candidatesFor(scene: SceneRow): PhraseCount[] {
    const known = new Set(
      listBans(this.db, scene.id).map((row) => row.phrase.trim().toLowerCase()),
    );
    const texts = activePath(this.db, scene.id)
      .filter((row) => row.is_hidden === 0 && row.author_type !== "user")
      .slice(-RECENT_TURNS)
      .map((row) => row.content);

    return repeatedPhrases(texts)
      // A phrase already on the list, accepted or proposed, is not news.
      .filter((item) => !known.has(item.phrase))
      .slice(0, MAX_CANDIDATES);
  }

  async run(scene: SceneRow): Promise<AnalyseResult> {
    const op = taskKind(ANALYSE_SLOP);
    if (op === null) return { candidates: [], proposed: [], detail: "No such op." };

    const candidates = this.candidatesFor(scene);
    if (candidates.length === 0) {
      return {
        candidates: [],
        proposed: [],
        detail: "Nothing repeats often enough to be worth banning yet.",
      };
    }

    const row = taskConfig(this.db, op);
    const outcome = await this.tasks.run({
      kind: op,
      sceneId: scene.id,
      prompt: buildAnalysePrompt(analyseQuestion(templateOf(row, op), candidates)),
      profileId: row.connection_profile_id,
      fallbackProfileId: scene.connection_profile_id,
    });
    if (!outcome.ok || this.stopped) {
      return { candidates, proposed: [], detail: outcome.ok ? null : outcome.detail };
    }

    const chosen = parseAnalysis(outcome.text, candidates);
    for (const item of chosen) {
      // Scoped to the scene: a habit one story fell into is not evidence about
      // every story, and the global list is where a phrase goes once somebody
      // has decided it is always wrong.
      addBan(this.db, {
        sceneId: scene.id,
        phrase: item.phrase,
        origin: "proposed",
        hits: item.hits,
      });
    }
    return {
      candidates,
      proposed: chosen,
      detail:
        chosen.length === 0
          ? "Everything that repeats looks like the story rather than filler."
          : null,
    };
  }
}

export { defaultTemplateOf };
