import type { BuiltPrompt, Tokenizer } from "../prompt/index.ts";

/**
 * AI-assisted tagging (SPEC §9, §20 phase 26).
 *
 * The card is read and tags are proposed *from the existing vocabulary* — the
 * one thing the spec insists on, because the manual-and-inconsistent tagging it
 * calls the unsolved problem is only fixed if every new card speaks the
 * library's own language, not the model's. The reply is a comma list of plain
 * words; a model that writes a sentence still yields a list, because every
 * word is a candidate and the user accepts or rejects them one at a time.
 */

export interface TagSuggestionInput {
  /** The card's searchable fields, flattened for the model. */
  name: string;
  description: string | null;
  personality: string | null;
  creatorNotes: string | null;
  /** The vocabulary the proposal must speak — empty means "propose fresh". */
  vocabulary: string[];
}

export function suggestTagsQuestion(input: TagSuggestionInput): string {
  const fields = [
    `Name: ${input.name}`,
    input.description === null ? null : `Description: ${input.description}`,
    input.personality === null ? null : `Personality: ${input.personality}`,
    input.creatorNotes === null ? null : `Creator notes: ${input.creatorNotes}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const vocabularyLine =
    input.vocabulary.length === 0
      ? "There is no existing vocabulary; propose tags you think the library should adopt."
      : `Prefer these existing tags, and only propose a new one when none fits: ${input.vocabulary.join(", ")}.`;

  return [
    `You tag a character card for a searchable library.`,
    ``,
    fields,
    ``,
    vocabularyLine,
    ``,
    `Answer with between three and eight tags, comma separated, lowercase, ` +
      `each one or two words, nothing else.`,
  ].join("\n");
}

export function buildSuggestTagsPrompt(
  input: TagSuggestionInput,
  tokenizer: Tokenizer,
): BuiltPrompt {
  const system = `You read a character card and tag it for a searchable library. You answer only as a comma-separated list of tags.`;
  const question = suggestTagsQuestion(input);
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
          label: "Suggest tags",
          source: "character library",
          role: "system",
          content: system,
          placement: { kind: "prefix" },
          tokens: tokenizer.count(system),
        },
        {
          id: "spotlight_instruction",
          label: "Question",
          source: "character library",
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
      // A side call's prompt has no lore to explain.
      loreTrace: [],
      // A side call's prompt recalls no documents.
      retrievedChunks: [],
      memoryTrace: [],
    },
  };
}

/**
 * Every tag-shaped word on the first line, deduplicated. A model that writes a
 * sentence yields its nouns; the user is the gate either way, so a loose parse
 * is better than an empty answer.
 */
export function parseTagSuggestions(text: string): string[] {
  const first = text.split(/\r?\n/, 1)[0] ?? text;
  const words = first
    .split(/[,;|]+/)
    .map((word) => word.replace(/^[\s*"'.`-]+|[\s*"'.`-]+$/g, "").trim().toLowerCase())
    .filter((word) => /^[a-z0-9][a-z0-9 _-]{0,30}$/.test(word) && word.length <= 32);
  return [...new Set(words)];
}
