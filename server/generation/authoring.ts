import type { BuiltPrompt, Tokenizer } from "../prompt/index.ts";

/**
 * AI-assisted authoring (SPEC §9, §20 phase 27).
 *
 * Six tasks, one shape: a small prompt that asks for a *structured record*, and
 * a server-side parser that enforces the schema rather than trusting the model
 * to emit valid JSON. Malformed structured output is the top complaint about
 * the extensions that do this today — so the answer is never "whatever the
 * model wrote", it is "this is what it wrote, and this is why it was refused".
 *
 * Every prompt here is pure: data in, prompt out. The call itself belongs to
 * the routes, which is where the adapters and the task runner are.
 */

/* ------------------------------------------------------------------ */
/* The shared bits: JSON out of a model's mouth                        */
/* ------------------------------------------------------------------ */

/**
 * A model asked for JSON still wraps it in prose, fences, or a trailing full
 * stop. Find the outermost object and parse that — anything more clever starts
 * trusting the shape of the wrapper.
 */
export function extractJson(text: string): unknown | null {
  const open = text.indexOf("{");
  const close = text.lastIndexOf("}");
  if (open === -1 || close <= open) return null;
  try {
    return JSON.parse(text.slice(open, close + 1)) as unknown;
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function string(value: unknown, allowEmpty = true): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return allowEmpty || trimmed !== "" ? trimmed : null;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return string(value) ?? null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    .map((item) => item.trim());
}

/* ------------------------------------------------------------------ */
/* The card schema every card-producing task fills                     */
/* ------------------------------------------------------------------ */

export interface AuthoringCard {
  name: string;
  description: string | null;
  personality: string | null;
  scenario: string | null;
  firstMessage: string | null;
  exampleDialogue: string | null;
  creatorNotes: string | null;
  tags: string[];
  voiceNotes: string | null;
}

/** A validated card, or the first field that failed — the reason a user sees. */
export type CardParse = { ok: true; card: AuthoringCard } | { ok: false; problem: string };

export function parseCard(value: unknown): CardParse {
  const object = record(value);
  if (object === null) return { ok: false, problem: "The reply was not an object." };
  const name = string(object["name"], false);
  if (name === null) return { ok: false, problem: "The reply had no name." };
  return {
    ok: true,
    card: {
      name,
      description: nullableString(object["description"]),
      personality: nullableString(object["personality"]),
      scenario: nullableString(object["scenario"]),
      firstMessage: nullableString(object["firstMessage"]),
      exampleDialogue: nullableString(object["exampleDialogue"]),
      creatorNotes: nullableString(object["creatorNotes"]),
      tags: stringArray(object["tags"]),
      voiceNotes: nullableString(object["voiceNotes"]),
    },
  };
}

const CARD_SHAPE = `{
  "name": "the character's name",
  "description": "who they are, for the prompt",
  "personality": "how they think and speak",
  "scenario": "the situation they start in",
  "firstMessage": "their opening line",
  "exampleDialogue": "a short exchange showing their voice",
  "creatorNotes": "notes for the reader, or null",
  "tags": ["two", "or", "three", "lowercase", "tags"],
  "voiceNotes": "speech tics and rhythm, or null"
}`;

function buildPrompt(
  system: string,
  question: string,
  tokenizer: Tokenizer,
  label: string,
  source: string,
): BuiltPrompt {
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
          label,
          source,
          role: "system",
          content: system,
          placement: { kind: "prefix" },
          tokens: tokenizer.count(system),
        },
        {
          id: "spotlight_instruction",
          label: "Question",
          source,
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
    },
  };
}

/* ------------------------------------------------------------------ */
/* Create character                                                    */
/* ------------------------------------------------------------------ */

export function buildCreateCharacterPrompt(
  input: { description: string; transcript: string | null },
  tokenizer: Tokenizer,
): BuiltPrompt {
  const system = `You write character cards for a roleplay app. You answer only as a single JSON object, no commentary, no code fences.`;
  const context =
    input.transcript === null || input.transcript === ""
      ? ""
      : `The current scene, for context:\n${input.transcript}\n\n`;
  const question = [
    `Write a character card from this description:`,
    input.description,
    ``,
    context,
    `Answer as JSON in exactly this shape, using null for anything the description does not give you:`,
    CARD_SHAPE,
  ].join("\n");
  return buildPrompt(system, question, tokenizer, "Create character", "authoring");
}

export function parseCreateCharacter(text: string): CardParse {
  const json = extractJson(text);
  if (json === null) return { ok: false, problem: "The reply was not valid JSON." };
  return parseCard(json);
}

/* ------------------------------------------------------------------ */
/* Revise character                                                    */
/* ------------------------------------------------------------------ */

export function buildReviseCharacterPrompt(
  input: { card: AuthoringCard; instructions: string },
  tokenizer: Tokenizer,
): BuiltPrompt {
  const system = `You revise a character card. You answer only as a single JSON object, no commentary.`;
  const question = [
    `Here is the card as it stands:`,
    JSON.stringify(input.card, null, 2),
    ``,
    `Make these changes, and only these:`,
    input.instructions,
    ``,
    `Answer as JSON containing only the fields you changed, in this shape — ` +
      `omit a field entirely to leave it untouched, and never change the name ` +
      `unless the instructions explicitly say to:`,
    CARD_SHAPE,
  ].join("\n");
  return buildPrompt(system, question, tokenizer, "Revise character", "authoring");
}

/** A partial card: the fields the model chose to change. */
export function parseReviseCharacter(text: string): CardParse {
  const json = extractJson(text);
  if (json === null) return { ok: false, problem: "The reply was not valid JSON." };
  const object = record(json);
  if (object === null) return { ok: false, problem: "The reply was not an object." };
  const name = "name" in object ? string(object["name"], false) : null;
  if ("name" in object && name === null) return { ok: false, problem: "The reply had an empty name." };
  const card: AuthoringCard = {
    name: name ?? "",
    description: "description" in object ? nullableString(object["description"]) : null,
    personality: "personality" in object ? nullableString(object["personality"]) : null,
    scenario: "scenario" in object ? nullableString(object["scenario"]) : null,
    firstMessage: "firstMessage" in object ? nullableString(object["firstMessage"]) : null,
    exampleDialogue: "exampleDialogue" in object ? nullableString(object["exampleDialogue"]) : null,
    creatorNotes: "creatorNotes" in object ? nullableString(object["creatorNotes"]) : null,
    tags: "tags" in object ? stringArray(object["tags"]) : [],
    voiceNotes: "voiceNotes" in object ? nullableString(object["voiceNotes"]) : null,
  };
  return { ok: true, card };
}

/* ------------------------------------------------------------------ */
/* Extract character                                                   */
/* ------------------------------------------------------------------ */

export function buildExtractCharacterPrompt(
  input: { transcript: string; name: string },
  tokenizer: Tokenizer,
): BuiltPrompt {
  const system = `You distil a character card from a scene's transcript. You answer only as a single JSON object, no commentary.`;
  const question = [
    `This is a scene transcript. Build a character card for ${input.name}, ` +
      `using only what the transcript establishes about them:`,
    input.transcript,
    ``,
    `Answer as JSON in exactly this shape:`,
    CARD_SHAPE,
  ].join("\n");
  return buildPrompt(system, question, tokenizer, "Extract character", "authoring");
}

export const parseExtractCharacter = parseCreateCharacter;

/* ------------------------------------------------------------------ */
/* Suggest voice notes                                                 */
/* ------------------------------------------------------------------ */

export function buildVoiceNotesPrompt(
  input: { card: AuthoringCard; dialogue: string | null },
  tokenizer: Tokenizer,
): BuiltPrompt {
  const system = `You write speech notes for a character card. You answer only as a single JSON object, no commentary.`;
  const dialogue =
    input.dialogue === null || input.dialogue === ""
      ? ""
      : `Their dialogue so far, if it helps:\n${input.dialogue}\n\n`;
  const question = [
    `Write voice notes — speech tics, vocabulary, rhythm — for this character:`,
    JSON.stringify(input.card, null, 2),
    ``,
    dialogue,
    `Answer as JSON: {"voiceNotes": "a short paragraph on how they speak"}.`,
  ].join("\n");
  return buildPrompt(system, question, tokenizer, "Suggest voice notes", "authoring");
}

export function parseVoiceNotes(text: string): { ok: true; voiceNotes: string } | { ok: false; problem: string } {
  const json = extractJson(text);
  const object = json === null ? null : record(json);
  const voiceNotes = object === null ? null : string(object["voiceNotes"], false);
  if (voiceNotes === null) return { ok: false, problem: "The reply had no voiceNotes." };
  return { ok: true, voiceNotes };
}

/* ------------------------------------------------------------------ */
/* Suggest lore entries                                                */
/* ------------------------------------------------------------------ */

export interface LoreProposal {
  title: string;
  content: string;
  keys: string[];
}

export function buildSuggestLorePrompt(
  input: { transcript: string },
  tokenizer: Tokenizer,
): BuiltPrompt {
  const system = `You propose world-information entries for a roleplay app. You answer only as a JSON array, no commentary.`;
  const question = [
    `From this scene transcript, propose two to four lore entries: durable facts ` +
      `about the world the author should remember. Each entry needs a title, a ` +
      `short factual paragraph, and two to four keyword keys that would summon it:`,
    input.transcript,
    ``,
    `Answer as a JSON array:`,
    `[{"title": "…", "content": "…", "keys": ["…", "…"]}]`,
  ].join("\n");
  return buildPrompt(system, question, tokenizer, "Suggest lore", "authoring");
}

export function parseLoreProposals(text: string): { ok: true; entries: LoreProposal[] } | { ok: false; problem: string } {
  const trimmed = text.trim();
  const open = trimmed.startsWith("[") ? 0 : trimmed.indexOf("[");
  const close = trimmed.lastIndexOf("]");
  if (open === -1 || close <= open) return { ok: false, problem: "The reply was not a JSON array." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice(open, close + 1)) as unknown;
  } catch {
    return { ok: false, problem: "The reply was not valid JSON." };
  }
  if (!Array.isArray(parsed)) return { ok: false, problem: "The reply was not an array." };
  const entries: LoreProposal[] = [];
  for (const item of parsed) {
    const object = record(item);
    if (object === null) continue;
    const title = string(object["title"], false);
    const content = string(object["content"], false);
    if (title === null || content === null) continue;
    entries.push({ title, content, keys: stringArray(object["keys"]).slice(0, 6) });
  }
  if (entries.length === 0) return { ok: false, problem: "No usable entries in the reply." };
  return { ok: true, entries };
}

/* ------------------------------------------------------------------ */
/* Revise lore entry                                                   */
/* ------------------------------------------------------------------ */

export function buildReviseLorePrompt(
  input: { entry: LoreProposal; transcript: string },
  tokenizer: Tokenizer,
): BuiltPrompt {
  const system = `You revise a world-information entry. You answer only as a single JSON object, no commentary.`;
  const question = [
    `Here is the entry as it stands:`,
    JSON.stringify(input.entry, null, 2),
    ``,
    `Here is what has happened since it was written:`,
    input.transcript,
    ``,
    `Update the entry to agree with what has happened. Answer as JSON:`,
    `{"title": "…", "content": "…", "keys": ["…"]}`,
  ].join("\n");
  return buildPrompt(system, question, tokenizer, "Revise lore", "authoring");
}

export function parseReviseLore(text: string): { ok: true; entry: LoreProposal } | { ok: false; problem: string } {
  const json = extractJson(text);
  const object = json === null ? null : record(json);
  if (object === null) return { ok: false, problem: "The reply was not a JSON object." };
  const title = string(object["title"], false);
  const content = string(object["content"], false);
  if (title === null || content === null) return { ok: false, problem: "The reply had no title or content." };
  return { ok: true, entry: { title, content, keys: stringArray(object["keys"]).slice(0, 6) } };
}
