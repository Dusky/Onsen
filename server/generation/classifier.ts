import type { BuiltPrompt, Tokenizer } from "../prompt/index.ts";
import type { ResolvedTurnScope } from "../../shared/types.ts";

/**
 * The classifier turn director (SPEC §6).
 *
 * "Let an AI decide who speaks next" has been an open request in SillyTavern
 * for years; the alternative on offer there is a talkativeness dice roll plus
 * whole-word name matching, which users find arbitrary. The fix is not a better
 * heuristic — it is asking a model, cheaply, and then *showing its reasoning*,
 * which is why the reply format asks for a sentence as well as a name.
 *
 * This module is pure: it builds the question and reads the answer. The call
 * itself belongs to the generation service, which is where the adapters are.
 *
 * Everything here is written on the assumption that the model answering is
 * small and fast and will not follow instructions perfectly. The format is
 * three plain lines rather than JSON, the parser accepts a bare name, and a
 * reply that cannot be read at all is a null the caller falls back from — never
 * an error that costs the user their turn.
 */

export interface ClassifierCandidate {
  id: string;
  name: string;
  /** One line about them, so the model has something to choose on. */
  description: string | null;
  /** Turns since they last spoke; null means they never have. */
  turnsSilent: number | null;
}

export interface ClassifierHistoryTurn {
  /** Already resolved for display — the persona's name, a character's, or narration. */
  speaker: string;
  content: string;
}

export interface ClassifierInput {
  candidates: ClassifierCandidate[];
  /** Oldest first. The caller decides how far back to go. */
  history: ClassifierHistoryTurn[];
  /** The reader's character, where they have named one. */
  reader: string | null;
  /**
   * Whether to ask for one voice or several as well as for a name. False when
   * the user has already chosen the scope, so the model is not invited to
   * second-guess them.
   */
  askScope: boolean;
}

/** How much of a turn the classifier is shown. It needs the gist, not the prose. */
const EXCERPT_LIMIT = 320;

function excerpt(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length <= EXCERPT_LIMIT ? flat : `${flat.slice(0, EXCERPT_LIMIT - 1)}…`;
}

function silenceOf(candidate: ClassifierCandidate): string {
  if (candidate.turnsSilent === null) return "has not spoken in this scene yet";
  if (candidate.turnsSilent === 0) return "spoke most recently";
  return `last spoke ${candidate.turnsSilent} turn${candidate.turnsSilent === 1 ? "" : "s"} ago`;
}

/** The question, as text. Separated from the prompt so it can be read in a test. */
export function classifierQuestion(input: ClassifierInput): string {
  // With no persona there is no name to use, and "the reader is the reader" is
  // not a sentence. The lock is the same either way.
  const readerClause =
    input.reader === null
      ? `The reader is not yours to choose, and never speaks on your say-so`
      : `${input.reader} is the reader, who is not yours to choose and never speaks on your say-so`;
  const roster = input.candidates
    .map((candidate) => {
      const about = candidate.description?.replace(/\s+/g, " ").trim();
      const gist = about === undefined || about === "" ? null : excerpt(about);
      return `- ${candidate.name}${gist === null ? "" : ` — ${gist}`} (${silenceOf(candidate)})`;
    })
    .join("\n");

  const transcript =
    input.history.length === 0
      ? "(the scene has not started)"
      : input.history.map((turn) => `${turn.speaker}: ${excerpt(turn.content)}`).join("\n");

  const lines = [
    `You are directing a scene. Decide who speaks next.`,
    "",
    `Who is available:`,
    roster,
    "",
    `What has just happened, oldest first. ${readerClause}:`,
    transcript,
    "",
    `Answer with ${input.askScope ? "three lines" : "two lines"} and nothing else, ` +
      `in this order and this format:`,
    "",
    `SPEAKER: the name of exactly one person from the list above`,
  ];

  if (input.askScope) {
    lines.push(
      `SCOPE: one — if that person answering is the whole of what happens next; ` +
        `room — if several of them would be drawn in and the exchange would run ` +
        `between them`,
    );
  }

  lines.push(
    `WHY: one short sentence, for the reader, saying what in the scene makes ` +
      `that the right choice. Point at something that actually happened.`,
    "",
    `Do not explain your format, do not add anything after the last line, and do ` +
      `not pick anyone who is not on the list.`,
  );

  return lines.join("\n");
}

/**
 * The classifier's prompt.
 *
 * Deliberately not the roleplay prompt with a question bolted on: this call is
 * cheap because it is small, and handing a small model the whole scene is how
 * a classifier turns into a second generation.
 */
export function buildClassifierPrompt(input: ClassifierInput, tokenizer: Tokenizer): BuiltPrompt {
  const system =
    `You decide, quickly and without commentary, which member of a cast speaks ` +
    `next in a story. You answer in the exact format you are given.`;
  const question = classifierQuestion(input);

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
          label: "Classifier",
          source: "turn director",
          role: "system",
          content: system,
          placement: { kind: "prefix" },
          tokens: tokenizer.count(system),
        },
        {
          id: "spotlight_instruction",
          label: "Question",
          source: "turn director",
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

export interface ClassifierReply {
  characterId: string;
  name: string;
  /** Null when the scope was not asked for, or the answer was unreadable. */
  scope: ResolvedTurnScope | null;
  /** The model's own sentence, or null when it did not give one. */
  reason: string | null;
}

/**
 * Strip the decoration a model puts around a name: quotes, asterisks, and the
 * full stop it adds when it thinks it is writing a sentence. Names only — a
 * reason is prose, and taking its full stop off would be vandalism.
 */
function bare(value: string): string {
  return value
    .replace(/[*_`"'“”‘’]/g, "")
    .replace(/[.,;:]+\s*$/, "")
    .trim();
}

/** The value of a `KEY: value` line, verbatim apart from surrounding space. */
function fieldOf(text: string, key: string): string | null {
  const match = new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`, "im").exec(text);
  return match === null ? null : match[1]!.trim();
}

/**
 * Match a name the model wrote against the cast.
 *
 * Exact first, then a containment either way, then a first-name match — a model
 * asked for "Sister Bell" will answer "Bell" often enough that refusing it
 * would throw away a correct decision on a formatting difference.
 */
function resolveName(
  written: string,
  candidates: ClassifierCandidate[],
): ClassifierCandidate | null {
  const needle = bare(written).toLowerCase();
  if (needle === "") return null;

  const exact = candidates.find((c) => c.name.toLowerCase() === needle);
  if (exact !== undefined) return exact;

  const contained = candidates.filter(
    (c) => c.name.toLowerCase().includes(needle) || needle.includes(c.name.toLowerCase()),
  );
  if (contained.length === 1) return contained[0]!;

  const byFirstName = candidates.filter(
    (c) => (c.name.split(/\s+/)[0] ?? "").toLowerCase() === needle,
  );
  return byFirstName.length === 1 ? byFirstName[0]! : null;
}

function readScope(value: string | null): ResolvedTurnScope | null {
  if (value === null) return null;
  const word = value.toLowerCase();
  if (word.startsWith("room") || word.includes("several") || word.includes("beat")) return "beat";
  if (word.startsWith("one") || word.includes("single") || word.includes("spotlight")) {
    return "spotlight";
  }
  return null;
}

/** A reason long enough to be an essay is not a caption; keep it to a sentence. */
const REASON_LIMIT = 180;

/**
 * Read the reply. Null means it could not be read at all, which the caller
 * treats as "the classifier did not answer" and falls back from — a director
 * that costs the user their turn when a small model rambles is worse than no
 * director.
 */
export function parseClassifierReply(
  text: string,
  candidates: ClassifierCandidate[],
): ClassifierReply | null {
  const named = fieldOf(text, "SPEAKER");
  // A model that ignores the format often just says the name. That is a
  // perfectly good answer and refusing it would be pedantry.
  const fallbackName = named === null ? bare(text.split("\n")[0] ?? "") : null;
  const resolved = resolveName(named ?? fallbackName ?? "", candidates);
  if (resolved === null) return null;

  const why = fieldOf(text, "WHY");
  const reason = why === null || why === "" ? null : why.slice(0, REASON_LIMIT);

  return {
    characterId: resolved.id,
    name: resolved.name,
    scope: readScope(fieldOf(text, "SCOPE")),
    reason,
  };
}
