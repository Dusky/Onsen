import type {
  BlockPlacement,
  PromptBlockId,
  PromptCharacter,
  PromptContext,
  PromptLoreEntry,
  PromptRole,
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
  return paragraphs(
    `You are ${author.name}, the author of this story. You write every character in the cast. ` +
      `${ctx.persona.name} belongs to the reader: never write their dialogue, their actions, or their thoughts, ` +
      `and never decide what they do next.`,
    author.personality,
    labelled("How you write", author.writingStyle),
    labelled("How you direct a scene", author.directingStyle),
    labelled("How you sound out of character", author.oocVoice),
    labelled("What you steer toward and away from", author.boundaries),
  );
}

function castBlock(ctx: PromptContext): string | null {
  const others = ctx.cast.filter((member) => member.id !== ctx.spotlight.id);
  if (others.length === 0) return null;
  return paragraphs("## Also in this scene", ...others.map(compactCharacter));
}

function personaBlock(ctx: PromptContext): string | null {
  const body = paragraphs(`## ${ctx.persona.name}`, ctx.persona.description);
  if (body === "") return null;
  return ctx.author === null
    ? body
    : paragraphs(body, "This is the reader's character. You do not write for them.");
}

function summariesBlock(ctx: PromptContext): string | null {
  if (ctx.summaries.length === 0) return null;
  return paragraphs("## What has happened so far", ...ctx.summaries.map((s) => s.content));
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
function spotlightInstruction(ctx: PromptContext): string {
  if (ctx.author === null) {
    return (
      `Stay in character as ${ctx.spotlight.name}. Write only ${ctx.spotlight.name}'s words and ` +
      `actions, never ${ctx.persona.name}'s.`
    );
  }
  return (
    `Write the next turn as ${ctx.spotlight.name}, and only as ${ctx.spotlight.name}. ` +
    `Do not write ${ctx.persona.name}'s dialogue, actions, or thoughts, and do not decide what ` +
    `they do next: that is the reader's to write.`
  );
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
  add(
    "spotlight_character",
    "Spotlight",
    ctx.spotlight.name,
    // In single-character mode a per-character system prompt overrides the
    // preset's framing for this character (§2).
    paragraphs(
      ctx.author === null ? ctx.spotlight.systemPrompt : null,
      fullCharacter(ctx.spotlight),
    ),
  );
  add("cast", "Cast", "scene members", castBlock(ctx));
  add("persona", "Persona", ctx.persona.name, personaBlock(ctx));
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
  add("trackers", "Trackers", "tracker state", trackersBlock(ctx), NEAR_TURN);

  for (const group of depthPromptGroups(ctx)) {
    add("depth_prompts", "Character depth prompt", "cards", group.content, {
      kind: "depth",
      depth: group.depth,
    }, group.role);
  }

  add("director_note", "Steer", "scene", ctx.directorNote ?? null, NEAR_TURN);
  add(
    "post_history",
    "Post-history instructions",
    ctx.spotlight.postHistoryInstructions === null ? "preset" : ctx.spotlight.name,
    ctx.spotlight.postHistoryInstructions ?? ctx.preset.postHistoryInstructions,
    NEAR_TURN,
  );
  add("nudge", "Nudge", "director", ctx.nudge ?? null, NEAR_TURN);
  add(
    "ooc_invitation",
    "Out-of-character invitation",
    "scene",
    ctx.oocDue === true
      ? `You may step out of character briefly at the end of this turn to speak to the reader as ` +
          `${ctx.author?.name ?? "yourself"}. Keep it short, and mark it clearly.`
      : null,
    NEAR_TURN,
  );
  add(
    "spotlight_instruction",
    "Spotlight instruction",
    ctx.spotlight.name,
    spotlightInstruction(ctx),
    NEAR_TURN,
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
