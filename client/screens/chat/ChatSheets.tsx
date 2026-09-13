import type {
  GuideDto,
  GuideKind,
  MessageDto,
  PromptDebugInfo,
  ReviseMode,
  SceneMemberDto,
  SceneStatsDto,
  SummaryStateDto,
  TaskDto,
} from "@shared/types.ts";
import { strings } from "../../strings.ts";
import { navigate } from "../../lib/router.ts";
import { CommandPalette } from "../../components/CommandPalette.tsx";
import { CheckpointsSheet, MarkSheet } from "../../components/Checkpoints.tsx";
import { BranchMapSheet } from "../../components/BranchMap.tsx";
import { Sheet, SheetAction } from "../../components/Sheet.tsx";
import { ContextSheet, type ContextTab } from "../../components/ContextSheet.tsx";
import { InspectorSheet } from "../../components/InspectorSheet.tsx";
import { OpPrompt } from "../../components/OpsGrid.tsx";
import { OocChannel } from "../../components/OocChannel.tsx";
import { QuickReplySheet } from "../../components/QuickReplies.tsx";
import { StatsSheet } from "./StatsSheet.tsx";
import { speakerFor } from "./attribution.ts";

type Confirm = (
  message: string,
  run: () => void,
  options?: { confirmLabel?: string; tone?: "default" | "blue" },
) => void;

/**
 * The chat screen's overlays (§20 phase 149): every sheet and palette the
 * screen can open. Extracted whole so the screen's tail is a coordinator's
 * return, not a wall of conditionals. The props are the screen's state and
 * handlers — this is the presentation half, not a second owner of either.
 */
export function ChatSheets({
  sceneId,
  messages,
  authorName,
  isDesktop,
  isGenerating,
  oocInFlight,
  oocText,
  confirm,
  // palette
  paletteOpen,
  acting,
  paletteTurn,
  paletteSeed,
  onRunCommand,
  onClosePalette,
  // marks / checkpoints / stats
  marking,
  onCloseMark,
  marksOpen,
  onCloseMarks,
  statsOpen,
  stats,
  onCloseStats,
  toolsOpen,
  onCloseTools,
  checkpointCount,
  onOpenCheckpoints,
  onOpenStats,
  branchMapOpen,
  onOpenBranchMap,
  onCloseBranchMap,
  // context (guides + memory)
  guidesOpen,
  contextTab,
  onContextTab,
  guides,
  tasks,
  customPrompt,
  guideWorking,
  onRebuildGuide,
  onEditGuide,
  onFlushGuide,
  summaries,
  evicting,
  summaryWorking,
  onSummarise,
  onRewriteSummary,
  onEditSummary,
  onForgetSummary,
  onCloseContext,
  // inspector / preview
  inspecting,
  inspection,
  onCloseInspector,
  previewOpen,
  previewInspection,
  previewPending,
  previewError,
  onClosePreview,
  // correcting / recasting
  correcting,
  onCloseCorrecting,
  onRevise,
  recasting,
  onCloseRecasting,
  onRecast,
  // cast acting
  castActing,
  onCloseCastActing,
  onBench,
  onRemoveFromCast,
  onEditCard,
  // ooc
  oocOpen,
  onCloseOoc,
  onStartOoc,
  // versions
  versionsFor,
  siblings,
  onSetLeaf,
  onDeleteMessage,
  onCloseVersions,
  // quick replies
  quickRepliesOpen,
  onCloseQuickReplies,
}: {
  sceneId: string;
  messages: MessageDto[];
  authorName: string | null;
  isDesktop: boolean;
  isGenerating: boolean;
  oocInFlight: boolean;
  oocText: string;
  confirm: Confirm;
  paletteOpen: boolean;
  acting: MessageDto | null;
  paletteTurn: MessageDto | null;
  paletteSeed: string;
  onRunCommand(id: string, turn: MessageDto | null): void;
  onClosePalette(): void;
  marking: MessageDto | null;
  onCloseMark(): void;
  marksOpen: boolean;
  onCloseMarks(): void;
  statsOpen: boolean;
  stats: SceneStatsDto | null;
  onCloseStats(): void;
  toolsOpen: boolean;
  onCloseTools(): void;
  checkpointCount: number;
  onOpenCheckpoints(): void;
  onOpenStats(): void;
  branchMapOpen: boolean;
  onOpenBranchMap(): void;
  onCloseBranchMap(): void;
  guidesOpen: boolean;
  contextTab: ContextTab;
  onContextTab(tab: ContextTab): void;
  guides: GuideDto[];
  tasks: TaskDto[];
  customPrompt: string | null;
  guideWorking: GuideKind | "all" | null;
  onRebuildGuide(kind: GuideKind | "all"): void;
  onEditGuide(guideId: string, content: string): void;
  onFlushGuide(kind: GuideKind | "all"): void;
  summaries: SummaryStateDto | undefined;
  evicting: boolean;
  summaryWorking: boolean;
  onSummarise(): void;
  onRewriteSummary(summaryId: string): void;
  onEditSummary(summaryId: string, content: string): void;
  onForgetSummary(summaryId: string | "all"): void;
  onCloseContext(): void;
  inspecting: MessageDto | null;
  inspection: { debug: PromptDebugInfo } | undefined;
  onCloseInspector(): void;
  previewOpen: boolean;
  previewInspection: { debug: PromptDebugInfo } | undefined;
  previewPending: boolean;
  previewError: string | null;
  onClosePreview(): void;
  correcting: MessageDto | null;
  onCloseCorrecting(): void;
  onRevise(message: MessageDto, mode: ReviseMode, instructions?: string): void;
  recasting: MessageDto | null;
  onCloseRecasting(): void;
  onRecast(message: MessageDto, ordinal: number, name: string | null): void;
  castActing: SceneMemberDto | null;
  onCloseCastActing(): void;
  onBench(patch: { characterId: string; isMuted?: boolean; isActive?: boolean }): void;
  onRemoveFromCast(characterId: string): void;
  onEditCard(characterId: string): void;
  oocOpen: boolean;
  onCloseOoc(): void;
  onStartOoc(question: string): void;
  versionsFor: MessageDto | null;
  siblings: Array<{ id: string; content: string; siblingIndex: number; siblingCount: number }>;
  onSetLeaf(messageId: string): void;
  onDeleteMessage(messageId: string): void;
  onCloseVersions(): void;
  quickRepliesOpen: boolean;
  onCloseQuickReplies(): void;
}) {
  return (
    <>
      {/* §20 phase 43: the message sheet IS the palette, opened on a turn.
          One list of commands, two ways in, so an action added to one surface
          cannot go missing from the other. */}
      {acting !== null || paletteOpen ? (
        <CommandPalette
          hasScene
          selectedSpeaker={paletteTurn === null ? null : speakerFor(paletteTurn, authorName)}
          initialQuery={paletteSeed}
          onRun={(id) => onRunCommand(id, paletteTurn)}
          onClose={onClosePalette}
        />
      ) : null}

      {marking !== null ? (
        <MarkSheet sceneId={sceneId} message={marking} onClose={onCloseMark} />
      ) : null}

      {marksOpen ? (
        <CheckpointsSheet sceneId={sceneId} onClose={onCloseMarks} />
      ) : null}

      {statsOpen ? (
        <StatsSheet stats={stats} onClose={onCloseStats} />
      ) : null}

      {/* The `⋯ TOOLS` cell (design handoff): the scene's instruments, one
          sheet instead of header chips. */}
      {toolsOpen ? (
        <Sheet title={strings.chat.opTools} onClose={onCloseTools}>
          <SheetAction
            label={
              checkpointCount === 0
                ? strings.chat.opToolsCheckpoints
                : `${strings.chat.opToolsCheckpoints} · ${checkpointCount}`
            }
            onClick={onOpenCheckpoints}
          />
          <SheetAction label={strings.chat.opToolsStats} onClick={onOpenStats} />
          <SheetAction label={strings.chat.opToolsBranchMap} onClick={onOpenBranchMap} />
        </Sheet>
      ) : null}

      {branchMapOpen ? (
        <BranchMapSheet sceneId={sceneId} authorName={authorName} onClose={onCloseBranchMap} />
      ) : null}

      {guidesOpen ? (
        <ContextSheet
          tab={contextTab}
          onTab={onContextTab}
          guides={guides}
          tasks={tasks}
          customPrompt={customPrompt}
          guideWorking={guideWorking}
          onRebuild={onRebuildGuide}
          onEditGuide={onEditGuide}
          onFlush={onFlushGuide}
          summaries={summaries}
          evicting={evicting}
          summaryWorking={summaryWorking}
          onSummarise={onSummarise}
          onRewriteSummary={onRewriteSummary}
          onEditSummary={onEditSummary}
          onForgetSummary={onForgetSummary}
          onClose={onCloseContext}
        />
      ) : null}

      {/* The inspector (§16): the exact prompt behind the message, with its
          costs, its evictions and its lore verdicts. Opened only with something
          to show. */}
      {inspecting !== null && inspection !== undefined ? (
        <InspectorSheet
          inspection={inspection}
          messages={messages}
          onClose={onCloseInspector}
        />
      ) : null}

      {/* The next-turn preview (§20 phase 68): the same sheet, the forward
          answer. While the build runs the sheet shows a line rather than
          opening empty. */}
      {previewOpen ? (
        previewInspection !== undefined ? (
          <InspectorSheet inspection={previewInspection} messages={messages} onClose={onClosePreview} />
        ) : (
          <Sheet title={strings.chat.inspectorTitle} onClose={onClosePreview}>
            <p className="meta py-[10px] leading-[1.5]">
              {previewPending
                ? strings.chat.promptPreviewWorking
                : previewError !== null
                  ? strings.chat.promptPreviewFailed
                  : strings.chat.promptPreviewWorking}
            </p>
            {previewError !== null ? (
              <p className="explain explain-alert">{previewError}</p>
            ) : null}
          </Sheet>
        )
      ) : null}

      {correcting !== null ? (
        <Sheet title={strings.chat.opCorrectTitle} onClose={onCloseCorrecting}>
          <div className="pt-[6px] pb-[10px]">
            <OpPrompt
              title={strings.chat.opCorrectTitle}
              placeholder={strings.chat.opCorrectPlaceholder}
              submitLabel={strings.chat.opApply}
              onSubmit={(value) => onRevise(correcting, "correct", value.trim() || undefined)}
              onCancel={onCloseCorrecting}
            />
          </div>
        </Sheet>
      ) : null}

      {/* Which part to rewrite. A separate sheet rather than a long-press on the
          part itself: nesting a gesture target inside the beat's own would cost
          the beat its swipe, and both would fire at once. */}
      {recasting !== null ? (
        <Sheet title={strings.chat.recast} onClose={onCloseRecasting}>
          {(recasting.segments ?? []).map((segment) => (
            <button
              key={segment.ordinal}
              type="button"
              disabled={segment.speakerType !== "character"}
              onClick={() => onRecast(recasting, segment.ordinal, segment.speakerName)}
              className="row w-full text-left disabled:opacity-40"
            >
              <span className="chrome text-[12.5px] text-ink-label">
                {segment.speakerName ?? strings.chat.narrationPart}
              </span>
              <p className="mt-[5px] line-clamp-2 text-[length:var(--onsen-text-prose-excerpt)] leading-[1.5] text-ink-prose-muted">
                {segment.content}
              </p>
            </button>
          ))}
        </Sheet>
      ) : null}

      {castActing !== null ? (
        <Sheet title={strings.chat.castMember} onClose={onCloseCastActing}>
          {/* Two states, not one (§20 phase 62). Muted keeps them in the
              prompt and out of the rotation. Benched takes them out of the
              prompt altogether. Both keep every line they have written. */}
          <SheetAction
            label={castActing.isMuted ? strings.chat.unmute : strings.chat.mute}
            onClick={() => {
              onBench({ characterId: castActing.characterId, isMuted: !castActing.isMuted });
              onCloseCastActing();
            }}
          />
          <SheetAction
            label={castActing.isActive ? strings.chat.bench : strings.chat.unbench}
            onClick={() => {
              onBench({ characterId: castActing.characterId, isActive: !castActing.isActive });
              onCloseCastActing();
            }}
          />
          <SheetAction
            label={strings.chat.editCard}
            onClick={() => onEditCard(castActing.characterId)}
          />
          <SheetAction
            label={strings.chat.viewCard}
            onClick={() => navigate({ name: "character", characterId: castActing.characterId })}
          />
          <SheetAction
            label={strings.chat.removeFromCast}
            destructive
            onClick={() => {
              onRemoveFromCast(castActing.characterId);
              onCloseCastActing();
            }}
          />
        </Sheet>
      ) : null}

      {oocOpen ? (
        <OocChannel
          messages={messages.filter((message) => message.kind === "ooc")}
          authorName={authorName}
          personaName={strings.ooc.reader}
          // An out-of-character answer streams like any other generation, but
          // it never appears in the log behind the sheet — so it is drawn here
          // instead, in the bubble it is going to land in.
          pending={isGenerating && oocInFlight ? oocText : null}
          onSend={onStartOoc}
          onClose={onCloseOoc}
        />
      ) : null}

      {versionsFor !== null ? (
        <Sheet title={strings.chat.versions} onClose={onCloseVersions}>
          {siblings.map((sibling) => (
            <div
              key={sibling.id}
              className="flex items-start gap-[8px]"
              style={{
                // The currently-showing version is a selection, not a live
                // state — interactive blue (design review fix 1).
                borderTop:
                  sibling.id === versionsFor.id ? "2px solid var(--onsen-color-blue)" : undefined,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  onSetLeaf(sibling.id);
                  onCloseVersions();
                }}
                className="min-w-0 flex-1 py-[12px] text-left"
              >
                <span className="chrome text-[12.5px] text-ink-dim">
                  {sibling.siblingIndex + 1} / {sibling.siblingCount}
                </span>
                <p className="mt-[6px] line-clamp-3 text-[length:var(--onsen-text-prose-excerpt)] leading-[1.5] text-ink-prose-muted">
                  {sibling.content}
                </p>
              </button>
              {sibling.siblingCount <= 1 ? null : (
                <button
                  type="button"
                  aria-label={strings.common.delete}
                  className="chrome flex-none py-[12px] text-[13px]"
                  style={{ color: "var(--onsen-color-red)" }}
                  onClick={() =>
                    confirm(
                      strings.chat.deleteVersionConfirm,
                      () => {
                        onDeleteMessage(sibling.id);
                        onCloseVersions();
                      },
                      { confirmLabel: strings.common.delete },
                    )
                  }
                >
                  {"\u00d7"}
                </button>
              )}
            </div>
          ))}
        </Sheet>
      ) : null}

      {quickRepliesOpen ? (
        <QuickReplySheet onClose={onCloseQuickReplies} />
      ) : null}
    </>
  );
}
