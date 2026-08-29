/**
 * Reading and writing character cards (SPEC §9).
 *
 * The V2 and V3 specs share a shape: a `{ spec, spec_version, data }` envelope
 * around the fields. V1 cards are a bare object with no envelope at all, and
 * plenty of them are still in circulation, so all three are accepted.
 *
 * The governing rule is that import must not be lossy. Normalising into typed
 * fields is only a *view*; the original document is kept verbatim and export
 * re-emits from it with the modelled fields overlaid. A card carrying an
 * extension nobody here understands still survives a round trip byte for byte
 * in every field this app does not touch.
 */

export type CardFormat = "png_v2" | "png_v3" | "json" | "charx" | "native";

/** The fields this app models. Everything else lives on in `rawCard`. */
export interface NormalisedCard {
  name: string;
  description: string | null;
  personality: string | null;
  scenario: string | null;
  firstMessage: string | null;
  alternateGreetings: string[];
  groupGreetings: string[];
  exampleDialogue: string | null;
  systemPrompt: string | null;
  postHistoryInstructions: string | null;
  creatorNotes: string | null;
  tags: string[];
  creator: string | null;
  characterVersion: string | null;
  /** From `extensions.depth_prompt` (§2). */
  depthPrompt: string | null;
  depthPromptDepth: number;
  depthPromptRole: "system" | "user" | "assistant";
  /** Everything under `extensions`, including what this app does not model. */
  extensions: Record<string, unknown>;
}

export interface ParsedCard {
  card: NormalisedCard;
  /** The original document, exactly as it arrived. */
  rawCard: string;
  format: CardFormat;
  /** Fields present in the source that this app does not model, for reporting. */
  unmodelledFields: string[];
  /** Warnings worth showing at import rather than swallowing. */
  warnings: string[];
}

export class CardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardError";
  }
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** The fields the normaliser reads; anything else is reported as unmodelled. */
const MODELLED = new Set([
  "name",
  "description",
  "personality",
  "scenario",
  "first_mes",
  "mes_example",
  "alternate_greetings",
  "group_only_greetings",
  "system_prompt",
  "post_history_instructions",
  "creator_notes",
  "creator_notes_multilingual",
  "tags",
  "creator",
  "character_version",
  "extensions",
  // Read by the lorebook importer in phase 19; carried in raw_card until then.
  "character_book",
  // V1 leftovers with no modern meaning.
  "talkativeness",
  "fav",
  "avatar",
  "nickname",
  "assets",
  "source",
  "creation_date",
  "modification_date",
]);

/**
 * `extensions.depth_prompt` is the CCv2 convention for a note injected at a
 * fixed depth whenever a character is present. Different exporters disagree on
 * whether depth is a number or a string, so both are accepted.
 */
function readDepthPrompt(extensions: Record<string, unknown>): {
  prompt: string | null;
  depth: number;
  role: "system" | "user" | "assistant";
} {
  const raw = asObject(extensions["depth_prompt"]);
  const depth = Number(raw["depth"]);
  const role = raw["role"];
  return {
    prompt: asString(raw["prompt"]),
    depth: Number.isFinite(depth) ? depth : 4,
    role: role === "user" || role === "assistant" ? role : "system",
  };
}

/**
 * Unwrap the envelope. V2 and V3 nest under `data`; V1 is the bare object.
 * The version reported by the file is trusted only as a hint — a file claiming
 * V3 while carrying V2 fields still reads correctly, because the field names
 * are what actually differ.
 */
function unwrap(document: Record<string, unknown>): {
  data: Record<string, unknown>;
  declared: string | null;
} {
  const spec = asString(document["spec"]);
  if (spec !== null && "data" in document) {
    return { data: asObject(document["data"]), declared: asString(document["spec_version"]) };
  }
  return { data: document, declared: null };
}

/**
 * Fields a card carries that this app does not surface in the editor. They are
 * preserved verbatim and survive export; naming them is what stops an import
 * being silently partial (SPEC §18).
 *
 * `extensions` is descended into, because that is where the interesting
 * unknowns live — another frontend's private configuration, a spec revision
 * this app predates.
 */
export function unmodelledFieldsOf(data: Record<string, unknown>): string[] {
  const top = Object.keys(data).filter((key) => !MODELLED.has(key));
  const extensions = Object.keys(asObject(data["extensions"]))
    .filter((key) => key !== "depth_prompt")
    .map((key) => `extensions.${key}`);
  return [...top, ...extensions];
}

/** Read a card document, whatever envelope it uses, and report what it carries. */
export function unmodelledFieldsOfDocument(json: string): string[] {
  try {
    const { data } = unwrap(asObject(JSON.parse(json)));
    return unmodelledFieldsOf(data);
  } catch {
    return [];
  }
}

export function parseCardJson(json: string, format: CardFormat): ParsedCard {
  let document: Record<string, unknown>;
  try {
    document = asObject(JSON.parse(json));
  } catch {
    throw new CardError("That file does not contain valid JSON.");
  }

  const { data, declared } = unwrap(document);
  const name = asString(data["name"]) ?? asString(data["char_name"]);
  if (name === null) throw new CardError("That card has no name, so it is not a character card.");

  const extensions = asObject(data["extensions"]);
  const depth = readDepthPrompt(extensions);
  const warnings: string[] = [];

  // Two fields are the ones other importers most often drop, so their absence
  // and presence are both worth being explicit about.
  const alternateGreetings = asStringArray(data["alternate_greetings"]);
  const characterBook = data["character_book"];
  if (characterBook !== undefined && characterBook !== null) {
    warnings.push(
      "This card carries an embedded lorebook. It is preserved in the original card and will be imported when lorebooks arrive.",
    );
  }

  const unmodelledFields = unmodelledFieldsOf(data);

  return {
    format,
    rawCard: json,
    unmodelledFields,
    warnings,
    card: {
      name,
      description: asString(data["description"]),
      personality: asString(data["personality"]),
      scenario: asString(data["scenario"]),
      firstMessage: asString(data["first_mes"]),
      alternateGreetings,
      // V3's name for greetings used only in group scenes.
      groupGreetings: asStringArray(data["group_only_greetings"]),
      exampleDialogue: asString(data["mes_example"]),
      systemPrompt: asString(data["system_prompt"]),
      postHistoryInstructions: asString(data["post_history_instructions"]),
      creatorNotes: asString(data["creator_notes"]),
      tags: asStringArray(data["tags"]),
      creator: asString(data["creator"]),
      characterVersion: asString(data["character_version"]) ?? declared,
      depthPrompt: depth.prompt,
      depthPromptDepth: depth.depth,
      depthPromptRole: depth.role,
      extensions,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Produce a V3 card document, overlaying current values onto the original.
 *
 * Starting from `rawCard` rather than building fresh is what makes export
 * lossless: a field this app never modelled — a custom extension, an embedded
 * lorebook, a creator's own metadata — is carried through untouched, while
 * anything the user edited here wins.
 */
export function buildCardDocument(card: NormalisedCard, rawCard: string | null): string {
  let base: Record<string, unknown> = {};
  if (rawCard !== null) {
    try {
      const { data } = unwrap(asObject(JSON.parse(rawCard)));
      base = data;
    } catch {
      // An unreadable original is not worth failing an export over; the
      // modelled fields alone still produce a valid card.
    }
  }

  const extensions = { ...asObject(base["extensions"]), ...card.extensions };
  if (card.depthPrompt === null) {
    delete extensions["depth_prompt"];
  } else {
    extensions["depth_prompt"] = {
      prompt: card.depthPrompt,
      depth: card.depthPromptDepth,
      role: card.depthPromptRole,
    };
  }

  const data: Record<string, unknown> = {
    ...base,
    name: card.name,
    description: card.description ?? "",
    personality: card.personality ?? "",
    scenario: card.scenario ?? "",
    first_mes: card.firstMessage ?? "",
    mes_example: card.exampleDialogue ?? "",
    alternate_greetings: card.alternateGreetings,
    group_only_greetings: card.groupGreetings,
    system_prompt: card.systemPrompt ?? "",
    post_history_instructions: card.postHistoryInstructions ?? "",
    creator_notes: card.creatorNotes ?? "",
    tags: card.tags,
    creator: card.creator ?? "",
    character_version: card.characterVersion ?? "",
    extensions,
  };

  return JSON.stringify({ spec: "chara_card_v3", spec_version: "3.0", data }, null, 2);
}

/** The V2 view of the same card, for the `chara` chunk V3 also writes. */
export function buildV2Document(card: NormalisedCard, rawCard: string | null): string {
  const v3 = JSON.parse(buildCardDocument(card, rawCard)) as { data: Record<string, unknown> };
  // V2 has no group-only greetings; dropping the key is more honest than
  // emitting one a V2 reader would ignore anyway.
  const data = { ...v3.data };
  delete data["group_only_greetings"];
  return JSON.stringify({ spec: "chara_card_v2", spec_version: "2.0", data }, null, 2);
}
