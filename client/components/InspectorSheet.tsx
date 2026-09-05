import { useState } from "react";
import type { MessageDto, PromptBlock, PromptInspectorDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { Sheet } from "./Sheet.tsx";

/**
 * The prompt inspector (SPEC §16, §20 phase 25): the exact prompt behind a
 * message, block by block, with costs, evictions and the lore verdicts.
 *
 * Chrome, not prose — every line of this is machinery, and the design gives
 * the app's own voice the mono face. The history block is a position marker,
 * so its contents are resolved here against the scene the reader is already
 * looking at, which keeps the DTO small and the transcript exactly what the
 * log shows: one source of truth for what was said.
 */

function placementOf(block: PromptBlock): string {
  switch (block.placement.kind) {
    case "prefix":
      return strings.chat.inspectorPrefix;
    case "depth":
      return strings.chat.inspectorDepth(block.placement.depth);
    case "outlet":
      return strings.chat.inspectorOutlet(block.placement.name);
  }
}

export function InspectorSheet({
  inspection,
  messages,
  onClose,
}: {
  inspection: PromptInspectorDto;
  /** The scene's active path, to resolve history identifiers into content. */
  messages: MessageDto[];
  onClose(): void;
}) {
  const debug = inspection.debug;
  const [open, setOpen] = useState<string | null>(null);
  const byId = new Map(messages.map((message) => [message.id, message]));

  const history = debug.historyIncluded
    .map((id) => byId.get(id))
    .filter((message): message is MessageDto => message !== undefined);

  return (
    <Sheet
      title={strings.chat.inspectorTitle}
      meta={strings.chat.inspectorTotal(debug.totalTokens, debug.available)}
      onClose={onClose}
    >
      {/* The arithmetic, in one line, because that is the argument the whole
          sheet makes: what the window was, what was spent, what was left. */}
      <p className="meta mt-[10px] leading-[1.7]">
        {strings.chat.inspectorBudget(debug)} ·{" "}
        {debug.tokensAreEstimated ? strings.chat.inspectorEstimated : strings.chat.inspectorCounted}
      </p>
      {debug.headroom <= 0 ? (
        <p
          className="chrome mt-[6px] text-[10.5px] leading-[1.5] tracking-[0.06em] uppercase"
          style={{ color: "var(--onsen-color-red)" }}
        >
          {strings.chat.inspectorNoHeadroom}
        </p>
      ) : null}

      {/* Blocks, in assembly order: label and cost above, provenance under,
          content on demand — the whole prompt is long, and the question that
          opens the sheet is usually "what is this block and what did it cost". */}
      <p className="section-label mt-[16px] mb-[6px]">{strings.chat.inspectorBlocks}</p>
      {debug.blocks.map((block, index) => {
        const key = `${index}-${block.id}`;
        const isOpen = open === key;
        return (
          <div key={key} className="border-b border-rule py-[9px]">
            <button
              type="button"
              className="flex w-full items-baseline gap-[9px] text-left"
              onClick={() => setOpen(isOpen ? null : key)}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{block.label}</span>
                <span className="meta block truncate">
                  {[block.source, placementOf(block), block.role]
                    .filter((part) => part !== "")
                    .join(" · ")}
                </span>
              </span>
              <span className="chrome flex-none text-[10.5px] tracking-[0.06em] text-ink-muted uppercase">
                {strings.chat.inspectorTokens(block.tokens)}
              </span>
            </button>
            {isOpen && block.content !== "" ? (
              // Mono: a prompt block is machinery with braces in it (§16).
              <pre className="chrome mt-[8px] max-h-[240px] overflow-y-auto border border-rule bg-bg-sunken px-[10px] py-[8px] text-[12.5px] leading-[1.6] whitespace-pre-wrap">
                {block.content}
              </pre>
            ) : null}
            {isOpen && block.id === "history" ? (
              <div className="mt-[8px]">
                {history.map((message) => (
                  <p key={message.id} className="explain">
                    <span className="tracking-[0.06em] uppercase">
                      {message.characterId === null
                        ? message.authorType === "user"
                          ? strings.chat.youLabel
                          : strings.chat.narratorName
                        : (messages.find((row) => row.id === message.id)?.characterId ?? "")}
                    </span>
                    {" · "}
                    <span className="text-ink-muted">{message.content}</span>
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}

      {/* What the budget could not carry — §3's point: "the character forgot"
          is almost always "the model never saw it". */}
      {debug.evicted.length > 0 ? (
        <>
          <p className="section-label mt-[16px] mb-[6px]">{strings.chat.inspectorEvicted}</p>
          {debug.evicted.map((item, index) => (
            <div key={index} className="flex items-baseline gap-[9px] border-b border-rule py-[8px]">
              <span className="chrome min-w-0 flex-1 truncate text-[12.5px] text-ink-dim">
                {item.label}
              </span>
              <span
                className="chrome flex-none text-[10.5px] tracking-[0.06em] uppercase"
                style={{ color: "var(--onsen-color-red)" }}
              >
                {strings.chat.inspectorEviction[item.reason]}
              </span>
              <span className="chrome flex-none text-[10.5px] text-ink-muted uppercase">
                {strings.chat.inspectorTokens(item.tokens)}
              </span>
            </div>
          ))}
        </>
      ) : null}

      {/* The lore verdicts: every entry considered, and what decided it. */}
      {debug.loreTrace.length > 0 ? (
        <>
          <p className="section-label mt-[16px] mb-[6px]">{strings.chat.inspectorLore}</p>
          {debug.loreTrace.map((entry) => (
            <div
              key={entry.entryId}
              className="flex items-baseline gap-[9px] border-b border-rule py-[8px]"
            >
              <span className="chrome min-w-0 flex-1 truncate text-[12.5px] text-ink-dim">
                {entry.title}
              </span>
              <span
                className="chrome flex-none text-[10.5px] tracking-[0.06em] uppercase"
                style={{
                  color: entry.skipped === null ? "var(--onsen-color-text-muted)" : undefined,
                }}
              >
                {entry.skipped === null
                  ? entry.matchedKey === null
                    ? strings.chat.inspectorLoreConstant
                    : strings.chat.inspectorLoreFired(entry.matchedKey)
                  : strings.chat.inspectorSkip[entry.skipped]}
              </span>
            </div>
          ))}
        </>
      ) : null}

      {/* The two quiet failure modes §3 and §18 insist on naming rather than
          hiding: an outlet nothing filled, a macro nobody implements. */}
      {debug.unresolvedOutlets.length > 0 ? (
        <p className="chrome mt-[14px] text-[10.5px] leading-[1.5] text-ink-dim uppercase">
          {strings.chat.inspectorOutlets(debug.unresolvedOutlets.join(", "))}
        </p>
      ) : null}
      {debug.unknownMacros.length > 0 ? (
        <p className="chrome mt-[8px] text-[10.5px] leading-[1.5] text-ink-dim uppercase">
          {strings.chat.inspectorMacros(debug.unknownMacros.join(", "))}
        </p>
      ) : null}

      <div className="h-[14px]" />
    </Sheet>
  );
}
