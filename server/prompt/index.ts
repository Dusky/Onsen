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

function orderedBlockIds(ctx: PromptContext): readonly PromptBlockId[] {
  const configured = ctx.preset.blockOrder;
  if (configured === null || configured.length === 0) return DEFAULT_BLOCK_ORDER;
  // A preset that omits a block is choosing to drop it, but it must not be able
  // to drop the history or the user-lock by accident, so both are re-appended
  // if missing.
  const seen = new Set(configured);
  const required: PromptBlockId[] = [];
  for (const id of ["history", "spotlight_instruction"] as const) {
    if (!seen.has(id)) required.push(id);
  }
  return [...configured, ...required];
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

  const historyBudget = available - fixedTokens;
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

  // Trim oldest first, whole messages only — never a partial message (§3).
  let kept = history.turns;
  let historyTokens = kept.reduce((sum, turn) => sum + turn.tokens, 0);
  let firstKept = 0;
  while (historyTokens > historyBudget && firstKept < kept.length) {
    const dropped = kept[firstKept]!;
    evicted.push({
      blockId: "history",
      itemId: dropped.messageId,
      label: dropped.content.slice(0, 80),
      tokens: dropped.tokens,
      reason: "history_budget",
    });
    historyTokens -= dropped.tokens;
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
    fixedTokens,
    historyTokens,
    totalTokens: fixedTokens + historyTokens,
    headroom: available - (fixedTokens + historyTokens),
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
  return renderInstruct(template, system, messages, prefill);
}
