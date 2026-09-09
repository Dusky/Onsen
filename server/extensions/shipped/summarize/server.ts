import type { Database } from "bun:sqlite";
import type { ExtensionApi } from "../../api.ts";

/**
 * Summarize (SillyTavern's rolling-summary extension, ported — §20 phase 146).
 *
 * One running summary, rebuilt when the story has grown past a message or word
 * interval, and injected through a template at a chosen position. The host owns
 * the state (via `ctx.state`), the prompt (`{{state:summary}}`), and the
 * placement; this module owns only the policy of when to run and what to write.
 *
 * Written against the extension code API and shipped as an *external* install,
 * not a built-in: it has a real directory and can be removed like anything the
 * operator cloned.
 */

const DEFAULT_PROMPT =
  "Ignore previous instructions. Summarize the most important facts and events in the story so far. " +
  "If a summary already exists, use that as a base and expand with new facts. " +
  "Limit the summary to {{words}} words or less. Your response should include nothing but the summary.";

const DEFAULT_TEMPLATE = "[Summary: {{summary}}]";

function str(settings: Record<string, unknown>, key: string, fallback: string): string {
  const value = settings[key];
  return typeof value === "string" && value !== "" ? value : fallback;
}

function num(settings: Record<string, unknown>, key: string, fallback: number): number {
  const value = settings[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function bool(settings: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = settings[key];
  return typeof value === "boolean" ? value : fallback;
}

export function register(ctx: ExtensionApi, settings: Record<string, unknown> = {}): void {
  const prompt = str(settings, "prompt", DEFAULT_PROMPT);
  const words = num(settings, "words", 200);
  const intervalMessages = num(settings, "intervalMessages", 10);
  const intervalWords = num(settings, "intervalWords", 0);
  const template = str(settings, "template", DEFAULT_TEMPLATE);
  const position = str(settings, "position", "in_chat");
  const depth = num(settings, "depth", 2);
  const frozen = bool(settings, "frozen", false);
  const includePrevious = bool(settings, "includePrevious", true);

  // The summary is injected even while paused; pause stops *updating*, not the
  // summary that already exists (SillyTavern's `memoryFrozen`).
  ctx.inject({
    key: "summary",
    label: "Summary",
    position: position === "before" || position === "after" ? position : "in_chat",
    depth,
    render({ db, sceneId }) {
      const summary = ctx.state.read(db, sceneId, "summary");
      if (summary === null || summary.trim() === "") return null;
      return template.replace(/\{\{summary\}\}/g, summary);
    },
  });

  const applySummary = (reply: string, { db, sceneId, messageCount }: { db: Database; sceneId: number; messageCount: number }) => {
    const summary = reply.trim();
    if (summary === "") return;
    ctx.state.write(db, sceneId, "summary", summary);
    ctx.state.write(db, sceneId, "anchorCount", String(messageCount));
    const last = db
      .query("SELECT id FROM messages WHERE scene_id = $scene ORDER BY id DESC LIMIT 1")
      .get({ scene: sceneId }) as { id: number } | undefined;
    if (last !== undefined) ctx.state.write(db, sceneId, "anchorId", String(last.id));
  };

  ctx.task({
    key: "summarize",
    label: "Summarize",
    prompt: taskPrompt(prompt, words, includePrevious),
    stage: "post_generation",
    samplers: { temperature: 0.3, top_p: 0.9 },
    replyLimit: Math.max(200, words * 4),
    shouldRun({ db, sceneId, messageCount }) {
      if (frozen) return false;
      const anchorCount = Number(ctx.state.read(db, sceneId, "anchorCount") ?? "0");
      const sinceMessages = messageCount - anchorCount;
      if (intervalMessages > 0 && sinceMessages >= intervalMessages) return true;
      if (intervalWords > 0) {
        const anchorId = Number(ctx.state.read(db, sceneId, "anchorId") ?? "0");
        if (wordsSince(db, sceneId, anchorId) >= intervalWords) return true;
      }
      return false;
    },
    apply: applySummary,
  });

  // The manual counterpart to the interval: a button near the input (§148),
  // which works even while updates are paused — asking is not scheduling.
  ctx.action({
    key: "summarize-now",
    label: "Summarize now",
    description: "Write the running summary from the story so far.",
    prompt: taskPrompt(prompt, words, includePrevious),
    samplers: { temperature: 0.3, top_p: 0.9 },
    replyLimit: Math.max(200, words * 4),
    apply: applySummary,
  });
}

function taskPrompt(prompt: string, words: number, includePrevious: boolean): string {
  const withWords = prompt.replace(/\{\{words\}\}/g, String(words));
  const parts = [withWords];
  if (includePrevious) parts.push("Previous summary:\n{{state:summary}}");
  parts.push("Story so far:\n{{transcript}}");
  return parts.join("\n\n");
}

/** Words in every message after the anchor id. A branch is ignored; a rolling
 *  summary is a heuristic, not a ledger, and the message count is the primary
 *  trigger. */
function wordsSince(db: Database, sceneId: number, anchorId: number): number {
  const rows = db
    .query("SELECT content FROM messages WHERE scene_id = $scene AND id > $anchor")
    .all({ scene: sceneId, anchor: anchorId }) as Array<{ content: string }>;
  let words = 0;
  for (const row of rows) {
    const matches = row.content.match(/[^\s]+/g);
    if (matches !== null) words += matches.length;
  }
  return words;
}
