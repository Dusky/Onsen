import { draftBlocks, HISTORY_PLACEHOLDER, type DraftBlock } from "./blocks.ts";
import { renderHistory, type RenderedTurn } from "./history.ts";
import { resolveMacros, type MacroEnvironment } from "./macros.ts";
import { findInstructTemplate, renderInstruct } from "./instruct.ts";
import {
  DEFAULT_BLOCK_ORDER,
  PromptBudgetError,
  type BuiltPrompt,
  type EvictedItem,
  type NormalizedMessage,
  type PromptBlock,
  type PromptBlockId,
  type PromptContext,
  type PromptDebugInfo,
  type PromptRole,
} from "./types.ts";

export * from "./types.ts";
export { createEstimatingTokenizer, createExactTokenizer } from "./tokenizer.ts";
export { renderHistory } from "./history.ts";
export * from "./instruct.ts";
export { resolveMacros } from "./macros.ts";
export { defaultTemplateOf, fillTemplate, TEMPLATED_OPS } from "./op-templates.ts";

/**
 * The prompt builder (SPEC §3). Pure: same context in, same prompt out, with no
 * database, no HTTP, no clock and no randomness that was not passed in.
 *
 * The shape of the work is: draft every block the context has content for, order
 * them, resolve macros and outlets across all of them at once, cost them, fit
 * history into whatever budget is left, then flatten to the message array the
 * provider wants. What was evicted is recorded as carefully as what was
 * included, because "the character forgot" is almost always "the model never saw
 * it".
 */

/** What the timeline holds before capability rules are applied. */
interface TimelineEntry {
  role: PromptRole;
  content: string;
  /** Set for history turns, so eviction can name them. */
  messageId?: string;
}

/** Inserted only when a provider's alternation rules force invented text. */
const ALTERNATION_FILLER = "Begin.";

/**
 * The order to assemble in: a preset's own, or §3's default.
 *
 * Ids are strings rather than `PromptBlockId` since phase 56, because an entry
 * may name one of the preset's own blocks (`custom:<ulid>`). An id nothing was
 * drafted under simply contributes nothing, which is what lets an order saved
 * by a newer build load on an older one.
 */
function orderedBlockIds(ctx: PromptContext): readonly string[] {
  const configured = ctx.preset.blockOrder;
  // Extension injections are always appended: they have no home in the default
  // order, and a preset must not be able to drop them by omission (§145).
  const extensionIds = ctx.extensionBlocks.map((block) => block.key);
  // Null only. An order that is *empty* is a preset whose blocks are all
  // switched off, which is a different thing from one that has never been
  // arranged — and conflating them put every disabled block back in the prompt.
  // `parsePromptOrder` already returns null for an order with nothing in it, so
  // an empty array here can only mean "everything was disabled".
  if (configured === null) {
    // Custom blocks still have to land somewhere when no order is saved. Ahead
    // of the history, in the order they were given: they are instructions about
    // how to write, and instructions after the transcript read as part of it.
    const customs = ctx.preset.customBlocks.map((block) => block.id);
    if (customs.length === 0 && extensionIds.length === 0) return DEFAULT_BLOCK_ORDER;
    const at = DEFAULT_BLOCK_ORDER.indexOf("history");
    const cut = at === -1 ? DEFAULT_BLOCK_ORDER.length : at;
    return [
      ...DEFAULT_BLOCK_ORDER.slice(0, cut),
      ...customs,
      ...extensionIds,
      ...DEFAULT_BLOCK_ORDER.slice(cut),
    ];
  }
  // A preset that omits a block is choosing to drop it, but it must not be able
  // to drop the history or the user-lock by accident, so both are re-appended
  // if missing.
  const seen = new Set(configured);
  const required: PromptBlockId[] = [];
  for (const id of ["history", "spotlight_instruction", "dialogue_colour"] as const) {
    if (!seen.has(id)) required.push(id);
  }
  return [...configured, ...required, ...extensionIds];
}

export function buildPrompt(ctx: PromptContext): BuiltPrompt {
  const mode = ctx.author === null ? "single_character" : "author";
  const drafted = draftBlocks(ctx);

  // Flatten to the configured order. Several blocks can share an id — lore
  // entries and depth prompts each contribute their own — and they keep the
  // order they were drafted in.
  const ordered: DraftBlock[] = [];
  for (const id of orderedBlockIds(ctx)) {
    for (const block of drafted.get(id) ?? []) ordered.push(block);
  }

  /* ---------------- macros and outlets ---------------- */

  const unknownMacros = new Set<string>();

  // Outlet contents are resolved first, in their own pass. Macro substitution is
  // a single scan, so an outlet spliced in unresolved would carry its own macros
  // into the prompt verbatim.
  const rawOutlets: Record<string, string> = {};
  for (const block of ordered) {
    if (block.placement.kind === "outlet") rawOutlets[block.placement.name] = block.content;
  }
  const firstPass: MacroEnvironment = {
    ctx,
    outlets: rawOutlets,
    unresolvedOutlets: new Set(),
    usedOutlets: new Set(),
  };
  const outlets: Record<string, string> = {};
  for (const [name, content] of Object.entries(rawOutlets)) {
    outlets[name] = resolveMacros(content, firstPass).text;
  }

  const env: MacroEnvironment = {
    ctx,
    outlets,
    unresolvedOutlets: new Set(),
    usedOutlets: new Set(),
  };

  function resolve(text: string): string {
    const result = resolveMacros(text, env);
    for (const macro of result.unknown) unknownMacros.add(macro);
    return result.text;
  }

  const resolved = ordered.map((block) =>
    // An outlet block already went through the first pass; resolving it again
    // would let a {{random}} disagree with the copy that was spliced in.
    block.placement.kind === "outlet"
      ? { ...block, content: outlets[block.placement.name] ?? block.content }
      : { ...block, content: resolve(block.content) },
  );

  /* ---------------- history ---------------- */

  const history = renderHistory(
    // Macros inside stored messages resolve too: a card's first message
    // routinely contains {{user}}, and leaving it literal is the visible bug.
    { ...ctx, history: ctx.history.map((m) => ({ ...m, content: resolve(m.content) })) },
    mode,
  );

  /* ---------------- costing ---------------- */

  const blocks: PromptBlock[] = [];
  let fixedTokens = 0;

  for (const block of resolved) {
    if (block.id === "history") {
      // Costed from the surviving turns, once trimming has run.
      blocks.push({ ...block, content: HISTORY_PLACEHOLDER, tokens: 0 });
      continue;
    }
    // An outlet nothing referenced costs nothing, because its text never
    // reaches the prompt. Being filled is not enough — a placeholder has to
    // have consumed it.
    const reaches =
      block.placement.kind !== "outlet" || env.usedOutlets.has(block.placement.name);
    const tokens = reaches ? ctx.tokenizer.count(block.content) : 0;
    fixedTokens += tokens;
    blocks.push({ ...block, tokens });
  }

  /* ---------------- budget (SPEC §3) ---------------- */

  const reservedForResponse = ctx.preset.maxResponseTokens;
  const available = ctx.budget - reservedForResponse;
  if (fixedTokens > available) throw new PromptBudgetError(fixedTokens, available);

  const evicted: EvictedItem[] = [
    ...history.hidden.map(
      (message): EvictedItem => ({
        blockId: "history",
        itemId: message.id,
        label: message.label,
        tokens: 0,
        reason: "hidden",
      }),
    ),
    // §11's raw eviction is reported like any other eviction, and for the same
    // reason §3 insists on the list at all: "the character forgot" is almost
    // always "the model never saw it", and a summary standing in for forty
    // turns is exactly the case a user needs to be able to discover.
    ...history.summarized.map(
      (message): EvictedItem => ({
        blockId: "history",
        itemId: message.id,
        label: message.label,
        tokens: message.tokens,
        reason: "summarized",
      }),
    ),
  ];

  /*
   * Gradual push-out (§20 phase 64).
   *
   * The incumbent's policy, and the shape of it is the whole idea: the
   * examples are the *oldest* things in the transcript, so they join the trim
   * queue ahead of the first turn and go by the same rule everything else goes
   * by — oldest first, whole items only. With a short scene they all survive;
   * as it grows they leave one at a time, and only once they are gone does the
   * scene itself start being trimmed.
   *
   * Which is why this is not a separate pass with a policy of its own. There
   * is one trim order, and `gradual` decides whether the examples are in it.
   */
  const examples =
    ctx.preset.exampleEviction === "gradual"
      ? blocks.filter((block) => block.id === "example_dialogue")
      : [];
  const exampleTokens = examples.reduce((sum, block) => sum + block.tokens, 0);

  // Everything that is not being trimmed has to fit first; what is left is
  // shared by the examples and the scene.
  const trimBudget = available - (fixedTokens - exampleTokens);

  let dropped = 0;
  let queueTokens = exampleTokens + history.turns.reduce((sum, turn) => sum + turn.tokens, 0);
  while (queueTokens > trimBudget && dropped < examples.length) {
    const example = examples[dropped]!;
    evicted.push({
      blockId: "example_dialogue",
      itemId: null,
      label: example.content.slice(0, 80),
      tokens: example.tokens,
      reason: "example_pushed_out",
    });
    queueTokens -= example.tokens;
    const at = blocks.indexOf(example);
    if (at !== -1) blocks.splice(at, 1);
    dropped += 1;
  }

  const fixedAfterExamples = fixedTokens - examples.slice(0, dropped).reduce((sum, block) => sum + block.tokens, 0);
  const historyBudget = available - fixedAfterExamples;

  // Trim oldest first, whole messages only — never a partial message (§3).
  let kept = history.turns;
  let historyTokens = kept.reduce((sum, turn) => sum + turn.tokens, 0);
  let firstKept = 0;
  while (historyTokens > historyBudget && firstKept < kept.length) {
    const oldest = kept[firstKept]!;
    evicted.push({
      blockId: "history",
      itemId: oldest.messageId,
      label: oldest.content.slice(0, 80),
      tokens: oldest.tokens,
      reason: "history_budget",
    });
    historyTokens -= oldest.tokens;
    firstKept += 1;
  }
  kept = kept.slice(firstKept);

  const historyBlock = blocks.find((block) => block.id === "history");
  if (historyBlock !== undefined) historyBlock.tokens = historyTokens;

  /* ---------------- timeline ---------------- */

  const timeline = assembleTimeline(blocks, kept);

  /* ---------------- provider shaping (SPEC §4) ---------------- */

  // The history block is a position marker, not text: its turns are rendered
  // into the timeline, so its placeholder must never join the system prompt.
  const systemText = blocks
    .filter(
      (block) =>
        block.id !== "history" && block.placement.kind === "prefix" && block.role === "system",
    )
    .map((block) => block.content)
    .join("\n\n");

  const shaped = shapeForProvider(ctx, systemText, timeline, blocks);

  const debug: PromptDebugInfo = {
    mode,
    tokensAreEstimated: ctx.tokenizer.isEstimate,
    tokenizerId: ctx.tokenizer.id,
    budget: ctx.budget,
    reservedForResponse,
    available,
    fixedTokens: fixedAfterExamples,
    historyTokens,
    totalTokens: fixedAfterExamples + historyTokens,
    headroom: available - (fixedAfterExamples + historyTokens),
    blocks,
    evicted,
    historyIncluded: kept.map((turn) => turn.messageId),
    unresolvedOutlets: [...env.unresolvedOutlets],
    unknownMacros: [...unknownMacros],
    // Handed in on the context and copied, not computed: the builder stays
    // pure (§3), and the trace belongs beside the blocks it explains anyway.
    loreTrace: [...(ctx.loreTrace ?? [])],
    // The retrieval trace rides the same way: the chunks themselves are the
    // documents block; their scores are this, for the inspector's "what was
    // recalled and why" (§11).
    retrievedChunks: ctx.documents.map((chunk) => ({
      documentTitle: chunk.documentName,
      score: chunk.score ?? 0,
      excerpt: chunk.content.slice(0, 200),
    })),
    // Carried, never computed here: the recall ran in the I/O layer, where the
    // embeddings provider is, and the builder copies the trace for the same
    // reason it copies the lore one.
    memoryTrace: ctx.memoryTrace ?? [],
  };

  const prefill = blocks.find((block) => block.id === "prefill")?.content;

  const built: BuiltPrompt = {
    messages: shaped.messages,
    outlets,
    debug,
  };
  if (shaped.system !== undefined) built.system = shaped.system;
  if (prefill !== undefined) built.prefill = prefill;
  if (ctx.capabilities.mode === "text") {
    built.rawText = renderText(ctx, shaped.system, shaped.messages, prefill);
  }
  return built;
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

/**
 * Place the depth-injected blocks among the history turns. Depth 0 sits
 * immediately before the response, depth 1 before the last turn, and so on —
 * which is why a nudge at depth 0 behaves completely differently from the same
 * text in the prefix (§18).
 */
function assembleTimeline(blocks: PromptBlock[], turns: RenderedTurn[]): TimelineEntry[] {
  const atPosition = new Map<number, TimelineEntry[]>();

  // Prefix blocks that are not system text keep their declared role and lead the
  // conversation rather than joining the system prompt.
  const leading: TimelineEntry[] = [];

  for (const block of blocks) {
    if (block.id === "history" || block.id === "prefill") continue;
    if (block.placement.kind === "outlet") continue;
    if (block.placement.kind === "prefix") {
      if (block.role !== "system") leading.push({ role: block.role, content: block.content });
      continue;
    }
    // Positions are counted against the surviving history, so a depth deeper
    // than the history simply lands at its start.
    const position = Math.max(0, Math.min(turns.length, turns.length - block.placement.depth));
    const bucket = atPosition.get(position) ?? [];
    bucket.push({ role: block.role, content: block.content });
    atPosition.set(position, bucket);
  }

  const timeline: TimelineEntry[] = [...leading];
  for (let index = 0; index < turns.length; index++) {
    for (const entry of atPosition.get(index) ?? []) timeline.push(entry);
    const turn = turns[index]!;
    timeline.push({ role: turn.role, content: turn.content, messageId: turn.messageId });
  }
  for (const entry of atPosition.get(turns.length) ?? []) timeline.push(entry);

  return timeline;
}

/* ------------------------------------------------------------------ */
/* Provider shaping                                                    */
/* ------------------------------------------------------------------ */

interface ShapedPrompt {
  system: string | undefined;
  messages: NormalizedMessage[];
}

function shapeForProvider(
  ctx: PromptContext,
  systemText: string,
  timeline: TimelineEntry[],
  blocks: PromptBlock[],
): ShapedPrompt {
  const capabilities = ctx.capabilities;
  let entries: TimelineEntry[] = timeline.map((entry) => ({ ...entry }));
  let system: string | undefined;

  if (capabilities.separateSystemRole) {
    system = systemText === "" ? undefined : systemText;
  } else if (systemText !== "") {
    // No system role: the definitional text has to lead the conversation.
    entries = [{ role: "user", content: systemText }, ...entries];
  }

  if (capabilities.requiresStrictAlternation) {
    // A provider that alternates strictly has no place for a mid-conversation
    // system turn, so those become user turns and then merge with their
    // neighbours.
    entries = entries.map((entry) =>
      entry.role === "system" ? { ...entry, role: "user" as const } : entry,
    );

    if (entries.length > 0 && entries[0]!.role === "assistant") {
      // The conversation would open on the assistant, which such providers
      // reject. The filler is recorded as a block so invented text never
      // reaches the model without appearing in the inspector.
      entries = [{ role: "user", content: ALTERNATION_FILLER }, ...entries];
      blocks.push({
        id: "alternation_filler",
        label: "Alternation filler",
        source: "provider capability",
        role: "user",
        content: ALTERNATION_FILLER,
        placement: { kind: "prefix" },
        tokens: ctx.tokenizer.count(ALTERNATION_FILLER),
      });
    }

    const merged: TimelineEntry[] = [];
    for (const entry of entries) {
      const previous = merged.at(-1);
      if (previous !== undefined && previous.role === entry.role) {
        previous.content = `${previous.content}\n\n${entry.content}`;
      } else {
        merged.push({ ...entry });
      }
    }
    entries = merged;
  }

  /*
   * Squash consecutive system messages (§20 phase 64).
   *
   * Several near-turn blocks land at the same depth — guides, trackers, the
   * ban list, a director's note — and each becomes its own system turn. Some
   * models follow one combined instruction better than a run of small ones,
   * and some providers bill per message.
   *
   * After the alternation pass rather than before, because that pass has
   * already turned system entries into user ones where a provider demands it,
   * and squashing them first would merge along a boundary that no longer
   * exists. Messages carrying an id keep it: `historyIncluded` is how the
   * inspector knows what the model saw, and a merged turn would lose that.
   */
  if (ctx.preset.squashSystem) {
    const squashed: TimelineEntry[] = [];
    for (const entry of entries) {
      const previous = squashed.at(-1);
      if (
        previous !== undefined &&
        previous.role === "system" &&
        entry.role === "system" &&
        previous.messageId === undefined &&
        entry.messageId === undefined
      ) {
        previous.content = `${previous.content}\n\n${entry.content}`;
      } else {
        squashed.push({ ...entry });
      }
    }
    entries = squashed;
  }

  return {
    system,
    messages: entries.map((entry) => ({ role: entry.role, content: entry.content })),
  };
}

/**
 * Text-completion rendering (SPEC §4).
 *
 * The instruct template does the work; without one this falls back to the plain
 * labelled transcript, which is the right answer for a base model and the wrong
 * one for anything instruct-tuned.
 *
 * This runs *before* costing, which is the reason it lives here rather than in
 * the adapter: on a long scene the turn markers are hundreds of tokens, and a
 * wrapper applied after the budget was struck overflows a window the builder
 * had already reported as fitting.
 */
function renderText(
  ctx: PromptContext,
  system: string | undefined,
  messages: NormalizedMessage[],
  prefill: string | undefined,
): string {
  const template = ctx.instruct ?? findInstructTemplate("plain")!;
  // Text completion has no tool role (§20 phase 46) and the roleplay builder
  // never emits one, so narrowing here is a type-level fact rather than a
  // filter that could silently drop a turn.
  const renderable = messages.filter(
    (message): message is NormalizedMessage & { role: "system" | "user" | "assistant" } =>
      message.role !== "tool",
  );
  return renderInstruct(template, system, renderable, prefill);
}
