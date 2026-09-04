import type { Database } from "bun:sqlite";
import { createEstimatingTokenizer, type Tokenizer } from "../prompt/index.ts";
import { createRng } from "../prompt/random.ts";
import { activePath, type MessageRowWithSiblings, type SceneRow } from "../db/queries/history.ts";
import { booksForScene, candidatesFor, timedStateFor } from "../db/queries/lore.ts";
import { activateLore, type ActivationResult } from "./activate.ts";

/**
 * Running the activation model against a real scene (SPEC §10).
 *
 * The engine is pure; this is the part that reads rows and counts messages.
 * Shared between the prompt context and the activation test tool §16 asks for,
 * so that what the tool reports is what a generation would actually inject —
 * a test tool that runs a second implementation is a tool that lies.
 */

/**
 * How far back this branch goes, for §10's `delay_from = branch_point`.
 *
 * The branch point is the newest message on the path that has a sibling: the
 * turn where this path stopped being the only one. With no siblings anywhere,
 * the scene is one branch and the two origins agree.
 */
export function messagesSinceBranch(history: { sibling_count?: number }[]): number {
  for (let at = history.length - 1; at >= 0; at -= 1) {
    if ((history[at]?.sibling_count ?? 1) > 1) return history.length - at;
  }
  return history.length;
}

export interface SceneActivationOptions {
  db: Database;
  scene: SceneRow;
  history?: MessageRowWithSiblings[];
  /** ULIDs of the characters in play, for §10's character filter. */
  presentCharacterIds: string[];
  /**
   * Seeded from the generation, so the same turn always activates the same
   * lore. A reroll that quietly matched different entries would be untraceable.
   */
  seed: number;
  tokenizer?: Tokenizer;
}

export function activateForScene(options: SceneActivationOptions): ActivationResult {
  const history = options.history ?? activePath(options.db, options.scene.id);
  const tokenizer = options.tokenizer ?? createEstimatingTokenizer();
  const books = booksForScene(
    options.db,
    options.scene.id,
    options.scene.persona_id,
    // §11's author memory reaches a scene by ownership rather than by a
    // binding, so the scene's author has to be part of the question.
    options.scene.author_id,
  );

  return activateLore({
    entries: candidatesFor(options.db, books),
    // Newest last. Hidden messages are excluded for the reason they are
    // excluded from the prompt: the model never saw them.
    transcript: history.filter((row) => row.is_hidden === 0).map((row) => row.content),
    presentCharacterIds: options.presentCharacterIds,
    timed: timedStateFor(options.db, options.scene.id, history),
    messageCount: history.length,
    messagesSinceBranch: messagesSinceBranch(history),
    random: createRng(options.seed),
    recursionCap: Math.max(...books.map((book) => book.recursion_depth), 0),
    countTokens: (text) => tokenizer.count(text),
  });
}
