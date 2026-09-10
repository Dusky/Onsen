import type { RefObject } from "react";
import type { AnnotationDto, AutopilotStateDto, LayoutDto, MessageDto } from "@shared/types.ts";
import type { ActiveGeneration } from "../../state/generation.ts";
import { strings } from "../../strings.ts";
import { SceneDescribePrompt } from "./SceneDescribePrompt.tsx";
import { MessageBlock, MessageEditor, OocBlock, Reasoning } from "../../components/MessageBlock.tsx";
import { VirtualizedLog } from "../../components/VirtualizedLog.tsx";
import { speakerFor } from "./attribution.ts";

/** Below this many messages the plain render runs; above it, the virtualized
 * log (DESIGN §415). The threshold keeps short scenes on the exact behaviour
 * the reader has been using, and only long ones pay for virtualization. */
const LOG_VIRTUALIZE_THRESHOLD = 200;

/**
 * The message log (SPEC §5, §20 phase 149): every turn in every shape it can
 * be, the streaming tail, and the "show earlier" affordance. Extracted whole so
 * the plain and virtualized paths share one `renderMessage` and can never drift.
 */
export function MessageLog({
  logRef,
  sceneId,
  messages,
  logMessages,
  historyTotal,
  isGenerating,
  isFetching,
  onShowEarlier,
  editing,
  onCancelEdit,
  onSaveEdit,
  authorName,
  layout,
  personaId,
  onReroll,
  onOpenVersions,
  onLongPress,
  onInspect,
  selectedId,
  onSelect,
  onRevert,
  runCommand,
  onOpenOoc,
  active,
  recastInFlight,
  oocInFlight,
  autopilotActive,
  apState,
  onStopAutopilot,
  onCancel,
  autopilotNote,
  mediaNote,
  onDismissMediaNote,
}: {
  logRef: RefObject<HTMLDivElement | null>;
  /** The scene, so a generation's error only shows for the scene it belongs to. */
  sceneId: string;
  /** The fetched window plus any held older turns (§20 phase 62). */
  messages: MessageDto[];
  /** `messages` filtered by the aside preference; what the log draws. */
  logMessages: MessageDto[];
  historyTotal: number;
  isGenerating: boolean;
  isFetching: boolean;
  onShowEarlier(): void;
  editing: string | null;
  onCancelEdit(): void;
  onSaveEdit(messageId: string, content: string): void;
  authorName: string | null;
  layout: LayoutDto;
  personaId: string | null;
  onReroll(message: MessageDto): void;
  onOpenVersions(message: MessageDto): void;
  onLongPress(message: MessageDto): void;
  onInspect(message: MessageDto): void;
  selectedId: string | null;
  onSelect(id: string): void;
  onRevert(annotation: AnnotationDto): void;
  runCommand(id: string, turn: MessageDto | null): void;
  onOpenOoc(): void;
  active: ActiveGeneration | null;
  recastInFlight: { messageId: string; ordinal: number; text: string } | null;
  oocInFlight: boolean;
  autopilotActive: boolean;
  apState: AutopilotStateDto | null;
  onStopAutopilot(): void;
  onCancel(): void;
  autopilotNote: string | null;
  mediaNote: string | null;
  onDismissMediaNote(): void;
}) {
  // One message, in every shape it can be: an aside, an edit, or a turn.
  const renderMessage = (message: MessageDto, index: number) =>
    message.kind === "ooc" ? (
      <OocBlock
        key={message.id}
        message={message}
        speakerName={message.authorType === "user" ? strings.chat.you : authorName}
        onOpenChannel={onOpenOoc}
      />
    ) : editing === message.id ? (
      <MessageEditor
        key={message.id}
        initial={message.content}
        onCancel={onCancelEdit}
        onSave={(content) => {
          onCancelEdit();
          onSaveEdit(message.id, content);
        }}
      />
    ) : (
      <MessageBlock
        key={message.id}
        message={message}
        // Its place in the whole roleplay, not in the window (§20 phase 62).
        // `#17` on the forty-first turn of forty-five is a number that means
        // nothing — and the gutter's whole job is to be the number you quote.
        ordinal={historyTotal - logMessages.length + index + 1}
        speakerName={speakerFor(message, authorName)}
        attribution={layout.attribution}
        style={message.authorType === "user" ? layout.reader : layout.author}
        avatarShape={layout.avatarShape}
        personaId={personaId}
        onReroll={() => onReroll(message)}
        onOpenVersions={() => onOpenVersions(message)}
        onLongPress={() => onLongPress(message)}
        onInspect={() => onInspect(message)}
        selected={selectedId === message.id}
        onSelect={() => onSelect(message.id)}
        onRevert={onRevert}
        // Every one goes through `runCommand`, the same path the palette takes,
        // so the row and the sheet can never disagree about what an action does
        // (§20 phase 57). No breakpoint gate: it is on every width.
        actions={{
          onVersions: () => runCommand("versions", message),
          onBranch: () => runCommand("branch", message),
          onEdit: () => runCommand("edit", message),
          onCopy: () => runCommand("copy", message),
          onHide: () => runCommand("hide", message),
          onMore: () => onLongPress(message),
        }}
        {...(recastInFlight?.messageId === message.id
          ? {
              recasting: { ordinal: recastInFlight.ordinal, text: recastInFlight.text },
              ...(active?.reasoning ? { streamingReasoning: active.reasoning } : {}),
            }
          : {})}
      />
    );

  /**
   * The turns above the window (§20 phase 62).
   *
   * A roleplay of four hundred turns used to send four hundred turns of prose,
   * their segments, their annotations and their media on every open. It sends
   * the newest hundred now, and this says how many are behind them — a count
   * rather than a bare "load more", because a log that simply ends is
   * indistinguishable from a log that has ended.
   */
  const earlier =
    historyTotal > messages.length ? (
      <button
        type="button"
        className="btn mb-[22px] w-full"
        disabled={isFetching}
        onClick={onShowEarlier}
      >
        {strings.chat.showEarlier(historyTotal - messages.length)}
      </button>
    ) : null;

  // Everything after the messages: the turn being written, the error, the stop
  // strip, the autopilot note. Rendered in normal flow, below the virtualized
  // area when it is engaged, so a streamed turn can grow without a re-measure.
  const tail = (
    <>
      {isGenerating && recastInFlight === null && !oocInFlight && active?.speaker != null ? (
        <article>
          <header className="mb-[10px]">
            <div className="flex items-center gap-[10px]">
              <span className="chrome shrink-0 text-[13.5px] font-semibold text-ink-label">
                {active.speaker}
              </span>
              <span className="h-px flex-1 bg-rule" />
            </div>
            {active.director !== null && active.director.reason !== "" ? (
              <p className="meta mt-[5px] leading-[1.5]">{active.director.reason}</p>
            ) : null}
          </header>
          <Reasoning text={active.reasoning} />
          <p className="text-[length:var(--onsen-text-prose)] leading-[var(--onsen-leading-prose)] whitespace-pre-wrap">
            {active.text}
          </p>
        </article>
      ) : null}

      {active !== null && active.sceneId === sceneId && active.status === "error" ? (
        <p
          role="alert"
          className="chrome border border-red-border bg-red-bg px-[11px] py-[9px] text-[13.5px] text-red-text"
        >
          {active.error ?? strings.errors.generationFailed}
        </p>
      ) : null}

      {autopilotActive || isGenerating ? (
        <div className="flex items-center gap-[10px]">
          <span className="h-[6px] w-[6px] flex-none" style={{ background: "var(--onsen-color-red)" }} />
          <span className="chrome flex-1 text-[13px] text-ink-muted">
            {autopilotActive
              ? apState !== null
                ? `${strings.chat.autopilot} · ${strings.chat.autopilotCount(apState.turns, apState.maxTurns)}`
                : strings.chat.autopilot
              : active === null || active.speaker === null
                ? strings.chat.choosing
                : strings.chat.writing(active.speaker)}
          </span>
          <button
            type="button"
            onClick={() => (autopilotActive ? onStopAutopilot() : onCancel())}
            className="chrome border border-red-border px-[10px] py-[6px] text-[13px]"
            style={{ color: "var(--onsen-color-red)" }}
          >
            {autopilotActive ? strings.chat.autopilotTakeOver : strings.chat.stop}
          </button>
        </div>
      ) : null}

      {autopilotNote !== null && !autopilotActive ? (
        <p className="meta leading-[1.5]">{autopilotNote}</p>
      ) : null}

      {mediaNote !== null ? (
        <button
          type="button"
          onClick={onDismissMediaNote}
          className="chrome block text-left text-[12.5px] leading-[1.5]"
          style={{ color: "var(--onsen-color-red)" }}
        >
          {mediaNote}
        </button>
      ) : null}
    </>
  );

  return (
    <div
      ref={logRef}
      className="min-h-0 flex-1 overflow-y-auto px-[22px] py-[18px]"
      style={
        isGenerating
          ? { borderLeft: "2px solid var(--onsen-color-red)", paddingLeft: "20px" }
          : undefined
      }
    >
      {messages.length >= LOG_VIRTUALIZE_THRESHOLD ? (
        <VirtualizedLog
          scrollRef={logRef}
          count={logMessages.length}
          renderRow={(index) => renderMessage(logMessages[index]!, index)}
          head={earlier}
          tail={tail}
        />
      ) : (
        <div className="mx-auto flex min-h-full w-full max-w-[var(--onsen-prose-measure)] flex-col justify-end gap-[26px]">
          {earlier}
          {/* An unwritten scene's first question (§157): describe it and the
              model sets it up — or just write below, the composer is right
              there. */}
          {logMessages.length === 0 && !isGenerating ? (
            <SceneDescribePrompt sceneId={sceneId} />
          ) : null}
          {logMessages.map(renderMessage)}
          {tail}
        </div>
      )}
    </div>
  );
}
