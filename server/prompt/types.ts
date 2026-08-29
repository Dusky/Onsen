/**
 * The prompt builder's contract (SPEC §3).
 *
 * This module is pure: no I/O, no database, no HTTP, no clock, no randomness.
 * Everything variable is passed in — the tokenizer, the current time, the seed
 * — because that is what makes the most important module in the codebase
 * trivially testable. Nothing under server/prompt may import from server/db or
 * server/routes; there is a test that enforces it.
 *
 * The entity shapes here are the builder's *input contract*, deliberately
 * narrower than the database rows they will eventually be built from. The
 * builder reads what it needs and nothing else, so a schema change that does not
 * touch these fields cannot break prompt assembly.
 */

import type { MessageAuthorType, MessageKind } from "../../shared/types.ts";

export type PromptRole = "system" | "user" | "assistant";

export interface NormalizedMessage {
  role: PromptRole;
  content: string;
  /** Speaker label, where the provider supports one. */
  name?: string;
}

/* ------------------------------------------------------------------ */
/* Provider capabilities (SPEC §4)                                     */
/* ------------------------------------------------------------------ */

export type SamplerName =
  | "temperature"
  | "min_p"
  | "top_p"
  | "top_k"
  | "repetition_penalty"
  | "dry"
  | "xtc";

export type TokenizerId = string;

export interface ProviderCapabilities {
  separateSystemRole: boolean;
  supportsPrefill: boolean;
  requiresStrictAlternation: boolean;
  mode: "chat" | "text";
  needsInstructTemplate: boolean;
  supportedSamplers: SamplerName[];
  samplerOrder: SamplerName[] | null;
  maxContext: number;
  supportsLogitBias: boolean;
  supportsStopSequences: boolean;
  supportsGrammar: boolean;
  emitsReasoning: boolean;
  supportsPromptCaching: boolean;
  tokenizer: TokenizerId | null;
}

/* ------------------------------------------------------------------ */
/* Tokenizer                                                           */
/* ------------------------------------------------------------------ */

/**
 * Passed in rather than imported, so that the builder stays pure and a provider
 * family can supply its real tokenizer. `isEstimate` propagates all the way to
 * the inspector: SPEC §3 requires estimated counts to be labelled as estimates,
 * because a user who trusts an estimate and overflows the context has no way to
 * find out why.
 */
export interface Tokenizer {
  id: TokenizerId;
  isEstimate: boolean;
  count(text: string): number;
}

/* ------------------------------------------------------------------ */
/* Entities the builder reads                                          */
/* ------------------------------------------------------------------ */

/** The AI's own identity — the writing partner who puppets the cast (§2). */
export interface PromptAuthor {
  name: string;
  personality: string | null;
  writingStyle: string | null;
  directingStyle: string | null;
  oocVoice: string | null;
  boundaries: string | null;
}

/** Who the user is (§2). */
export interface PromptPersona {
  name: string;
  description: string | null;
}

/** A role the author voices (§2). */
export interface PromptCharacter {
  id: string;
  name: string;
  description: string | null;
  personality: string | null;
  scenario: string | null;
  exampleDialogue: string | null;
  /** Speech tics, vocabulary, rhythm. Injected only when spotlighted (§3). */
  voiceNotes: string | null;
  /** Injected at a fixed depth whenever this character is present (§2). */
  depthPrompt: string | null;
  depthPromptDepth: number;
  depthPromptRole: PromptRole;
  systemPrompt: string | null;
  postHistoryInstructions: string | null;
}

export interface PromptScene {
  title: string;
  /** Overrides the spotlighted character's scenario when set (§2). */
  scenarioOverride: string | null;
}

export interface PromptMessage {
  id: string;
  kind: MessageKind;
  authorType: MessageAuthorType;
  content: string;
  /** Excluded from the prompt entirely, though still shown in the log (§2). */
  isHidden: boolean;
  /** Null for user, system and narrator turns. */
  characterId: string | null;
  /** Cached count; recomputed when absent. */
  tokenCount: number | null;
}

/** Where a lore entry lands (§10). */
export type LoreInsertionPosition =
  | "before_character"
  | "after_character"
  | "before_examples"
  | "after_examples"
  | "before_history"
  | "at_depth"
  | "outlet";

export interface PromptLoreEntry {
  id: string;
  content: string;
  isConstant: boolean;
  position: LoreInsertionPosition;
  /** Order within a position; lower goes first. */
  insertionOrder: number;
  insertionDepth: number;
  insertionRole: PromptRole;
  /** When set, the entry is addressable as {{outlet::Name}} instead (§3). */
  outletName: string | null;
}

export interface PromptDocumentChunk {
  id: string;
  documentName: string;
  content: string;
  /** Similarity score, surfaced in the inspector (§11). */
  score: number | null;
}

export interface PromptSummary {
  id: string;
  content: string;
  coversFromMessageId: string | null;
  coversToMessageId: string | null;
}

export interface PromptMemoryEntity {
  id: string;
  name: string;
  content: string;
  salience: number;
}

export interface PromptTracker {
  name: string;
  /** Already rendered by the tracker subsystem; the builder does not format. */
  content: string;
}

export interface PromptGuide {
  name: string;
  content: string;
}

export interface PromptPreset {
  name: string;
  systemPrompt: string | null;
  jailbreak: string | null;
  prefill: string | null;
  postHistoryInstructions: string | null;
  maxResponseTokens: number;
  /** Overrides the default assembly order when set (§3). */
  blockOrder: PromptBlockId[] | null;
}

/* ------------------------------------------------------------------ */
/* The context                                                         */
/* ------------------------------------------------------------------ */

export interface PromptContext {
  scene: PromptScene;
  cast: PromptCharacter[];
  /** Whose turn this is. Beats — several characters in one turn — are §3.5. */
  spotlight: PromptCharacter;
  /** Null selects single-character mode (§3). */
  author: PromptAuthor | null;
  persona: PromptPersona;
  /** The active path, root to leaf. */
  history: PromptMessage[];
  /** Already matched and resolved by the activation model (§10). */
  lore: PromptLoreEntry[];
  /** Already retrieved (§11). */
  documents: PromptDocumentChunk[];
  summaries: PromptSummary[];
  memory: PromptMemoryEntity[];
  trackers: PromptTracker[];
  guides: PromptGuide[];
  preset: PromptPreset;
  /** Persistent steer on the scene (§7). */
  directorNote?: string;
  /** One-shot instruction for this generation only (§7). */
  nudge?: string;
  /** True when an out-of-character check-in is due this turn (§16). */
  oocDue?: boolean;
  capabilities: ProviderCapabilities;
  /** Total context window in tokens. */
  budget: number;

  /* Injected so the module stays pure. */
  tokenizer: Tokenizer;
  /** Epoch milliseconds, for {{time}} and {{date}}. */
  now: number;
  /** Seeds {{random}}, {{pick}} and {{roll}}. Same seed, same prompt. */
  seed: number;
  /** Milliseconds since the last user message, for {{idle_duration}}. */
  idleDuration?: number;
}

/* ------------------------------------------------------------------ */
/* Blocks                                                              */
/* ------------------------------------------------------------------ */

/**
 * The assembly order of SPEC §3. These identifiers are the vocabulary a preset
 * reorders and the inspector labels, so they are stable names rather than
 * positions.
 */
export type PromptBlockId =
  | "system_prompt"
  | "author_identity"
  | "spotlight_character"
  | "cast"
  | "persona"
  | "scenario"
  | "constant_lore"
  | "example_dialogue"
  | "summaries"
  | "history"
  | "documents"
  | "memory"
  | "matched_lore"
  | "guides"
  | "trackers"
  | "depth_prompts"
  | "director_note"
  | "post_history"
  | "nudge"
  | "ooc_invitation"
  | "spotlight_instruction"
  | "jailbreak"
  | "prefill"
  /**
   * Not part of the assembly order. Inserted by the renderer when a provider
   * requires strict alternation and the timeline would otherwise open on an
   * assistant turn. It is a real block so that invented text always shows up in
   * the inspector rather than appearing in the prompt unannounced.
   */
  | "alternation_filler";

/** SPEC §3's default order, top of context to nearest the model's response. */
export const DEFAULT_BLOCK_ORDER: readonly PromptBlockId[] = [
  "system_prompt",
  "author_identity",
  "spotlight_character",
  "cast",
  "persona",
  "scenario",
  "constant_lore",
  "example_dialogue",
  "summaries",
  "history",
  "documents",
  "memory",
  "matched_lore",
  "guides",
  "trackers",
  "depth_prompts",
  "director_note",
  "post_history",
  "nudge",
  "ooc_invitation",
  "spotlight_instruction",
  "jailbreak",
  "prefill",
];

export type BlockPlacement =
  /** In the prefix, in assembly order. */
  | { kind: "prefix" }
  /** N messages from the end of history; 0 is immediately before the response. */
  | { kind: "depth"; depth: number }
  /** Wherever {{outlet::Name}} appears (§3). */
  | { kind: "outlet"; name: string };

export interface PromptBlock {
  id: PromptBlockId;
  /** Human label for the inspector. */
  label: string;
  /** Where the content came from, for the inspector's provenance line. */
  source: string;
  role: PromptRole;
  content: string;
  placement: BlockPlacement;
  tokens: number;
}

/* ------------------------------------------------------------------ */
/* Debug output                                                        */
/* ------------------------------------------------------------------ */

export type EvictionReason =
  /** Trimmed oldest-first to make history fit the remaining budget. */
  | "history_budget"
  /** Excluded by the user, not by the budget. */
  | "hidden";

export interface EvictedItem {
  blockId: PromptBlockId;
  /** Message identifier where the evicted item was a message. */
  itemId: string | null;
  label: string;
  tokens: number;
  reason: EvictionReason;
}

/**
 * SPEC §3: not optional, and it must record what was *trimmed*, not only what
 * was included. "The character forgot" is almost always "the model never saw
 * it", and the inspector is the only way a user can discover that.
 */
export interface PromptDebugInfo {
  mode: "author" | "single_character";
  /** True when counts came from an estimator rather than a real tokenizer. */
  tokensAreEstimated: boolean;
  tokenizerId: TokenizerId;

  budget: number;
  /** Held back for the response. */
  reservedForResponse: number;
  /** budget - reservedForResponse. */
  available: number;
  /** Everything except history. */
  fixedTokens: number;
  historyTokens: number;
  totalTokens: number;
  /** available - totalTokens. Never negative in a successful build. */
  headroom: number;

  blocks: PromptBlock[];
  evicted: EvictedItem[];
  /** Messages the prompt carried, oldest first. */
  historyIncluded: string[];
  /** Outlets the preset declared but nothing filled. */
  unresolvedOutlets: string[];
  /** Macros encountered that the engine does not implement (§18). */
  unknownMacros: string[];
}

export interface BuiltPrompt {
  system?: string;
  messages: NormalizedMessage[];
  prefill?: string;
  /** Text-completion mode only. */
  rawText?: string;
  outlets: Record<string, string>;
  debug: PromptDebugInfo;
}

/**
 * Thrown when the blocks that cannot be trimmed do not fit. SPEC §3 says to
 * fail loudly rather than silently producing a prompt the provider will reject.
 */
export class PromptBudgetError extends Error {
  readonly required: number;
  readonly available: number;

  constructor(required: number, available: number) {
    super(
      `The prompt cannot fit: its fixed blocks need ${required} tokens but only ${available} are available. ` +
        `Raise the context size, lower the reserved response tokens, or shorten the character and lore definitions.`,
    );
    this.name = "PromptBudgetError";
    this.required = required;
    this.available = available;
  }
}
