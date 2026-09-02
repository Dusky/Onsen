import type { SamplerSettings } from "../../shared/types.ts";

/**
 * SillyTavern chat-completion preset import (SPEC §18, §20 phase 28).
 *
 * The parser is pure: preset bytes in, a typed record out. The format is not
 * forgiving — suites rename markers, disable most blocks by default, carry
 * state across blocks in macros — and every one of those failure modes is
 * decided here, where a test can read the decision, rather than in the route
 * that happens to run first.
 */

/** A sampler field we model, a field we do not, and a marker's fate. */
export interface StPresetParse {
  detected: "chat_completion" | "text_completion";
  name: string;
  samplers: SamplerSettings;
  /** ST field names we could not map onto a sampler we model. */
  unmappedSamplers: string[];
  /** The context window and response budget, where the preset names them. */
  contextSize: number | null;
  maxResponseTokens: number | null;
  /** Content blocks — the things that become option-group members. */
  blocks: StBlock[];
  /** Markers, by their reserved identifier, with whatever content they held. */
  markers: StMarker[];
  /** Macros in any block's content that this app's engine does not implement. */
  unsupportedMacros: string[];
}

export interface StBlock {
  identifier: string;
  name: string;
  role: "system" | "user" | "assistant";
  content: string;
  enabled: boolean;
  /** True when `injection_position` is 1 — absolute, i.e. at a depth. */
  atDepth: boolean;
  depth: number;
  order: number;
}

export interface StMarker {
  identifier: string;
  enabled: boolean;
  content: string | null;
}

/** The reserved marker identifiers §18 names. */
const RESERVED_MARKERS = new Set([
  "main",
  "jailbreak",
  "chatHistory",
  "charDescription",
  "characterDescription",
  "personaDescription",
  "scenario",
  "dialogueExamples",
  "worldInfoBefore",
  "worldInfoAfter",
]);

/** The macro names this app's engine resolves (server/prompt/macros.ts). */
const KNOWN_MACROS = new Set([
  "char",
  "user",
  "persona",
  "author",
  "scenario",
  "cast",
  "time",
  "date",
  "lastmessage",
  "idle_duration",
  "random",
  "pick",
  "roll",
  "tracker",
  "guide",
  "outlet",
]);

/** Sampler field names in ST, mapped to this app's names. */
const SAMPLER_MAP: Record<string, keyof SamplerSettings> = {
  temperature: "temperature",
  top_p: "top_p",
  top_k: "top_k",
  min_p: "min_p",
  repetition_penalty: "repetition_penalty",
  dry_multiplier: "dry_multiplier",
  dry_base: "dry_base",
  dry_allowed_length: "dry_allowed_length",
  dry_sequence_breakers: "dry_sequence_breakers",
  xtc_threshold: "xtc_threshold",
  xtc_probability: "xtc_probability",
};

/** ST field names we recognise but deliberately do not model. */
const KNOWN_UNMAPPED = new Set([
  "top_a",
  "typical_p",
  "tail_free_sampling",
  "frequency_penalty",
  "presence_penalty",
  "repetition_penalty_range",
  "frequency_penalty_range",
  "presence_penalty_range",
  "smooth_sampling",
  "mirostat",
  "mirostat_mode",
  "mirostat_tau",
  "temperature_last",
]);

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function collectMacros(text: string, into: Set<string>): void {
  const pattern = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*(?:::[a-zA-Z0-9_]+)?)\s*(?:::[^}]+)?\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    // `outlet::Name` is the known `outlet`; `setvar::mood` is the unknown
    // `setvar`. The base name decides, the argument never does.
    const base = (match[1] ?? "").split("::")[0]!.toLowerCase();
    if (!KNOWN_MACROS.has(base)) into.add(base);
  }
}

/** A chat-completion preset is the one with a `prompts` array (§18). */
function detectPresetKind(value: Record<string, unknown>): "chat_completion" | "text_completion" {
  return Array.isArray(value["prompts"]) ? "chat_completion" : "text_completion";
}

export function parseStPreset(bytes: string | Uint8Array, filename: string): StPresetParse {
  let raw: unknown;
  try {
    raw = JSON.parse(typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes));
  } catch {
    throw new StPresetError("That is not JSON. SillyTavern presets are JSON files.");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new StPresetError("That is not a SillyTavern preset object.");
  }
  const value = raw as Record<string, unknown>;
  const detected = detectPresetKind(value);

  const name =
    string(value["name"]) ?? filename.replace(/\.json$/i, "") ?? "Imported preset";

  const samplers: SamplerSettings = {};
  const unmappedSamplers: string[] = [];
  for (const [field, target] of Object.entries(SAMPLER_MAP)) {
    if (!(field in value)) continue;
    const parsed = number(value[field]);
    if (parsed === null) continue;
    if (target === "dry_sequence_breakers") {
      const list = Array.isArray(value[field])
        ? (value[field] as unknown[]).filter((item): item is string => typeof item === "string")
        : [];
      if (list.length > 0) samplers[target] = list;
      continue;
    }
    samplers[target] = parsed;
  }
  for (const field of KNOWN_UNMAPPED) {
    if (field in value) unmappedSamplers.push(field);
  }
  // Sampler fields we do not even know by name still deserve a report line.
  for (const field of Object.keys(value)) {
    if (
      field === "prompts" ||
      field === "name" ||
      field in SAMPLER_MAP ||
      KNOWN_UNMAPPED.has(field) ||
      field === "max_context" ||
      field === "max_length"
    ) {
      continue;
    }
    // Only report fields that look like samplers, not the preset's misc keys.
    if (typeof value[field] === "number" || typeof value[field] === "boolean") {
      unmappedSamplers.push(field);
    }
  }

  const contextSize = number(value["max_context"]);
  const maxResponseTokens = number(value["max_length"]);

  const blocks: StBlock[] = [];
  const markers: StMarker[] = [];
  const macroSet = new Set<string>();

  if (Array.isArray(value["prompts"])) {
    for (const entry of value["prompts"] as unknown[]) {
      if (typeof entry !== "object" || entry === null) continue;
      const block = entry as Record<string, unknown>;
      const identifier = string(block["identifier"]) ?? "";
      const content = string(block["content"]) ?? "";
      const role = block["role"] === "user" || block["role"] === "assistant" ? block["role"] : "system";
      const enabled = block["enabled"] !== false;
      const marker = block["marker"] === true || RESERVED_MARKERS.has(identifier.toLowerCase());

      if (content !== "") collectMacros(content, macroSet);

      if (marker || RESERVED_MARKERS.has(identifier.toLowerCase())) {
        markers.push({ identifier, enabled, content: content === "" ? null : content });
        continue;
      }

      const injectionPosition = number(block["injection_position"]) ?? 0;
      const injectionDepth = number(block["injection_depth"]) ?? 0;
      const order = number(block["injection_order"]) ?? blocks.length;
      blocks.push({
        identifier,
        name: string(block["name"]) ?? identifier,
        role,
        content,
        enabled,
        atDepth: injectionPosition === 1,
        depth: injectionDepth,
        order,
      });
    }
  }

  return {
    detected,
    name,
    samplers,
    unmappedSamplers,
    contextSize,
    maxResponseTokens,
    blocks,
    markers,
    unsupportedMacros: [...macroSet].sort(),
  };
}

export class StPresetError extends Error {}
