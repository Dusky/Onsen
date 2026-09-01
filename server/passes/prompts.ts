import type { BuiltPrompt, Tokenizer } from "../prompt/index.ts";

/**
 * What each post-generation pass asks, and how its answer is read (SPEC §7.5).
 *
 * Pure, like the classifier's question and for the same reasons. These run on
 * cheap models and the parsers assume imperfect obedience: a pass that cannot
 * be read is a pass that says nothing, never one that says the wrong thing.
 *
 * Two of the three only *look*. SPEC §7.5 is deliberate about that — the
 * user-lock check "flags and offers a regeneration rather than silently
 * rewriting", because a pass that quietly rewrites a turn is a second author
 * nobody hired. Only prose refinement replaces, and it is off by default.
 */

const EXCERPT_LIMIT = 400;

function excerpt(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length <= EXCERPT_LIMIT ? flat : `${flat.slice(0, EXCERPT_LIMIT - 1)}…`;
}

function prompt(system: string, question: string, tokenizer: Tokenizer): BuiltPrompt {
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
          label: "Pass",
          // The marker every side call carries, so a scripted adapter and the
          // task log can tell a pass from a turn.
          source: "guided op",
          role: "system",
          content: system,
          placement: { kind: "prefix" },
          tokens: tokenizer.count(system),
        },
        {
          id: "spotlight_instruction",
          label: "Question",
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
      // A side call's prompt has no lore to explain.
      loreTrace: [],
    },
  };
}

/* ------------------------------------------------------------------ */
/* Voice validation — the flagship (SPEC §7.5)                         */
/* ------------------------------------------------------------------ */

export interface VoiceCheckInput {
  character: { name: string; description: string | null; voiceNotes: string | null };
  /** The part being read. One segment of a beat, or a whole spotlight turn. */
  text: string;
  /** What the same character said earlier, for a comparison that has teeth. */
  earlier: string[];
}

export function voiceCheckQuestion(input: VoiceCheckInput): string {
  const { character } = input;
  const lines = [
    `Does this sound like ${character.name}?`,
    "",
    `Who ${character.name} is:`,
    character.description?.trim() ?? "(nothing written down)",
  ];

  if (character.voiceNotes !== null && character.voiceNotes.trim() !== "") {
    lines.push("", `How ${character.name} talks:`, character.voiceNotes.trim());
  }

  if (input.earlier.length > 0) {
    lines.push(
      "",
      `What ${character.name} has said earlier in this scene:`,
      ...input.earlier.map((line) => `- ${excerpt(line)}`),
    );
  }

  lines.push(
    "",
    `The new lines:`,
    input.text.trim(),
    "",
    `Answer with two lines and nothing else:`,
    `VERDICT: ok — if this reads as ${character.name}; drifted — if it reads as somebody else, ` +
      `or as nobody in particular`,
    `WHY: one short sentence for the reader. If it drifted, point at the words that gave it ` +
      `away rather than describing the problem in general.`,
    "",
    `Judge the voice, not the events: a character doing something surprising is not drift, and a ` +
      `character saying it in somebody else's words is.`,
  );

  return lines.join("\n");
}

export function buildVoiceCheckPrompt(input: VoiceCheckInput, tokenizer: Tokenizer): BuiltPrompt {
  return prompt(
    `You read one character's lines and say whether they sound like that character. You answer ` +
      `in the exact format you are given, and nothing else.`,
    voiceCheckQuestion(input),
    tokenizer,
  );
}

/* ------------------------------------------------------------------ */
/* User-lock check (SPEC §0.5, §7.5)                                   */
/* ------------------------------------------------------------------ */

export interface LockCheckInput {
  /** The reader's character. Null name is a real state, not a missing value. */
  persona: { name: string | null; description: string | null };
  text: string;
}

export function lockCheckQuestion(input: LockCheckInput): string {
  const name = input.persona.name ?? "the reader";
  return [
    `In this story, ${name} belongs to the reader. Nobody else writes what they say, what they ` +
      `do, or what they think.`,
    ...(input.persona.description === null
      ? []
      : ["", `Who ${name} is:`, input.persona.description.trim()]),
    "",
    `A turn was just written by the author:`,
    input.text.trim(),
    "",
    `Answer with two lines and nothing else:`,
    `VERDICT: clear — if the turn leaves ${name} alone; taken — if it writes ${name}'s dialogue, ` +
      `actions, thoughts, or decides what they do next`,
    `WHY: one short sentence, quoting the words that took them over if it did.`,
    "",
    `Another character speaking *to* ${name}, or reacting to something ${name} already did, is ` +
      `clear. Only ${name} being made to act, speak or feel is taken.`,
  ].join("\n");
}

export function buildLockCheckPrompt(input: LockCheckInput, tokenizer: Tokenizer): BuiltPrompt {
  return prompt(
    `You check whether a piece of writing takes over a character it does not own. You answer in ` +
      `the exact format you are given, and nothing else.`,
    lockCheckQuestion(input),
    tokenizer,
  );
}

/* ------------------------------------------------------------------ */
/* Prose refinement — the only pass that replaces (SPEC §7.5)          */
/* ------------------------------------------------------------------ */

export interface RefineInput {
  text: string;
  /** Named so the pass knows whose register it is keeping. */
  speaker: string;
}

export function refineQuestion(input: RefineInput): string {
  return [
    `Here is a passage written as ${input.speaker}:`,
    "",
    input.text.trim(),
    "",
    `Write it again, better. Keep every event, every line of dialogue and the same ending — this ` +
      `is a polish, not a rewrite. What you may change is the vocabulary and the rhythm: cut the ` +
      `padding, break up sentences that all run the same length, and replace any phrase you have ` +
      `read a thousand times before with one you have not.`,
    "",
    `Reply with the passage alone. No preamble, no notes on what you changed.`,
  ].join("\n");
}

export function buildRefinePrompt(input: RefineInput, tokenizer: Tokenizer): BuiltPrompt {
  return prompt(
    `You improve the prose of a passage without changing what happens in it. You reply with the ` +
      `passage and nothing else.`,
    refineQuestion(input),
    tokenizer,
  );
}

/* ------------------------------------------------------------------ */
/* Reading the answers                                                 */
/* ------------------------------------------------------------------ */

export interface Verdict {
  /** True when the pass found something worth showing the user. */
  flagged: boolean;
  /** The model's own sentence. Null when it gave none. */
  detail: string | null;
}

/** A reason long enough to be an essay is not an annotation. */
const DETAIL_LIMIT = 220;

function fieldOf(text: string, key: string): string | null {
  const match = new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`, "im").exec(text);
  return match === null ? null : match[1]!.trim();
}

function bare(value: string): string {
  return value.replace(/[*_`"'“”‘’]/g, "").trim().toLowerCase();
}

/**
 * Read a two-line verdict.
 *
 * `flaggedWord` is the answer that means "something is wrong". Anything the
 * parser cannot recognise is *not* a flag: a pass that shouts at the user
 * because a small model rambled is worse than one that stays quiet.
 */
export function parseVerdict(text: string, flaggedWord: string): Verdict | null {
  const verdict = fieldOf(text, "VERDICT");
  // A model that ignores the format usually leads with the word anyway.
  const word = bare(verdict ?? text.split("\n")[0] ?? "");
  if (word === "") return null;

  const detail = fieldOf(text, "WHY");
  return {
    flagged: word.startsWith(flaggedWord),
    detail: detail === null || detail === "" ? null : detail.slice(0, DETAIL_LIMIT),
  };
}

/** Trim the wrapping a model puts around a passage it was asked to rewrite. */
export function cleanRefinement(text: string): string {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^[^\n]{0,80}:\s*\n+/, "");
  if (/^["“][\s\S]*["”]$/.test(cleaned) && !cleaned.slice(1, -1).includes('"')) {
    cleaned = cleaned.slice(1, -1);
  }
  return cleaned.trim();
}
