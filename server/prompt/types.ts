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

import type {
  ActivationTrace,
  BlockPlacement,
  EvictedItem,
  EvictionReason,
  MessageAuthorType,
  MessageKind,
  PromptBlock,
  PromptDebugInfo,
  SkipReason,
} from "../../shared/types.ts";
import type { InstructTemplate } from "./instruct.ts";

// The inspector's shapes are the client/server contract, so they live in
// /shared and are re-exported here, where the builder and its tests import
// them from (SPEC §16, phase 25).
export type {
  ActivationTrace,
  BlockPlacement,
  EvictedItem,
  EvictionReason,
  PromptBlock,
  PromptDebugInfo,
  SkipReason,
};

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

/**
 * Who the user is (§2).
 *
 * `name` is null when the user has not said who they are. That is a real state,
 * not a missing value, and it has to be modelled rather than papered over with
 * a placeholder: the user-lock is phrased in terms of this name, and a stand-in
 * like "You" turns the most important sentence in the system prompt into "You
 * belongs to the reader".
 */
export interface PromptPersona {
  name: string | null;
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
  /**
   * The last message that had already happened when this character joined
   * (SPEC §6). Null means they were present from the start. Characters should
   * not react to events they were not there for; in author mode the author sees
   * everything, so the spotlight instruction carries the constraint rather than
   * history being trimmed.
   */
  joinedAfterMessageId?: string | null;
}

/**
 * How long a beat runs (SPEC §3.5).
 *
 * A beat with no bound is the one that stalls: the characters re-affirm each
 * other until the response limit cuts them off. The bound is therefore part of
 * the request, not a setting somewhere.
 */
export type BeatBound =
  | { kind: "exchanges"; count: number }
  | { kind: "until"; condition: string }
  | { kind: "open" };

/**
 * What this generation is being asked for (SPEC §3.5, §7).
 *
 * Absent means a spotlight — one character, the ordinary turn. The three shapes
 * share the same near-turn instruction slot rather than each adding a block to
 * the assembly order, because they are the same thing: the last word before the
 * model writes.
 */
export type PromptTurn =
  | { kind: "spotlight" }
  /** Several characters in one generation. `spotlight` is the one who opens. */
  | { kind: "beat"; participants: PromptCharacter[]; bound: BeatBound }
  /**
   * Rewriting one character's part of a beat that already exists, holding the
   * rest of it fixed. `spotlight` is the character being recast, and
   * `beatText` is the beat exactly as it stands.
   */
  | { kind: "recast"; beatText: string }
  /**
   * Producing a better version of a turn that already exists (SPEC §7).
   *
   * The three modes differ only in what is asked for, but they differ a lot in
   * that: expanding a turn, correcting one, and continuing from where one
   * stopped are three different instructions and reading them as one would
   * blur all three.
   */
  | {
      kind: "revise";
      mode: "expand" | "correct" | "continue";
      /** The turn as it stands. */
      original: string;
      /** What the user asked for. Only `correct` has any. */
      instructions?: string;
    }
  /**
   * Answering the reader out of character (SPEC §7).
   *
   * Not a turn in the scene at all: the author is being asked a question as
   * itself, and the scene must not move. It is a `PromptTurn` rather than a
   * separate entry point because everything else about the prompt is the same
   * — the same cast, the same lore, the same history — and only the near-turn
   * instruction differs.
   */
  | { kind: "ooc"; question: string };

/** What a user may change about one op's contribution to a prompt (SPEC §7). */
export interface PromptOpConfig {
  /**
   * The words, with this op's own variables already filled. Absent means the
   * built-in. It is a resolved string rather than a template because filling
   * `{{original}}` needs the message being revised, which is the caller's.
   */
  text?: string;
  /** Where the text lands. Which works best varies by model. */
  role?: PromptRole;
  /** Off entirely — the block is omitted rather than emitted empty. */
  enabled?: boolean;
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
  /**
   * The model's own reasoning for this turn (SPEC §13). Present on the message
   * but kept out of the prompt unless `PromptContext.reasoning` asks for it —
   * most providers advise against feeding it back.
   */
  reasoning?: string | null;
  /**
   * Covered by a summary the prompt is carrying (§11). Only meaningful when the
   * scene has asked for raw eviction; otherwise the message is shown as well as
   * described, which is the safe default and the expensive one.
   */
  isSummarized?: boolean;
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

/** One selected option, compiled (SPEC §13.5). */
export interface PromptOption {
  /** The group it came from, so the inspector can say what kind of rule it is. */
  groupName: string;
  name: string;
  fragment: string;
  placement: BlockPlacement;
  role: PromptRole;
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
  /**
   * Whose turn this is: the character in a spotlight, the one who opens a beat,
   * or the one being recast.
   */
  spotlight: PromptCharacter;
  /** What is being asked for. Absent means an ordinary spotlight turn (§3.5). */
  turn?: PromptTurn;
  /** Null selects single-character mode (§3). */
  author: PromptAuthor | null;
  persona: PromptPersona;
  /** The active path, root to leaf. */
  history: PromptMessage[];
  /** Already matched and resolved by the activation model (§10). */
  lore: PromptLoreEntry[];
  /**
   * The full activation trace, fired and skipped both (§10), handed straight
   * through to the debug output. The builder never reads it — it copies it —
   * because the trace is for the inspector, and the inspector reads the built
   * prompt's debug, so that is where it has to arrive (phase 25). Optional on
   * the context because a side call's context has no lore at all.
   */
  loreTrace?: ActivationTrace[];
  /** Already retrieved (§11). */
  documents: PromptDocumentChunk[];
  summaries: PromptSummary[];
  memory: PromptMemoryEntity[];
  trackers: PromptTracker[];
  guides: PromptGuide[];
  /** Selected prompt options, already resolved by cardinality (§13.5). */
  options?: PromptOption[];
  /** Banned constructions in force for this scene (§13.6). */
  bans?: string[];
  preset: PromptPreset;
  /**
   * Drop the raw messages an injected summary covers (§11 raw eviction). The
   * last user message is kept regardless: the turn has to answer something.
   */
  evictSummarized?: boolean;
  /**
   * Feeding reasoning back into context (SPEC §13), which is opt-in because
   * most providers advise against it. Zero blocks is off and is the default.
   */
  reasoning?: { reinjectLast: number; prefix: string; suffix: string };
  /** Persistent steer on the scene (§7). */
  directorNote?: string;
  /** One-shot instruction for this generation only (§7). */
  nudge?: string;
  /**
   * Per-op configuration the builder honours, keyed by op (SPEC §7).
   *
   * Passed in rather than read, like everything else here — a template is
   * stored configuration, and a builder that went and fetched it would stop
   * being a pure function of its input.
   */
  ops?: Partial<Record<string, PromptOpConfig>>;
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
  /**
   * The instruct template, in text-completion mode (SPEC §4).
   *
   * Passed in rather than looked up, because the builder is pure and because a
   * user-authored template is a database row. Absent in chat mode, and absent
   * in text mode means the plain labelled transcript.
   */
  instruct?: InstructTemplate;
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
  /** A selected prompt option, one block each so the inspector names it (§13.5). */
  | "prompt_option"
  /** The banned constructions in force (§13.6). */
  | "ban_list"
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
  // Instructions about *how* to write sit near the turn with the other
  // instructions, not up in the system prompt where a long history separates
  // them from the writing they govern.
  "prompt_option",
  "ban_list",
  "director_note",
  "post_history",
  "nudge",
  "ooc_invitation",
  "spotlight_instruction",
  "jailbreak",
  "prefill",
];

// BlockPlacement and PromptBlock are defined in /shared (the inspector's
// contract) and re-exported above. Note their `id` is `PromptBlockId` here in
// the builder's vocabulary — the shared type widens it to `string` so the
// client does not import the builder's full union.

/* ------------------------------------------------------------------ */
/* Debug output                                                        */
/* ------------------------------------------------------------------ */

// The debug shapes (BlockPlacement, PromptBlock, EvictedItem,
// EvictionReason, ActivationTrace, PromptDebugInfo) are the inspector's
// contract, so they live in /shared and are re-exported at the top of this
// file (SPEC §16, phase 25).

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
