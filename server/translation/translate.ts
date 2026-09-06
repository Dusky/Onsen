import type { Database } from "bun:sqlite";
import { createEstimatingTokenizer, defaultTemplateOf, fillTemplate } from "../prompt/index.ts";
import type { BuiltPrompt } from "../prompt/index.ts";
import { TRANSLATE, taskKind } from "../tasks/registry.ts";
import type { TaskRunner } from "../tasks/runner.ts";
import { taskConfig, templateOf } from "../db/queries/tasks.ts";
import type { MessageRow } from "../db/queries/history.ts";
import { upsertTranslation } from "../db/queries/translations.ts";

/**
 * Display-only translation (SPEC §20 phase 78).
 *
 * The stored text and the prompt keep the language the author writes in; this
 * renders a turn in the scene's translation language and stores the result
 * *beside* the message, never in it. It runs the ordinary side-call path, so
 * the op is routable to a cheap model like any other (§7).
 */

/** The prompt the translate op sends: a bare instruction plus the text. */
export function buildTranslatePrompt(question: string): BuiltPrompt {
  const tokenizer = createEstimatingTokenizer();
  const system = "You are a translator. Translate exactly what you are given, nothing more.";
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
          label: "Translate",
          source: "guided op",
          role: "system",
          content: system,
          placement: { kind: "prefix" },
          tokens: tokenizer.count(system),
        },
        {
          id: "text",
          label: "Text",
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
      loreTrace: [],
      retrievedChunks: [],
      memoryTrace: [],
    },
  };
}

/**
 * Translate one message into a language, storing the result beside it.
 *
 * Returns the translation, or null when the op is off, the call failed, or the
 * reply came back empty. Never throws: a translation is a viewing convenience,
 * and a failed one must not surface as a generation failure (§7).
 */
export async function translateMessage(
  db: Database,
  tasks: TaskRunner,
  message: MessageRow,
  language: string,
  fallbackProfileId: number | null,
): Promise<string | null> {
  const op = taskKind(TRANSLATE);
  if (op === null) return null;
  const row = taskConfig(db, op);
  if (row.enabled !== 1) return null;

  const question = fillTemplate(templateOf(row, op) || defaultTemplateOf(TRANSLATE), {
    text: message.content,
    language,
  }).trim();
  if (question === "") return null;

  const outcome = await tasks.run({
    kind: op,
    sceneId: message.scene_id,
    fallbackProfileId,
    prompt: buildTranslatePrompt(question),
  });
  if (!outcome.ok) return null;
  const translation = outcome.text.trim();
  if (translation === "") return null;

  upsertTranslation(db, message.id, language, translation);
  return translation;
}
