import type { SamplerSettings } from "../../shared/types.ts";

/**
 * Every named operation this codebase knows how to run (SPEC §7).
 *
 * "Task" is the table's name and the primitive's name; what it holds is §7's
 * per-op configuration row, and an *op* is anything with one. Two kinds share
 * the table because they share the row:
 *
 * - a **side call** runs off the main path on its own model and returns text —
 *   the turn classifier, impersonate, and every post-generation pass;
 * - a **turn instruction** is a block in the prompt of a user-facing generation
 *   — nudge, steer, expand, correct, continue.
 *
 * What an op *does* is code. What is stored is what a user gets to change about
 * it: whether it is on, which model it runs on, the words it uses, where those
 * words are injected, and whether its button is shown. An op whose behaviour
 * were entirely data would be the extension system §15 puts in a later tier.
 *
 * Ops are registered as they are built. There is no row for a feature that does
 * not exist, because a settings screen full of switches that do nothing is
 * worse than a short one.
 */

export type TaskStage = "pre_generation" | "sidecar" | "post_generation";

/** Where an op's text is injected. Which works best varies by model (§7). */
export type InjectionRole = "system" | "user" | "assistant";

export const INJECTION_ROLES: readonly InjectionRole[] = ["system", "user", "assistant"];

interface OpBase {
  key: string;
  /** Shown wherever an op is listed. */
  label: string;
  /** One line on what it is for, in the same voice as the rest of the UI. */
  description: string;
  stage: TaskStage;
  /**
   * The variables an override may use, beyond the ordinary macro set. Declared
   * rather than discovered so the editor can list them: a template language
   * whose variables are undocumented is a template language nobody can use.
   */
  variables: readonly string[];
  /** Whether hiding this op's button means anything. */
  hideable: boolean;
}

export interface SideCallOp extends OpBase {
  runs: "side_call";
  /**
   * What this op does to the message it read (SPEC §7.5). Absent for a side
   * call that is not a pass at all.
   *
   * `flag` looks and reports; `replace` rewrites the message and keeps the
   * original so the user can revert. §7.5 is deliberate that the user-lock
   * check flags rather than rewriting — a pass that quietly rewrites a turn is
   * a second author nobody hired.
   */
  effect?: "flag" | "replace";
  /** Order within the pipeline. Lower runs first. */
  passOrder?: number;
  /**
   * Whether this op runs unasked the first time its row is created. SPEC §8
   * names three guides that default on; everything else waits to be switched on.
   */
  autoByDefault?: boolean;
  /**
   * Samplers for this op. Deliberately not the scene's: a side call is a
   * decision or a summary, and §13's defaults exist to make prose less
   * predictable, which is the opposite of what is wanted here.
   */
  samplers: SamplerSettings;
  /** Milliseconds before the call is abandoned and the caller falls back. */
  timeoutMs: number;
  /** Characters of reply to read before stopping. A bound, not an expectation. */
  replyLimit: number;
}

export interface TurnOp extends OpBase {
  runs: "turn";
  /** Where this op's text lands by default. Overridable per §7. */
  injectionRole: InjectionRole;
}

export type OpKind = SideCallOp | TurnOp;
/** The primitive only runs side calls; the name is the table's, not the shape's. */
export type TaskKind = SideCallOp;

export const TURN_CLASSIFIER = "turn_classifier";
export const AUTOPILOT_CHECK = "autopilot_check";
export const SUGGEST_TAGS = "suggest_tags";
export const CREATE_CHARACTER = "create_character";
export const REVISE_CHARACTER = "revise_character";
export const EXTRACT_CHARACTER = "extract_character";
export const SUGGEST_VOICE = "suggest_voice_notes";
export const SUGGEST_LORE = "suggest_lore";
export const WRITE_DOSSIER = "write_dossier";
export const REVISE_LORE = "revise_lore";
export const TRACKER_SCENE = "tracker_scene";
export const TRACKER_CHARACTERS = "tracker_characters";
export const IMPERSONATE = "impersonate";
export const NUDGE = "nudge";
export const STEER = "steer";
export const EXPAND = "expand";
export const CORRECT = "correct";
export const CONTINUE = "continue";
export const VOICE_CHECK = "voice_check";
export const LOCK_CHECK = "lock_check";
export const PROSE_REFINE = "prose_refine";
export const SLOP_SCAN = "slop_scan";
export const ANALYSE_SLOP = "analyse_slop";
export const SUMMARISE = "summarise";
export const RESUMMARISE = "resummarise";

/** The post-generation pipeline, in the order §7.5 runs it. */
export const PASS_KEYS: readonly string[] = [VOICE_CHECK, LOCK_CHECK, SLOP_SCAN, PROSE_REFINE];

/**
 * The six persistent guides (SPEC §8), each its own op because each is
 * separately routable and separately auto-triggered — the spec is specific that
 * Thinking, Clothes and State default on and the rest do not.
 */
export const GUIDE_KINDS = [
  "situational",
  "thinking",
  "clothes",
  "state",
  "rules",
  "custom",
] as const;

export const TRACKER_KINDS = ["scene", "characters"] as const;

export type GuideKind = (typeof GUIDE_KINDS)[number];

export function guideOpKey(kind: GuideKind): string {
  return `guide_${kind}`;
}

export function guideKindOf(key: string): GuideKind | null {
  const kind = key.startsWith("guide_") ? key.slice("guide_".length) : null;
  return kind !== null && (GUIDE_KINDS as readonly string[]).includes(kind)
    ? (kind as GuideKind)
    : null;
}

/** SPEC §8: auto-trigger defaults on for Thinking, Clothes and State. */
const GUIDES_ON_BY_DEFAULT: readonly GuideKind[] = ["thinking", "clothes", "state"];

const GUIDE_LABELS: Record<GuideKind, { label: string; description: string }> = {
  situational: {
    label: "Situational",
    description: "Where the scene stands now, so the author can pick it up without rereading.",
  },
  thinking: {
    label: "Thinking",
    description: "What each character is privately thinking. Never spoken aloud.",
  },
  clothes: { label: "Clothes", description: "What each character is currently wearing." },
  state: {
    label: "Positions",
    description: "Where everyone is, what they are holding, and what condition they are in.",
  },
  rules: { label: "Rules", description: "The in-world rules the story has established." },
  custom: {
    label: "Custom",
    description: "Anything else you want kept and injected. You write the question.",
  },
};

const GUIDE_OPS: readonly SideCallOp[] = GUIDE_KINDS.map((kind) => ({
  key: guideOpKey(kind),
  runs: "side_call" as const,
  label: GUIDE_LABELS[kind].label,
  description: GUIDE_LABELS[kind].description,
  stage: "post_generation" as const,
  // A guide is a note the author keeps, not a verdict: warm enough to write
  // readable prose, cool enough not to invent.
  samplers: { temperature: 0.5, min_p: 0.05 },
  timeoutMs: 45_000,
  replyLimit: 3_000,
  variables: kind === "custom" ? ["input", "transcript", "previous"] : ["transcript", "previous"],
  hideable: false,
  autoByDefault: GUIDES_ON_BY_DEFAULT.includes(kind),
}));

/** Structured trackers (SPEC §8, phase 31): JSON state, strictly parsed. */
const TRACKER_LABELS = {
  scene: {
    label: "Scene tracker",
    description: "Where the scene is, the time of day, and who is present — as strict fields, not prose.",
  },
  characters: {
    label: "Character tracker",
    description: "Per-member mood, position, notable state and private knowledge, as strict fields.",
  },
} as const;

export function trackerOpKey(kind: (typeof TRACKER_KINDS)[number]): string {
  return `tracker_${kind}`;
}

const TRACKER_OPS: readonly SideCallOp[] = TRACKER_KINDS.map((kind) => ({
  key: trackerOpKey(kind),
  runs: "side_call" as const,
  label: TRACKER_LABELS[kind].label,
  description: TRACKER_LABELS[kind].description,
  stage: "post_generation" as const,
  // JSON out wants it cool: a tracker is a record, not a reading.
  samplers: { temperature: 0.3, top_p: 0.9 },
  timeoutMs: 30_000,
  replyLimit: 2_000,
  variables: ["transcript", "previous"],
  hideable: false,
  autoByDefault: true,
}));

/** §11 layer 3's extractor. Off by default: the whole feature is opt-in. */
export const MEMORY_EXTRACT = "memory_extract";

/** §11's author memory: the author writing something down to carry forward. */
export const AUTHOR_REMEMBER = "author_remember";

/** §20 phase 41: what a picture the reader attached actually shows. */
export const CAPTION_IMAGE = "caption_image";

export const OP_KINDS: readonly OpKind[] = [
  {
    key: TURN_CLASSIFIER,
    runs: "side_call",
    label: "Turn director",
    description: "Reads the last few turns and says who speaks next, in its own words.",
    stage: "pre_generation",
    samplers: { temperature: 0.2, top_p: 0.9 },
    timeoutMs: 12_000,
    // Two or three short lines. A reply past this is a model that has started
    // talking, and the answer is on the first line anyway.
    replyLimit: 600,
    variables: ["cast", "transcript", "reader"],
    hideable: false,
  },
  {
    key: AUTOPILOT_CHECK,
    runs: "side_call",
    label: "Addressed check",
    description:
      "Reads a turn autopilot just wrote and says whether anyone in it turned to face you. That is the moment autopilot hands the scene back.",
    stage: "post_generation",
    samplers: { temperature: 0.2, top_p: 0.9 },
    timeoutMs: 12_000,
    replyLimit: 300,
    variables: ["persona", "speaker", "text"],
    hideable: false,
  },
  {
    key: SUGGEST_TAGS,
    runs: "side_call",
    label: "Propose tags",
    description:
      "Reads a character card and proposes tags from the library's own vocabulary. The user accepts or rejects them one at a time.",
    stage: "sidecar",
    samplers: { temperature: 0.3, top_p: 0.9 },
    timeoutMs: 20_000,
    replyLimit: 400,
    variables: ["card", "vocabulary"],
    hideable: false,
  },
  {
    key: CREATE_CHARACTER,
    runs: "side_call",
    label: "Write a character",
    description:
      "A full character card from a short description, optionally reading the current scene. The result is a card, not a paragraph.",
    stage: "sidecar",
    samplers: { temperature: 0.4, top_p: 0.9 },
    timeoutMs: 60_000,
    replyLimit: 8_000,
    variables: ["description", "transcript"],
    hideable: false,
  },
  {
    key: REVISE_CHARACTER,
    runs: "side_call",
    label: "Revise a character",
    description:
      "Targeted edits to the fields you name, leaving every other field exactly as it was.",
    stage: "sidecar",
    samplers: { temperature: 0.4, top_p: 0.9 },
    timeoutMs: 60_000,
    replyLimit: 8_000,
    variables: ["card", "instructions"],
    hideable: false,
  },
  {
    key: EXTRACT_CHARACTER,
    runs: "side_call",
    label: "Extract a character",
    description:
      "Builds a card from how a character has actually behaved in a scene — the one that needs the history.",
    stage: "sidecar",
    samplers: { temperature: 0.4, top_p: 0.9 },
    timeoutMs: 60_000,
    replyLimit: 8_000,
    variables: ["transcript", "name"],
    hideable: false,
  },
  {
    key: SUGGEST_VOICE,
    runs: "side_call",
    label: "Suggest voice notes",
    description:
      "Speech tics and rhythm, derived from the card or from the character's own dialogue.",
    stage: "sidecar",
    samplers: { temperature: 0.7, top_p: 0.9 },
    timeoutMs: 30_000,
    replyLimit: 1_500,
    variables: ["card", "dialogue"],
    hideable: false,
  },
  {
    key: SUGGEST_LORE,
    runs: "side_call",
    label: "Propose lore",
    description:
      "Durable world facts from the scene so far, as entries the reader accepts one at a time.",
    stage: "sidecar",
    samplers: { temperature: 0.4, top_p: 0.9 },
    timeoutMs: 60_000,
    replyLimit: 8_000,
    variables: ["transcript"],
    hideable: false,
  },
  {
    key: WRITE_DOSSIER,
    runs: "side_call",
    label: "Write a dossier",
    description:
      "A reference sheet for a character who turned up in play, from what the scene establishes.",
    stage: "sidecar",
    // Low, like the other authoring tasks: a dossier records what the scene
    // established, and a creative one invents a character who was never there.
    samplers: { temperature: 0.3, top_p: 0.9 },
    timeoutMs: 60_000,
    replyLimit: 4_000,
    variables: ["name", "transcript"],
    hideable: false,
  },
  {
    key: REVISE_LORE,
    runs: "side_call",
    label: "Revise lore",
    description:
      "Updates one entry against what has happened since it was written.",
    stage: "sidecar",
    samplers: { temperature: 0.4, top_p: 0.9 },
    timeoutMs: 60_000,
    replyLimit: 8_000,
    variables: ["entry", "transcript"],
    hideable: false,
  },
  {
    key: IMPERSONATE,
    runs: "side_call",
    label: "As me",
    description: "Turns a line of shorthand into a full message in your character's voice.",
    stage: "sidecar",
    samplers: { temperature: 0.9, min_p: 0.05 },
    // The user is watching this one, so it is given room — but not the whole
    // turn's worth, because a draft that overruns the composer is not a draft.
    timeoutMs: 60_000,
    replyLimit: 2_400,
    variables: ["input", "persona", "transcript"],
    hideable: true,
  },
  {
    key: NUDGE,
    runs: "turn",
    label: "Nudge",
    description: "One instruction for the next turn only. Never becomes a message.",
    stage: "pre_generation",
    injectionRole: "system",
    variables: ["input"],
    hideable: true,
  },
  {
    key: STEER,
    runs: "turn",
    label: "Steer",
    description: "A note applied to every turn until you clear it.",
    stage: "pre_generation",
    injectionRole: "system",
    variables: ["input"],
    hideable: true,
  },
  {
    key: EXPAND,
    runs: "turn",
    label: "Write it longer",
    description: "Asks for the same turn again with more happening in it.",
    stage: "pre_generation",
    injectionRole: "system",
    variables: ["original"],
    hideable: true,
  },
  {
    key: CORRECT,
    runs: "turn",
    label: "Rewrite this",
    description: "Changes what you name and keeps everything that was working.",
    stage: "pre_generation",
    injectionRole: "system",
    variables: ["original", "input"],
    hideable: true,
  },
  {
    key: CONTINUE,
    runs: "turn",
    label: "Continue",
    description: "Carries on from where a turn stopped, mid-flow.",
    stage: "pre_generation",
    injectionRole: "system",
    variables: ["original"],
    hideable: true,
  },
  {
    key: VOICE_CHECK,
    runs: "side_call",
    label: "Voice check",
    description:
      "Reads each character's part and says whether it still sounds like them. The direct answer to one author voicing everybody.",
    stage: "post_generation",
    effect: "flag",
    passOrder: 0,
    samplers: { temperature: 0.2, top_p: 0.9 },
    timeoutMs: 20_000,
    replyLimit: 500,
    variables: ["character", "text"],
    hideable: false,
  },
  {
    key: LOCK_CHECK,
    runs: "side_call",
    label: "User-lock check",
    description: "Notices the author writing your character, and says so rather than rewriting it.",
    stage: "post_generation",
    effect: "flag",
    passOrder: 1,
    samplers: { temperature: 0.2, top_p: 0.9 },
    timeoutMs: 20_000,
    replyLimit: 500,
    variables: ["persona", "text"],
    hideable: false,
  },
  {
    key: SLOP_SCAN,
    runs: "side_call",
    label: "Slop scan",
    description:
      "Checks a finished turn against the ban list and flags what it finds. Costs nothing: matching text is not a job for a model.",
    stage: "post_generation",
    effect: "flag",
    passOrder: 1.5,
    // Declared for the shape's sake. This pass never makes a call — the whole
    // point of storing the ban list as data (§13.6) is that matching against it
    // is exact, free and instant, where asking a model would be none of those.
    samplers: {},
    timeoutMs: 1_000,
    replyLimit: 1,
    variables: [],
    hideable: false,
    autoByDefault: true,
  },
  {
    key: ANALYSE_SLOP,
    runs: "side_call",
    label: "Propose bans",
    description:
      "Counts the phrases this scene keeps reaching for and asks a model which of them are tics rather than the story. Proposals wait for you to accept them.",
    stage: "post_generation",
    // A judgement, not writing: cool, and it only has to pick from a list.
    samplers: { temperature: 0.2, top_p: 0.9 },
    timeoutMs: 30_000,
    replyLimit: 1_500,
    variables: ["candidates"],
    hideable: false,
  },
  {
    key: PROSE_REFINE,
    runs: "side_call",
    label: "Prose refinement",
    description:
      "Rewrites the turn with better vocabulary and rhythm, keeping every event. Costs a second full generation, so it is off unless you turn it on.",
    stage: "post_generation",
    effect: "replace",
    passOrder: 2,
    // Prose, not a verdict: this one is writing, so it gets the warmth §13's
    // defaults exist for.
    samplers: { temperature: 0.9, min_p: 0.05 },
    timeoutMs: 90_000,
    replyLimit: 8_000,
    variables: ["text", "speaker"],
    hideable: false,
  },
  ...GUIDE_OPS,
  ...TRACKER_OPS,
  {
    key: SUMMARISE,
    runs: "side_call",
    label: "Summarise history",
    description:
      "Condenses a run of old messages into a paragraph the prompt carries instead of the messages. A cheap model is fine here.",
    stage: "post_generation",
    // §11 wants a record, not a reading: warm enough to write a paragraph, cool
    // enough that it does not start adding things nobody wrote.
    samplers: { temperature: 0.4, top_p: 0.9 },
    timeoutMs: 60_000,
    replyLimit: 4_000,
    variables: ["transcript", "previous"],
    hideable: false,
    // On, and auto: §11 calls this the highest-leverage memory feature, and a
    // scene that silently stops remembering is the failure it exists to fix.
    autoByDefault: true,
  },
  {
    key: RESUMMARISE,
    runs: "side_call",
    label: "Condense summaries",
    description:
      "Folds the oldest summaries into one when they themselves grow past their budget, so a long scene's history block stops growing.",
    stage: "post_generation",
    samplers: { temperature: 0.4, top_p: 0.9 },
    timeoutMs: 60_000,
    replyLimit: 4_000,
    variables: ["transcript"],
    hideable: false,
    autoByDefault: true,
  },
  {
    key: AUTHOR_REMEMBER,
    runs: "side_call",
    label: "Remember this",
    description:
      "The author writes a note to carry into its other roleplays: an unresolved thread, a recurring name, what you seem to enjoy.",
    stage: "post_generation",
    // Warmer than the extractor. This one writes a sentence the reader will
    // read, not a record — and §11 wants it in the author's own voice.
    samplers: { temperature: 0.6, top_p: 0.95 },
    timeoutMs: 30_000,
    replyLimit: 1_500,
    variables: ["transcript", "author", "known"],
    hideable: false,
    // §11: "Keep it strictly opt-in. An author that silently accumulates notes
    // about the user is a different product with different expectations." So
    // this never runs unasked, whatever the op config says.
    autoByDefault: false,
  },
  {
    key: MEMORY_EXTRACT,
    runs: "side_call",
    label: "Narrative memory",
    description:
      "Reads the last few turns for people, places, things and facts worth remembering, and how they relate.",
    stage: "post_generation",
    // §11: "a small model at low temperature". An extractor that invents is
    // worse than one that misses, because what it invents is then carried on
    // every prompt until somebody notices.
    samplers: { temperature: 0.2, top_p: 0.9 },
    timeoutMs: 45_000,
    replyLimit: 4_000,
    variables: ["transcript", "known"],
    hideable: false,
    // Auto-triggered where the scene has switched memory on, which is the
    // switch that actually decides it. This flag only says it may run unasked.
    autoByDefault: true,
  },
  {
    key: CAPTION_IMAGE,
    runs: "side_call",
    label: "Describe a picture",
    description:
      "Looks at an image you attached and writes what is in it, so the author can react to something it cannot see.",
    stage: "pre_generation",
    // Low, and for the extractor's reason: an invented detail here becomes a
    // fact of the scene the moment the author writes around it.
    samplers: { temperature: 0.2, top_p: 0.9 },
    timeoutMs: 45_000,
    replyLimit: 1_500,
    variables: [],
    hideable: false,
    // Runs when a picture is attached, which is the reader asking for it. There
    // is no unattended path that could fire this.
    autoByDefault: false,
  },
];

export function opKind(key: string): OpKind | null {
  return OP_KINDS.find((kind) => kind.key === key) ?? null;
}

/** A side call, or null when the key names a turn instruction instead. */
export function taskKind(key: string): SideCallOp | null {
  const kind = opKind(key);
  return kind !== null && kind.runs === "side_call" ? kind : null;
}
