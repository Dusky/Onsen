import type { BuiltPrompt, Tokenizer } from "../prompt/index.ts";
import type { ImpersonatePerson } from "../../shared/types.ts";

/**
 * Impersonate (SPEC §7): expand a brief outline into a full message in the
 * reader's own voice.
 *
 * Pure, like the classifier's question. The result lands in the composer and
 * never auto-sends — it is a draft the user accepts, edits or throws away,
 * which is the whole reason this op is safe. It is the one place the author is
 * *asked* to write the reader's character, and it is safe precisely because
 * nothing it produces reaches the story without the user pressing send.
 *
 * Three persons, three prompts. §7 makes them separate ops with independently
 * overridable prompts rather than one op with a parameter, because "I reached
 * for the door", "You reach for the door" and "She reached for the door" are
 * three different registers and a shared prompt would blur them.
 */

export interface ImpersonateInput {
  /** The reader's character. Null when they have not said who they are. */
  persona: { name: string | null; description: string | null };
  /** The user's outline. Empty is a real ask: "write something for me". */
  outline: string;
  person: ImpersonatePerson;
  /** The tail of the scene, oldest first, already labelled. */
  history: { speaker: string; content: string }[];
  /** The author's name, where the scene has one. */
  author: string | null;
}

/** How much of a turn the outline is shown against. Enough for continuity. */
const EXCERPT_LIMIT = 600;

function excerpt(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length <= EXCERPT_LIMIT ? flat : `${flat.slice(0, EXCERPT_LIMIT - 1)}…`;
}

function personClause(person: ImpersonatePerson, name: string): string {
  switch (person) {
    case "first":
      return `Write it in the first person, as ${name} — "I said", "I reached for it".`;
    case "second":
      return `Write it in the second person, addressed to ${name} — "you said", "you reach for it".`;
    case "third":
      return `Write it in the third person, about ${name} — "${name} said", "${name} reached for it".`;
  }
}

/** The question, as text. Separated from the prompt so a test can read it. */
export function impersonateQuestion(input: ImpersonateInput): string {
  const name = input.persona.name ?? "the reader";
  const outline = input.outline.trim();

  const transcript =
    input.history.length === 0
      ? "(the scene has not started)"
      : input.history.map((turn) => `${turn.speaker}: ${excerpt(turn.content)}`).join("\n");

  return [
    `You are writing one turn for ${name}, the reader's own character, at their request.`,
    ...(input.persona.description === null
      ? []
      : ["", `Who ${name} is:`, input.persona.description.trim()]),
    "",
    `What has just happened, oldest first:`,
    transcript,
    "",
    outline === ""
      ? `${name} has not said what they want to do. Write the turn they would most plausibly ` +
        `take next — one that answers what just happened rather than starting something new.`
      : `${name} wants this turn to be, in their own shorthand:`,
    ...(outline === "" ? [] : [outline]),
    "",
    personClause(input.person, name),
    `Write only the turn itself — no preamble, no explanation, no quotation marks around the ` +
      `whole thing, and nothing after it. Do not write anyone else's dialogue or actions beyond ` +
      `what ${name} does to them. Match the length and register of the scene.`,
  ].join("\n");
}

export function buildImpersonatePrompt(
  input: ImpersonateInput,
  tokenizer: Tokenizer,
): BuiltPrompt {
  const system =
    input.author === null
      ? `You write one turn for the reader's own character, in their voice, and nothing else.`
      : `You are ${input.author}, the author of this story. Just this once you are writing the ` +
        `reader's own character for them, at their request, in their voice — and nothing else.`;
  const question = impersonateQuestion(input);
  const tokens = tokenizer.count(system) + tokenizer.count(question);

  return {
    system,
    messages: [{ role: "user", content: question }],
    outlets: {},
    debug: {
      mode: input.author === null ? "single_character" : "author",
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
          label: "Impersonate",
          source: "guided op",
          role: "system",
          content: system,
          placement: { kind: "prefix" },
          tokens: tokenizer.count(system),
        },
        {
          id: "spotlight_instruction",
          label: "Outline",
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

/**
 * Trim what a model wraps around a turn: a lead-in, surrounding quotes, a
 * trailing offer to continue. What lands in the composer should be text the
 * user could send unedited.
 */
export function cleanImpersonation(text: string): string {
  let cleaned = text.trim();
  // "Here is a possible turn:" and its many relatives.
  cleaned = cleaned.replace(/^[^\n]{0,80}:\s*\n+/, "");
  // A whole turn wrapped in quotes is a quotation of a turn, not a turn.
  if (/^["“](?:[\s\S]*)["”]$/.test(cleaned) && !cleaned.slice(1, -1).includes('"')) {
    cleaned = cleaned.slice(1, -1);
  }
  return cleaned.trim();
}
