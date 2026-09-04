import type { PromptContext, PromptMessage, PromptRole, Tokenizer } from "./types.ts";

/**
 * Rendering the message tree's active path into turns (SPEC §3).
 *
 * Two modes, one function, because they differ only in how a turn is labelled:
 *
 * **Author mode.** There is one point of view, the author's. Every non-user
 * message is an `assistant` turn prefixed with its speaker's name, and user
 * messages are `user` turns labelled with the persona name. No alternation
 * gymnastics and no per-speaker re-render, which is what keeps the prefix stable
 * and prompt caching working (§0.6).
 *
 * **Single-character mode.** No author, one character, standard card rendering:
 * the character simply is the assistant, so nothing is labelled.
 */

export type RenderMode = "author" | "single_character";

export interface RenderedTurn {
  role: PromptRole;
  content: string;
  messageId: string;
  tokens: number;
}

export interface RenderedHistory {
  turns: RenderedTurn[];
  /** Messages the user excluded from the prompt, for the inspector. */
  hidden: { id: string; label: string }[];
  /** Messages a summary stood in for, for the inspector (§11). */
  summarized: { id: string; label: string; tokens: number }[];
}

function speakerLabel(ctx: PromptContext, message: PromptMessage): string | null {
  // A beat already carries a label per speaker inside its own text (§3.5), so
  // prefixing it with the member it is filed under would attribute the whole
  // exchange to whoever happened to open it.
  if (message.kind === "beat") return null;

  switch (message.authorType) {
    case "user":
      // A transcript still needs a consistent label for the reader's turns.
      return ctx.persona.name ?? "Reader";
    case "narrator":
      return "Narration";
    case "ooc":
      return `${ctx.author?.name ?? "Author"} (out of character)`;
    case "system":
      return null;
    case "character": {
      const character = ctx.cast.find((member) => member.id === message.characterId);
      // A character removed from the cast must not cost the line its text: fall
      // back to a neutral label rather than dropping the turn.
      return character?.name ?? "Someone";
    }
  }
}

/** Wrap a re-injected block in the preset's own words (§13). */
function wrapReasoning(ctx: PromptContext, reasoning: string): string {
  if (reasoning === "") return "";
  const prefix = ctx.reasoning?.prefix ?? "";
  const suffix = ctx.reasoning?.suffix ?? "";
  const head = prefix === "" ? "" : `${prefix}\n`;
  const tail = suffix === "" ? "" : `\n${suffix}`;
  return `${head}${reasoning}${tail}\n\n`;
}

function roleFor(message: PromptMessage): PromptRole {
  if (message.authorType === "user") return "user";
  if (message.authorType === "system") return "system";
  return "assistant";
}

/**
 * Cost a turn. A cached count covers the message's own text; the label is
 * counted separately and added, which over-counts by at most a token per turn
 * under the estimator — the safe direction (§3).
 */
function costOf(tokenizer: Tokenizer, message: PromptMessage, prefix: string): number {
  const body = message.tokenCount ?? tokenizer.count(message.content);
  const withPrefix = prefix === "" ? body : body + tokenizer.count(prefix);
  // Counted rather than assumed: the cached count on the row is the message's
  // own text, and a caption is not part of it (§20 phase 41).
  return withPrefix + tokenizer.count(attachmentsOf(message));
}

/**
 * What the pictures on a turn show, as a line of its own (§20 phase 41).
 *
 * Bracketed and named, so the author can tell a description of a photograph the
 * reader pasted from something a character said. Empty for the overwhelming
 * majority of turns, which is why it concatenates rather than joins.
 */
function attachmentsOf(message: PromptMessage): string {
  const captions = (message.attachments ?? []).filter((caption) => caption.trim() !== "");
  if (captions.length === 0) return "";
  return `\n${captions.map((caption) => `[image: ${caption.trim()}]`).join("\n")}`;
}

export function renderHistory(ctx: PromptContext, mode: RenderMode): RenderedHistory {
  const turns: RenderedTurn[] = [];
  const hidden: { id: string; label: string }[] = [];
  const summarized: { id: string; label: string; tokens: number }[] = [];

  // §11 keeps the last user message whatever else goes: an evicted history that
  // drops the thing being replied to leaves the turn with nothing to answer.
  const lastUserId = ctx.history.filter((message) => message.authorType === "user").at(-1)?.id;

  // §13: reasoning is not fed back unless the preset asks, and then only for
  // the last N blocks. Which N is decided here, over the whole path, so that
  // trimming history later cannot change which turns were eligible.
  const reinject = ctx.reasoning?.reinjectLast ?? 0;
  const carryReasoning = new Set(
    reinject === 0
      ? []
      : ctx.history
          .filter((message) => (message.reasoning ?? "").trim() !== "")
          .slice(-reinject)
          .map((message) => message.id),
  );

  for (const message of ctx.history) {
    if (message.isHidden) {
      hidden.push({ id: message.id, label: speakerLabel(ctx, message) ?? "System" });
      continue;
    }

    const label = mode === "author" ? speakerLabel(ctx, message) : null;
    const prefix = label === null ? "" : `${label}: `;
    const thought = carryReasoning.has(message.id)
      ? wrapReasoning(ctx, (message.reasoning ?? "").trim())
      : "";
    const tokens = costOf(ctx.tokenizer, message, prefix) + ctx.tokenizer.count(thought);

    // Raw eviction (§11): a summary the prompt is carrying already says what
    // this message said, so showing both spends the budget twice.
    if (
      ctx.evictSummarized === true &&
      message.isSummarized === true &&
      message.id !== lastUserId
    ) {
      summarized.push({ id: message.id, label: speakerLabel(ctx, message) ?? "System", tokens });
      continue;
    }

    turns.push({
      role: roleFor(message),
      // The reasoning goes *before* the turn it produced, because that is the
      // order it happened in and the only order that reads as thinking rather
      // than as an afterword.
      content: `${thought}${prefix}${message.content}${attachmentsOf(message)}`,
      messageId: message.id,
      tokens,
    });
  }

  return { turns, hidden, summarized };
}
