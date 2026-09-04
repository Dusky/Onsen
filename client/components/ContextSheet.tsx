import { useState } from "react";
import type { GuideDto, GuideKind, SummaryStateDto, TaskDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { Sheet } from "./Sheet.tsx";
import { GuidesBody } from "./GuidesPanel.tsx";
import { MemoryPanel } from "./MemoryPanel.tsx";
import { blueMuted, blueText } from "./blue.ts";

/**
 * The blue sheet: everything the prompt carries that is not the story itself.
 *
 * Two halves, because a guide and a summary are the same kind of object from
 * the reader's side — notes the author keeps about their own scene, standing in
 * for what the model would otherwise have to be shown. **Guides are that state
 * now; summaries are that state before.** Putting them in one sheet under a
 * switch, rather than giving memory its own cell, keeps the design's 3 × 2 ops
 * grid intact and puts the two costs side by side, which is where a user
 * deciding what to spend context on actually needs them.
 */
export type ContextTab = "guides" | "memory";

export function ContextSheet({
  tab,
  onTab,
  guides,
  tasks,
  customPrompt,
  guideWorking,
  onRebuild,
  onEditGuide,
  onFlush,
  summaries,
  evicting,
  summaryWorking,
  onSummarise,
  onRewriteSummary,
  onEditSummary,
  onForgetSummary,
  onClose,
}: {
  tab: ContextTab;
  onTab(tab: ContextTab): void;
  guides: GuideDto[];
  tasks: TaskDto[];
  customPrompt: string | null;
  guideWorking: GuideKind | "all" | null;
  onRebuild(kind: GuideKind | "all"): void;
  onEditGuide(guideId: string, content: string): void;
  onFlush(kind: GuideKind | "all"): void;
  summaries: SummaryStateDto | undefined;
  evicting: boolean;
  summaryWorking: boolean;
  onSummarise(): void;
  onRewriteSummary(summaryId: string): void;
  onEditSummary(summaryId: string, content: string): void;
  onForgetSummary(summaryId: string | "all"): void;
  /** Absent when this renders as a pane rather than a sheet (§43). */
  onClose?(): void;
}) {
  const guideTotal = guides.reduce((sum, guide) => sum + guide.tokenCount, 0);
  const memoryTotal = (summaries?.summaries ?? [])
    .filter((row) => (summaries?.injectedIds ?? []).includes(row.id))
    .reduce((sum, row) => sum + row.tokenCount, 0);

  const body = (
    <>
      {/* Both costs are on the switch, not only the open one: the question a
          user has here is which of the two is eating their context. */}
      <div className="mt-[10px] mb-[4px] flex gap-[6px]">
        <TabButton
          label={strings.chat.tabGuides}
          cost={guideTotal}
          active={tab === "guides"}
          onClick={() => onTab("guides")}
        />
        <TabButton
          label={strings.chat.tabMemory}
          cost={memoryTotal}
          active={tab === "memory"}
          onClick={() => onTab("memory")}
        />
      </div>

      {tab === "guides" ? (
        <GuidesBody
          guides={guides}
          tasks={tasks}
          customPrompt={customPrompt}
          working={guideWorking}
          onRebuild={onRebuild}
          onEdit={onEditGuide}
          onFlush={onFlush}
          // As a pane there is nothing to close, so the panel's own dismiss is
          // a no-op rather than a button that appears to do nothing.
          onClose={onClose ?? (() => undefined)}
        />
      ) : (
        <MemoryPanel
          state={summaries}
          evicting={evicting}
          working={summaryWorking}
          onSummarise={onSummarise}
          onRewrite={onRewriteSummary}
          onEdit={onEditSummary}
          onForget={onForgetSummary}
        />
      )}
    </>
  );

  // A pane on a wide screen, a sheet on a phone — the same body either way,
  // so the two cannot drift into being two different views of one thing.
  return onClose === undefined ? (
    body
  ) : (
    <Sheet
      tone="blue"
      title={tab === "guides" ? strings.chat.guides : strings.chat.memory}
      meta={strings.chat.guidesTotal(tab === "guides" ? guideTotal : memoryTotal)}
      onClose={onClose}
    >
      {body}
    </Sheet>
  );
}

function TabButton({
  label,
  cost,
  active,
  onClick,
}: {
  label: string;
  cost: number;
  active: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="chrome flex-1 border px-[10px] py-[9px] text-[9px] tracking-[0.12em] uppercase"
      style={{
        borderColor: active
          ? "var(--onsen-color-blue-border-strong)"
          : "var(--onsen-color-blue-border)",
        background: active ? "var(--onsen-color-blue-bg)" : "transparent",
        ...(active ? blueText : blueMuted),
      }}
    >
      {label} · {strings.chat.guidesTotal(cost)}
    </button>
  );
}
