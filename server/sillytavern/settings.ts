/**
 * Reading the rest of a SillyTavern install (SPEC §20 phase 44): personas,
 * instruct templates, regex scripts, and the one thing that cannot come across.
 *
 * Pure, like `chat.ts`, and for the same reason. Each reader returns what it
 * could map *and a list of what it could not*, because SPEC §18 is explicit:
 * "Don't pretend round-tripping is clean when it isn't." A silent partial
 * import is the worst of the three outcomes here — worse than refusing, which
 * at least tells you to do it by hand.
 */
import type { ApplyStage } from "../../shared/types.ts";
import type { InstructTemplate } from "../prompt/instruct.ts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/* ------------------------------------------------------------------ */
/* Personas                                                            */
/* ------------------------------------------------------------------ */

export interface ParsedPersona {
  name: string;
  description: string | null;
  /** The avatar filename SillyTavern keys them by, for matching on re-import. */
  avatar: string;
  isDefault: boolean;
}

/**
 * Personas out of `settings.json`.
 *
 * SillyTavern keeps them in two parallel maps, both keyed by avatar filename:
 * `personas` holds the display name, `persona_descriptions` the description and
 * its injection settings. Only the name and description have a home here — the
 * depth and position of a persona description are SillyTavern's prompt assembly,
 * and Onsen's builder decides that itself (§3).
 */
export function parsePersonas(settings: unknown): ParsedPersona[] {
  const root = asRecord(settings);
  if (root === null) return [];
  const names = asRecord(root["personas"]);
  if (names === null) return [];
  const descriptions = asRecord(root["persona_descriptions"]) ?? {};
  const active = str(root["user_avatar"]);

  const parsed: ParsedPersona[] = [];
  for (const [avatar, value] of Object.entries(names)) {
    const name = str(value).trim();
    if (name === "") continue;
    const entry = asRecord(descriptions[avatar]);
    const description = str(entry?.["description"]).trim();
    parsed.push({
      name,
      description: description === "" ? null : description,
      avatar,
      isDefault: avatar === active,
    });
  }
  return parsed;
}

/* ------------------------------------------------------------------ */
/* Instruct templates                                                  */
/* ------------------------------------------------------------------ */

export interface ParsedInstruct {
  template: Omit<InstructTemplate, "id">;
  /** Fields the file set that Onsen has nowhere to put. Reported per template. */
  dropped: string[];
}

/**
 * Everything SillyTavern's instruct format carries that Onsen's does not.
 *
 * Onsen renders one prefix and suffix per role; SillyTavern additionally varies
 * them by position in the conversation, wraps sequences in newlines on a flag,
 * and runs macros inside them. `wrap` in particular changes the rendered prompt
 * materially, so it is named rather than quietly ignored.
 */
const UNMAPPED_INSTRUCT_FIELDS = [
  "first_input_sequence",
  "last_input_sequence",
  "first_output_sequence",
  "last_output_sequence",
  "last_system_sequence",
  "story_string_prefix",
  "story_string_suffix",
  "user_alignment_message",
  "activation_regex",
  "names_behavior",
  "wrap",
  "macro",
  "skip_examples",
  "sequences_as_stop_strings",
  "bind_to_context",
] as const;

/** True for a field the file actually sets — an empty string is not a setting. */
function isSet(value: unknown): boolean {
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "boolean") return value;
  return value !== undefined && value !== null;
}

export function parseInstruct(document: unknown): ParsedInstruct | null {
  const root = asRecord(document);
  if (root === null) return null;
  // An instruct export is recognised by its sequences; a context template and a
  // sampler preset both live in neighbouring folders and are not this.
  if (!("input_sequence" in root) && !("output_sequence" in root)) return null;

  const name = str(root["name"], str(root["preset"], "Imported")).trim() || "Imported";
  const stop = str(root["stop_sequence"]).trim();

  return {
    template: {
      name,
      // SillyTavern has no BOS field: it leaves that to the backend. Onsen's
      // default of none matches what those backends already do for themselves.
      bos: "",
      systemPrefix: str(root["system_sequence"]),
      systemSuffix: str(root["system_suffix"]),
      userPrefix: str(root["input_sequence"]),
      userSuffix: str(root["input_suffix"]),
      assistantPrefix: str(root["output_sequence"]),
      assistantSuffix: str(root["output_suffix"]),
      systemInUser: root["system_same_as_user"] === true,
      stopSequences: stop === "" ? [] : [stop],
    },
    dropped: UNMAPPED_INSTRUCT_FIELDS.filter((field) => isSet(root[field])),
  };
}

/* ------------------------------------------------------------------ */
/* Context templates — the one that cannot come across                 */
/* ------------------------------------------------------------------ */

/**
 * A context template is a text template for assembling the whole prompt —
 * `story_string` with its macros, `chat_start`, `example_separator`.
 *
 * Onsen has nowhere to put one, and that is a design decision rather than a
 * gap: §3's builder assembles blocks itself, with a budget and an eviction
 * order, which is the thing that makes the inspector and the token accounting
 * possible. There is no story string to paste this into.
 *
 * So it is refused, by name, with the native equivalent named too — which is
 * §18's own instruction for an import whose behaviour is one of your own
 * subsystems.
 */
export function isContextTemplate(document: unknown): boolean {
  const root = asRecord(document);
  return root !== null && "story_string" in root;
}

export const CONTEXT_TEMPLATE_REFUSAL =
  "Context templates assemble the whole prompt as one text template. Onsen builds " +
  "the prompt from blocks with their own budget, so there is nothing to paste this " +
  "into — the equivalent is Settings → prompt options.";

/* ------------------------------------------------------------------ */
/* Regex scripts                                                       */
/* ------------------------------------------------------------------ */

export interface ParsedRegex {
  name: string;
  pattern: string;
  replacement: string;
  flags: string;
  applyTo: ApplyStage;
  enabled: boolean;
  dropped: string[];
}

/**
 * SillyTavern's `placement`, as the numbers actually written into the file.
 *
 * 1 is the reader's message, 2 is the model's. 3 is slash-command output and 5
 * is world info, neither of which is a stage Onsen has — a script placed only
 * there has nothing to run on and is reported rather than filed somewhere it
 * will surprise someone later.
 */
const PLACEMENT_USER_INPUT = 1;
const PLACEMENT_AI_OUTPUT = 2;

/**
 * `/pattern/flags` where SillyTavern wrote a literal, the bare pattern where it
 * wrote a string. Both forms are in the wild.
 */
function splitPattern(find: string): { pattern: string; flags: string } {
  const literal = /^\/(.*)\/([gimsuy]*)$/s.exec(find);
  if (literal === null) return { pattern: find, flags: "g" };
  // A literal with no flags still wants `g`: SillyTavern replaces every match.
  return { pattern: literal[1]!, flags: literal[2] === "" ? "g" : literal[2]! };
}

export function parseRegex(document: unknown): ParsedRegex | null {
  const root = asRecord(document);
  if (root === null || typeof root["findRegex"] !== "string") return null;

  const placement = Array.isArray(root["placement"])
    ? root["placement"].filter((v): v is number => typeof v === "number")
    : [];
  const onUser = placement.includes(PLACEMENT_USER_INPUT);
  const onOutput = placement.includes(PLACEMENT_AI_OUTPUT);

  // `markdownOnly` means "change what is shown, not what is stored", and
  // `promptOnly` means the reverse. Onsen spells those `display_only` and
  // `prompt`, and they win over the placement because in SillyTavern they are
  // what actually decides where the substitution lands.
  let applyTo: ApplyStage;
  if (root["markdownOnly"] === true) applyTo = "display_only";
  else if (root["promptOnly"] === true) applyTo = "prompt";
  else if (onUser && !onOutput) applyTo = "user_input";
  else applyTo = "ai_output";

  const dropped: string[] = [];
  // A script placed only on slash commands or world info has no stage here.
  if (placement.length > 0 && !onUser && !onOutput) {
    dropped.push("placement (slash commands and world info have no stage here)");
  }
  if (Array.isArray(root["trimStrings"]) && root["trimStrings"].length > 0) {
    dropped.push("trimStrings");
  }
  for (const field of ["minDepth", "maxDepth", "runOnEdit", "substituteRegex"] as const) {
    if (isSet(root[field])) dropped.push(field);
  }

  const { pattern, flags } = splitPattern(root["findRegex"]);
  return {
    name: str(root["scriptName"], "Imported script").trim() || "Imported script",
    pattern,
    replacement: str(root["replaceString"]),
    flags,
    applyTo,
    enabled: root["disabled"] !== true,
    dropped,
  };
}
