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
}

function speakerLabel(ctx: PromptContext, message: PromptMessage): string | null {
  switch (message.authorType) {
    case "user":
      return ctx.persona.name;
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
  return prefix === "" ? body : body + tokenizer.count(prefix);
}

export function renderHistory(ctx: PromptContext, mode: RenderMode): RenderedHistory {
  const turns: RenderedTurn[] = [];
  const hidden: { id: string; label: string }[] = [];

  for (const message of ctx.history) {
    if (message.isHidden) {
      hidden.push({ id: message.id, label: speakerLabel(ctx, message) ?? "System" });
      continue;
    }

    const label = mode === "author" ? speakerLabel(ctx, message) : null;
    const prefix = label === null ? "" : `${label}: `;
    turns.push({
      role: roleFor(message),
      content: `${prefix}${message.content}`,
      messageId: message.id,
      tokens: costOf(ctx.tokenizer, message, prefix),
    });
  }

  return { turns, hidden };
}
