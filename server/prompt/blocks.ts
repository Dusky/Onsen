import { defaultTemplateOf, fillTemplate } from "./op-templates.ts";
import type {
  BeatBound,
  BlockPlacement,
  PromptBlockId,
  PromptCharacter,
  PromptContext,
  PromptLoreEntry,
  PromptRole,
  PromptTurn,
} from "./types.ts";

/**
 * Turning a context into the blocks of SPEC §3's assembly order.
 *
 * A block is a named, costed, inspectable piece of the prompt. Everything the
 * inspector shows — what went in, where it landed, what it cost — comes from
 * this list, so a block that carries no content is omitted entirely rather than
 * emitted empty.
 */

export interface DraftBlock {
  id: PromptBlockId;
  label: string;
  source: string;
  role: PromptRole;
  content: string;
  placement: BlockPlacement;
}

/** Join the parts of a block, dropping the ones with nothing in them. */
function paragraphs(...parts: (string | null | undefined)[]): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => part !== undefined && part !== "")
    .join("\n\n");
}

function labelled(label: string, value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? null : `${label}: ${trimmed}`;
}

/* ------------------------------------------------------------------ */
/* Character rendering                                                 */
/* ------------------------------------------------------------------ */

/**
 * The spotlighted character, in full. Voice notes are included here and only
 * here: SPEC §3 injects them for the spotlighted character alone, because one
 * author voicing everyone is the architecture's main risk of homogenised voices.
 */
function fullCharacter(character: PromptCharacter): string {
  return paragraphs(
    `## ${character.name}`,
    character.description,
    labelled("Personality", character.personality),
    labelled("Voice", character.voiceNotes),
  );
}

/** Everyone else, compactly: fewer fields, not truncated text. */
function compactCharacter(character: PromptCharacter): string {
  return paragraphs(`### ${character.name}`, character.description);
}

/* ------------------------------------------------------------------ */
/* Lore placement (§10)                                                */
/* ------------------------------------------------------------------ */

export interface SortedLore {
  /** Entries that land in the prefix, in insertion order. */
  prefix: PromptLoreEntry[];
  /** Entries injected N turns from the end. */
  atDepth: PromptLoreEntry[];
  /** Entries addressable as an outlet rather than positioned. */
  outlets: PromptLoreEntry[];
}

export function sortLore(entries: PromptLoreEntry[]): SortedLore {
  const sorted: SortedLore = { prefix: [], atDepth: [], outlets: [] };
  for (const entry of entries) {
    if (entry.outletName !== null || entry.position === "outlet") sorted.outlets.push(entry);
    else if (entry.position === "at_depth") sorted.atDepth.push(entry);
    else sorted.prefix.push(entry);
  }
  const byOrder = (a: PromptLoreEntry, b: PromptLoreEntry) => a.insertionOrder - b.insertionOrder;
  sorted.prefix.sort(byOrder);
  sorted.atDepth.sort(byOrder);
  return sorted;
}

/* ------------------------------------------------------------------ */
/* Block bodies                                                        */
/* ------------------------------------------------------------------ */

/**
 * The author's identity, and the rule that matters most.
 *
 * SPEC §0.5 makes the user-lock a hard constraint asserted in the system prompt
 * and re-asserted near the turn, because models drift toward writing the user's
 * character constantly and the failure is immediately immersion-breaking. This
 * block is the first assertion; the spotlight instruction is the second.
 */
function authorIdentity(ctx: PromptContext): string | null {
  const author = ctx.author;
  if (author === null) return null;
  // Phrased around the persona's name where there is one, and around the reader
  // where there is not — never around a placeholder standing in for a name.
  const lock =
    ctx.persona.name === null
      ? `The reader's own character is theirs alone: never write their dialogue, their actions, ` +
        `or their thoughts, and never decide what they do next.`
      : `${ctx.persona.name} belongs to the reader: never write their dialogue, their actions, ` +
        `or their thoughts, and never decide what they do next.`;
  return paragraphs(
    `You are ${author.name}, the author of this story. You write every character in the cast. ${lock}`,
    author.personality,
    labelled("How you write", author.writingStyle),
    labelled("How you direct a scene", author.directingStyle),
    labelled("How you sound out of character", author.oocVoice),
    labelled("What you steer toward and away from", author.boundaries),
  );
}

/**
 * The characters this generation is actually writing.
 *
 * A spotlight has one; a beat has all of its participants, and SPEC §3.5
 * requires full definitions for every one of them rather than the lead in full
 * and the rest compactly — homogenised voices are the failure mode, and voice
 * notes are the direct mitigation.
 */
export function turnCharactersOf(ctx: PromptContext): PromptCharacter[] {
  const turn = ctx.turn;
  if (turn === undefined || turn.kind !== "beat") return [ctx.spotlight];
  // The lead opens, so they come first; nobody is listed twice.
  const rest = turn.participants.filter((member) => member.id !== ctx.spotlight.id);
  return [ctx.spotlight, ...rest];
}

function castBlock(ctx: PromptContext): string | null {
  const inTurn = new Set(turnCharactersOf(ctx).map((member) => member.id));
  const others = ctx.cast.filter((member) => !inTurn.has(member.id));
  if (others.length === 0) return null;
  return paragraphs("## Also in this scene", ...others.map(compactCharacter));
}

function personaBlock(ctx: PromptContext): string | null {
  // With no name and no description there is nothing to say about the reader
  // that the user-lock has not already said.
  if (ctx.persona.name === null && ctx.persona.description === null) return null;
  const body = paragraphs(
    ctx.persona.name === null ? null : `## ${ctx.persona.name}`,
    ctx.persona.description,
  );
  if (body === "") return null;
  return ctx.author === null
    ? body
    : paragraphs(body, "This is the reader's character. You do not write for them.");
}

function summariesBlock(ctx: PromptContext): string | null {
  if (ctx.summaries.length === 0) return null;
  return paragraphs("## What has happened so far", ...ctx.summaries.map((s) => s.content));
}

/**
 * The banned constructions, as one instruction (SPEC §13.6).
 *
 * A list rather than a sentence, because that is how it is stored and because a
 * model follows an enumerated prohibition better than a paragraph describing
 * one. Framed as phrasings to avoid rather than words that are forbidden: the
 * failure mode of a ban list is a model that writes around it so carefully the
 * prose goes stiff.
 */
function banBlock(ctx: PromptContext): string | null {
  const bans = ctx.bans ?? [];
  if (bans.length === 0) return null;
  return paragraphs(
    "Avoid these phrasings. They are the ones this kind of writing falls into, and they read as filler:",
    bans.map((phrase) => `- ${phrase}`).join("\n"),
    "Write the thought a different way rather than reaching for a synonym of the banned one.",
  );
}

function documentsBlock(ctx: PromptContext): string | null {
  if (ctx.documents.length === 0) return null;
  return paragraphs(
    "## Reference material",
    ...ctx.documents.map((chunk) => `### ${chunk.documentName}\n${chunk.content}`),
  );
}

function memoryBlock(ctx: PromptContext): string | null {
  if (ctx.memory.length === 0) return null;
  return paragraphs("## Recalled", ...ctx.memory.map((e) => `${e.name}: ${e.content}`));
}

function guidesBlock(ctx: PromptContext): string | null {
  if (ctx.guides.length === 0) return null;
  return paragraphs(
    "## Current state",
    ...ctx.guides.map((guide) => `### ${guide.name}\n${guide.content}`),
  );
}

function trackersBlock(ctx: PromptContext): string | null {
  if (ctx.trackers.length === 0) return null;
  return paragraphs(
    "## Tracked state",
    ...ctx.trackers.map((tracker) => `### ${tracker.name}\n${tracker.content}`),
  );
}

/**
 * Per-character depth prompts for every character present (§3), grouped by the
 * depth they asked for since several characters may share one.
 */
function depthPromptGroups(
  ctx: PromptContext,
): { depth: number; role: PromptRole; content: string }[] {
  const groups = new Map<string, { depth: number; role: PromptRole; parts: string[] }>();
  for (const character of ctx.cast) {
    const text = character.depthPrompt?.trim();
    if (text === undefined || text === "") continue;
    const key = `${character.depthPromptDepth}:${character.depthPromptRole}`;
    const group = groups.get(key) ?? {
      depth: character.depthPromptDepth,
      role: character.depthPromptRole,
      parts: [],
    };
    group.parts.push(text);
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort((a, b) => a.depth - b.depth)
    .map((group) => ({ depth: group.depth, role: group.role, content: group.parts.join("\n\n") }));
}

/**
 * The second assertion of the user-lock, placed last and nearest the response.
 * SPEC §3 requires the spotlight instruction to name the character explicitly
 * and to come last, because the end of the prompt is what the model weighs most.
 */
/**
 * What the spotlighted character did not witness (SPEC §6).
 *
 * The author sees the whole scene, so history is not trimmed — trimming it
 * would cost the author the continuity it needs to write well. Instead the
 * constraint is stated: this character joined partway through and does not know
 * what came before.
 */
function presenceConstraint(ctx: PromptContext, character: PromptCharacter): string | null {
  const joinedAfter = character.joinedAfterMessageId;
  if (joinedAfter === undefined || joinedAfter === null) return null;

  const index = ctx.history.findIndex((message) => message.id === joinedAfter);
  // Not on the active path — a different branch, or a deleted message — so
  // nothing reliable can be said about what they missed.
  if (index === -1) return null;

  // They missed everything up to and including the message they joined after.
  const missed = index + 1;
  return (
    `${character.name} was not present for the first ${missed} ` +
    `turn${missed === 1 ? "" : "s"} of this scene and does not know what happened in them. ` +
    `Do not have them refer to anything from that part.`
  );
}

/**
 * Knowledge scoping stated per participant (SPEC §6, §3.5). The author sees the
 * whole scene, so history is never trimmed — trimming it would cost the author
 * the continuity it writes from. The constraint is stated instead, once per
 * character it applies to.
 */
function presenceConstraints(ctx: PromptContext): string | null {
  const lines = turnCharactersOf(ctx)
    .map((character) => presenceConstraint(ctx, character))
    .filter((line): line is string => line !== null);
  return lines.length === 0 ? null : lines.join("\n");
}

/** The reader's character, in the possessive, however much of it is known. */
function readersPossessive(ctx: PromptContext): string {
  return ctx.persona.name === null ? "the reader's" : `${ctx.persona.name}'s`;
}

/** English list: "A", "A and B", "A, B and C". */
function listOf(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]!}`;
}

function boundSentence(bound: BeatBound, names: string[]): string {
  switch (bound.kind) {
    case "exchanges":
      return (
        `Write about ${bound.count} exchange${bound.count === 1 ? "" : "s"} — one exchange is ` +
        `each of ${listOf(names)} taking a turn — and then stop.`
      );
    case "until":
      return `Keep going until ${bound.condition.trim().replace(/\.$/, "")}, and then stop.`;
    case "open":
      return `Let the exchange run as long as the moment needs, then stop on something happening.`;
  }
}

/**
 * The near-turn instruction: the last thing said before the model writes.
 *
 * SPEC §3 requires it to name the character explicitly and to come last,
 * because the end of the prompt is what the model weighs most. It is also the
 * second assertion of the user-lock — the first is in the author's identity.
 */
function spotlightInstruction(ctx: PromptContext): string {
  const theirs = readersPossessive(ctx);
  return ctx.author === null
    ? `Stay in character as ${ctx.spotlight.name}. Write only ${ctx.spotlight.name}'s words and ` +
        `actions, never ${theirs}.`
    : `Write the next turn as ${ctx.spotlight.name}, and only as ${ctx.spotlight.name}. ` +
        `Do not write ${theirs} dialogue, actions, or thoughts, and do not decide what they do ` +
        `next: that is the reader's to write.`;
}

/**
 * The beat instruction (SPEC §3.5).
 *
 * Every line of this is a named failure mode from §3.5's table: voices
 * converging, one character dominating, the exchange stalling on mutual
 * agreement, and — the most common way a group scene dies — the beat ending by
 * asking the reader a question and waiting.
 */
function beatInstruction(ctx: PromptContext, bound: BeatBound): string {
  const participants = turnCharactersOf(ctx);
  const names = participants.map((member) => member.name);
  const reader = ctx.persona.name ?? "the reader";
  const lead = ctx.spotlight.name;

  return [
    `Write the next beat of this scene: ${listOf(names)}, together, in one continuous passage. ` +
      `${lead} opens it.`,
    "",
    `- Every one of ${listOf(names)} acts or speaks. Do not funnel the exchange onto one of them.`,
    `- ${boundSentence(bound, names)}`,
    `- Each of them sounds like themselves. Two of them agreeing is not two of them saying the ` +
      `same thing.`,
    `- Move the situation somewhere it was not. Do not have them restate what has already been ` +
      `said, and do not have them settle into agreeing with each other.`,
    `- Do not end the beat by asking ${reader} a question, and do not stop to wait for them. ` +
      `End on something that has happened.`,
    `- Do not write ${readersPossessive(ctx)} dialogue, actions, or thoughts, and do not decide ` +
      `what they do next: that is the reader's to write.`,
    "",
    `Begin each character's part on its own line with their name in bold and a colon, exactly ` +
      `like \`**${lead}:**\`. Prose that is nobody in particular speaking or acting is ` +
      `narration; leave it unlabelled.`,
  ].join("\n");
}

/**
 * The recast instruction (SPEC §7).
 *
 * One character's part of a beat, rewritten with the rest held fixed. The beat
 * is given in full as context and the reply is scoped to the part being
 * replaced, because what comes back is spliced into the beat at that segment's
 * offsets rather than appended.
 */
function recastInstruction(ctx: PromptContext, beatText: string): string {
  const name = ctx.spotlight.name;
  return [
    `The next beat of this scene has already been written:`,
    "",
    beatText.trim(),
    "",
    `Rewrite ${name}'s part of it, and only ${name}'s part. Everything else in the beat stays ` +
      `exactly as it is — do not repeat it, do not continue past it, and do not write anyone ` +
      `else. What ${name} does still has to fit what the others do around it.`,
    "",
    `Reply with ${name}'s lines alone, with no name label and nothing before or after them.`,
  ].join("\n");
}

/**
 * Revising a turn that already exists (SPEC §7).
 *
 * The words come from the op's template — the built-in one, or a user's
 * override, filled and passed in by the caller. There is deliberately no second
 * copy of them here: the template is the only place they are written.
 *
 * **The lock is appended outside the template.** SPEC §0.5 makes it a hard
 * constraint restated near the turn, and a template a user can edit is not
 * where a non-negotiable belongs.
 */
function reviseInstruction(
  ctx: PromptContext,
  turn: Extract<PromptTurn, { kind: "revise" }>,
): string {
  const lock =
    `Do not write ${readersPossessive(ctx)} dialogue, actions, or thoughts, and do not decide ` +
    `what they do next: that is the reader's to write.`;

  const configured = ctx.ops?.[turn.mode]?.text?.trim();
  const body =
    configured === undefined || configured === ""
      ? // No configuration reached the builder — a caller assembling a context
        // by hand, which the tests do. The built-in template still applies.
        fillTemplate(defaultTemplateOf(turn.mode), {
          original: turn.original.trim(),
          input:
            turn.instructions === undefined || turn.instructions.trim() === ""
              ? "Write it again, better."
              : `Write it again, with this changed: ${turn.instructions.trim()}`,
        }).trim()
      : configured;

  return `${body}\n\n${lock}`;
}

/** The near-turn instruction for whichever kind of turn this is. */
function turnInstruction(ctx: PromptContext): string {
  const turn: PromptTurn = ctx.turn ?? { kind: "spotlight" };
  const base =
    turn.kind === "beat"
      ? beatInstruction(ctx, turn.bound)
      : turn.kind === "recast"
        ? recastInstruction(ctx, turn.beatText)
        : turn.kind === "revise"
          ? reviseInstruction(ctx, turn)
          : turn.kind === "ooc"
            ? oocInstruction(ctx, turn.question)
            : spotlightInstruction(ctx);

  // An out-of-character answer is not in the scene, so the rules about who can
  // see and hear what do not apply to it — and appending them would read as an
  // instruction to answer in character after all.
  if (turn.kind === "ooc") return base;
  const presence = presenceConstraints(ctx);
  return presence === null ? base : `${base}\n\n${presence}`;
}

/**
 * Answering the reader directly, as the author rather than as a character
 * (SPEC §12).
 *
 * The hard part is not the answer, it is stopping the scene from moving. A
 * model asked a question mid-roleplay will very often answer it *and* write
 * the next turn, so the instruction spends most of its words on the boundary
 * rather than on the question.
 */
function oocInstruction(ctx: PromptContext, question: string): string {
  const name = ctx.author?.name ?? "the author";
  const reader = ctx.persona.name ?? "the reader";
  return (
    `${reader} is speaking to you directly, out of character. Step out of the story and answer ` +
    `as ${name} — yourself, the writer — not as anyone in the scene.\n\n` +
    `${reader} asked:\n${question.trim()}\n\n` +
    `Answer them and stop. Do not write the next turn, do not continue the scene, do not put ` +
    `words in any character's mouth, and do not narrate anything. Plain speech, no markers ` +
    `around it. Be brief unless brevity would be unhelpful.`
  );
}

/** What the inspector calls the near-turn instruction, by kind. */
function turnInstructionLabel(ctx: PromptContext): string {
  const turn = ctx.turn;
  switch (turn?.kind) {
    case "beat":
      return "Beat instruction";
    case "recast":
      return "Recast instruction";
    case "revise":
      return turn.mode === "expand"
        ? "Expand instruction"
        : turn.mode === "correct"
          ? "Correction instruction"
          : "Continue instruction";
    case "ooc":
      return "Out-of-character question";
    default:
      return "Spotlight instruction";
  }
}

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

const PREFIX: BlockPlacement = { kind: "prefix" };
/** Depth 0 is immediately before the response: the near-turn position. */
const NEAR_TURN: BlockPlacement = { kind: "depth", depth: 0 };

/**
 * The history block holds no text of its own. It marks the position the
 * rendered turns occupy in the assembly order, and its cost is computed from
 * the messages that survive trimming.
 */
export const HISTORY_PLACEHOLDER = "<history>";

/**
 * Build every block the context has content for, keyed by id. The caller orders
 * them, because the order is the preset's to override (SPEC §3).
 */
export function draftBlocks(ctx: PromptContext): Map<PromptBlockId, DraftBlock[]> {
  const lore = sortLore(ctx.lore);
  const blocks = new Map<PromptBlockId, DraftBlock[]>();

  function add(
    id: PromptBlockId,
    label: string,
    source: string,
    content: string | null,
    placement: BlockPlacement = PREFIX,
    role: PromptRole = "system",
  ): void {
    const trimmed = content?.trim();
    if (trimmed === undefined || trimmed === "") return;
    const existing = blocks.get(id) ?? [];
    existing.push({ id, label, source, role, content: trimmed, placement });
    blocks.set(id, existing);
  }

  add("system_prompt", "System prompt", "preset", ctx.preset.systemPrompt);
  add("author_identity", "Author", ctx.author?.name ?? "author", authorIdentity(ctx));
  const inTurn = turnCharactersOf(ctx);
  add(
    "spotlight_character",
    inTurn.length === 1 ? "Spotlight" : "Beat participants",
    inTurn.map((member) => member.name).join(", "),
    // In single-character mode a per-character system prompt overrides the
    // preset's framing for this character (§2). Every character the turn is
    // writing gets a full definition, voice notes included: §3.5 makes that the
    // first mitigation for the voices converging.
    paragraphs(
      ctx.author === null ? ctx.spotlight.systemPrompt : null,
      ...inTurn.map(fullCharacter),
    ),
  );
  add("cast", "Cast", "scene members", castBlock(ctx));
  add("persona", "Persona", ctx.persona.name ?? "the reader", personaBlock(ctx));
  add(
    "scenario",
    "Scenario",
    ctx.scene.scenarioOverride === null ? ctx.spotlight.name : "scene override",
    ctx.scene.scenarioOverride ?? ctx.spotlight.scenario,
  );

  for (const entry of lore.prefix) {
    add("constant_lore", "Lore", `entry ${entry.id}`, entry.content, PREFIX, entry.insertionRole);
  }

  add("example_dialogue", "Example dialogue", ctx.spotlight.name, ctx.spotlight.exampleDialogue);
  add("summaries", "Summary", "rolling summarisation", summariesBlock(ctx));
  add("history", "History", "message tree", HISTORY_PLACEHOLDER);

  add("documents", "Documents", "data bank", documentsBlock(ctx), NEAR_TURN);
  add("memory", "Memory", "narrative memory", memoryBlock(ctx), NEAR_TURN);

  for (const entry of lore.atDepth) {
    add(
      "matched_lore",
      "Lore",
      `entry ${entry.id}`,
      entry.content,
      { kind: "depth", depth: entry.insertionDepth },
      entry.insertionRole,
    );
  }

  add("guides", "Guides", "persistent guides", guidesBlock(ctx), NEAR_TURN);

  // One block per selected option, rather than one block for all of them.
  // §13.5's whole argument is that an option is visible in the inspector as a
  // labelled block with a cost — merging them would give back the wall of
  // toggles whose effect you cannot see.
  for (const option of ctx.options ?? []) {
    add(
      "prompt_option",
      `${option.groupName}: ${option.name}`,
      "prompt option",
      option.fragment,
      option.placement,
      option.role,
    );
  }
  add("ban_list", "Banned constructions", "ban list", banBlock(ctx), NEAR_TURN);
  add("trackers", "Trackers", "tracker state", trackersBlock(ctx), NEAR_TURN);

  for (const group of depthPromptGroups(ctx)) {
    add("depth_prompts", "Character depth prompt", "cards", group.content, {
      kind: "depth",
      depth: group.depth,
    }, group.role);
  }

  const steerOp = ctx.ops?.["steer"];
  add(
    "director_note",
    "Steer",
    "scene",
    steerOp?.enabled === false ? null : (steerOp?.text ?? ctx.directorNote ?? null),
    NEAR_TURN,
    steerOp?.role ?? "system",
  );
  add(
    "post_history",
    "Post-history instructions",
    ctx.spotlight.postHistoryInstructions === null ? "preset" : ctx.spotlight.name,
    ctx.spotlight.postHistoryInstructions ?? ctx.preset.postHistoryInstructions,
    NEAR_TURN,
  );
  const nudgeOp = ctx.ops?.["nudge"];
  add(
    "nudge",
    "Nudge",
    "director",
    nudgeOp?.enabled === false ? null : (nudgeOp?.text ?? ctx.nudge ?? null),
    NEAR_TURN,
    nudgeOp?.role ?? "system",
  );
  // The marker is named exactly, because the app parses for it. "Mark it
  // clearly" leaves the model to invent one, and an aside the splitter cannot
  // find is an aside printed into the middle of the scene — the single most
  // common way a roleplay turn is ruined (§12).
  add(
    "ooc_invitation",
    "Out-of-character invitation",
    "scene",
    // Never on an out-of-character turn: the author is already out of the scene
    // there, and inviting it out again reads as an instruction to come back in.
    ctx.oocDue === true && ctx.turn?.kind !== "ooc"
      ? `You may step out of character briefly at the end of this turn to speak to the reader as ` +
          `${ctx.author?.name ?? "yourself"} — a question, a check, a flag. Keep it to a sentence ` +
          `or two, put it in double parentheses like ((this)), and put nothing else inside them. ` +
          `Everything outside them is the scene. Say nothing at all if you have nothing to ask.`
      : null,
    NEAR_TURN,
  );
  const reviseOp = ctx.turn?.kind === "revise" ? ctx.ops?.[ctx.turn.mode] : undefined;
  add(
    "spotlight_instruction",
    turnInstructionLabel(ctx),
    inTurn.map((member) => member.name).join(", "),
    turnInstruction(ctx),
    NEAR_TURN,
    reviseOp?.role ?? "system",
  );
  add("jailbreak", "Final instruction", "preset", ctx.preset.jailbreak, NEAR_TURN);

  // Prefill seeds the assistant turn rather than being a message of its own, and
  // is dropped where the provider cannot accept one (§4).
  if (ctx.capabilities.supportsPrefill) {
    add("prefill", "Prefill", "preset", ctx.preset.prefill, NEAR_TURN, "assistant");
  }

  // Outlet-addressed lore is placed by name, not by position (§3).
  for (const entry of lore.outlets) {
    const name = entry.outletName;
    if (name === null) continue;
    add("matched_lore", `Outlet: ${name}`, `entry ${entry.id}`, entry.content, {
      kind: "outlet",
      name,
    });
  }

  return blocks;
}
