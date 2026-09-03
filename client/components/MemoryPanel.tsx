import { useState } from "react";
import type { SummaryDto, SummaryStateDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { useConfirm } from "./ConfirmSheet.tsx";
import { blueMuted, blueOutline, blueProse, blueRule, blueSolid, blueText, red } from "./blue.ts";

/**
 * The memory panel (SPEC §16 "memory panel — summaries (editable) … wipe
 * controls", §11 layer 1).
 *
 * It is the blue sheet's second half rather than a panel of its own, because a
 * summary and a guide are the same kind of object from the reader's side: notes
 * the author keeps about their own scene, which the prompt carries instead of
 * the story. Guides are that state now; summaries are that state before.
 *
 * The one thing this screen has to make unmissable is which summaries are
 * actually in the prompt. §11's threshold means the newest summary is written
 * long before it is used, and a panel that showed all of them identically would
 * make "it forgot" and "it has not started remembering yet" look the same.
 */
export function MemoryPanel({
  state,
  evicting,
  working,
  onSummarise,
  onRewrite,
  onEdit,
  onForget,
}: {
  state: SummaryStateDto | undefined;
  /** Whether the scene drops the raw turns a summary covers (§11). */
  evicting: boolean;
  working: boolean;
  onSummarise(): void;
  onRewrite(summaryId: string): void;
  onEdit(summaryId: string, content: string): void;
  onForget(summaryId: string | "all"): void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmNode, confirm] = useConfirm();
  const [editing, setEditing] = useState<string | null>(null);

  const summaries = state?.summaries ?? [];
  const injected = new Set(state?.injectedIds ?? []);

  return (
    <div className="pt-[4px] pb-[14px]">
      {/* What is waiting, so the trigger is not a black box: "nothing has been
          summarised" and "eleven turns are queued behind the threshold" are
          very different things to be looking at. */}
      <p className="chrome mb-[12px] text-[9px] tracking-[0.10em] uppercase" style={blueMuted}>
        {state === undefined || state.pendingMessages === 0
          ? strings.chat.memoryPendingNone
          : strings.chat.memoryPending(state.pendingMessages, state.pendingWords)}
        {state !== undefined && state.coveredMessages > 0 && evicting
          ? ` · ${strings.chat.memoryEvicting(state.coveredMessages)}`
          : null}
      </p>

      {summaries.length === 0 ? (
        <p className="chrome mb-[14px] text-[9.5px] leading-[1.6]" style={blueMuted}>
          {strings.chat.memoryEmpty}
        </p>
      ) : null}

      {summaries.map((summary) => (
        <SummaryRow
          key={summary.id}
          summary={summary}
          injected={injected.has(summary.id)}
          open={expanded === summary.id}
          editing={editing === summary.id}
          working={working}
          onToggle={() => setExpanded(expanded === summary.id ? null : summary.id)}
          onStartEdit={() => setEditing(summary.id)}
          onCancelEdit={() => setEditing(null)}
          onSave={(content) => {
            onEdit(summary.id, content);
            setEditing(null);
          }}
          onRewrite={() => onRewrite(summary.id)}
          onForget={() =>
            confirm(
              strings.chat.memoryForgetConfirm,
              () => {
                setExpanded(null);
                onForget(summary.id);
              },
              { confirmLabel: strings.chat.memoryForget, tone: "blue" },
            )
          }
        />
      ))}

      <div className="mt-[16px] flex gap-[6px]">
        <button
          type="button"
          className="btn flex-1"
          style={blueSolid}
          disabled={working || state === undefined || state.pendingMessages === 0}
          onClick={onSummarise}
        >
          {working ? strings.chat.memoryWorking : strings.chat.memoryNow}
        </button>
      </div>
      {summaries.length === 0 ? null : (
        <button
          type="button"
          className="btn mt-[6px] w-full"
          style={red}
          onClick={() =>
            confirm(
              strings.chat.memoryForgetAllConfirm,
              () => {
                setExpanded(null);
                onForget("all");
              },
              { confirmLabel: strings.chat.memoryForgetAll, tone: "blue" },
            )
          }
        >
          {strings.chat.memoryForgetAll}
        </button>
      )}
      {confirmNode}
    </div>
  );
}

function SummaryRow({
  summary,
  injected,
  open,
  editing,
  working,
  onToggle,
  onStartEdit,
  onCancelEdit,
  onSave,
  onRewrite,
  onForget,
}: {
  summary: SummaryDto;
  injected: boolean;
  open: boolean;
  editing: boolean;
  working: boolean;
  onToggle(): void;
  onStartEdit(): void;
  onCancelEdit(): void;
  onSave(content: string): void;
  onRewrite(): void;
  onForget(): void;
}) {
  // Three things worth saying on one line, in the order they matter: how much
  // story this stands for, whether the prompt is carrying it, and whose words
  // these are.
  const marks = [
    strings.chat.memoryCovers(summary.messageCount),
    injected ? strings.chat.memoryInjected : strings.chat.memoryHeld,
    summary.isEdited ? strings.chat.memoryEdited : null,
    summary.level > 0 ? strings.chat.memoryFolded(summary.level) : null,
  ].filter((mark): mark is string => mark !== null);

  return (
    <div style={blueRule}>
      <button
        type="button"
        onClick={onToggle}
        className="chrome flex min-h-[44px] w-full items-start justify-between gap-[10px] py-[12px] text-left"
      >
        <span className="min-w-0 flex-1">
          <span
            className="block text-[9px] tracking-[0.10em] uppercase"
            // A summary the prompt is not carrying is drawn quieter than one it
            // is, because that is the difference the panel exists to show.
            style={injected ? blueText : blueMuted}
          >
            {marks.join(" · ")}
          </span>
          {open ? null : (
            <span
              className="mt-[5px] block truncate font-prose text-[12.5px]"
              style={injected ? blueProse : blueMuted}
            >
              {summary.content}
            </span>
          )}
        </span>
        {/* Pinned to the first line, so the cost sits beside what it is the
            cost of rather than beside the preview underneath it. */}
        <span
          className="chrome flex flex-none items-center gap-[8px] pt-[1px] text-[9px] tracking-[0.10em] uppercase"
          style={blueMuted}
        >
          {strings.chat.guidesTotal(summary.tokenCount)}
          <span aria-hidden>{open ? "⌃" : "⌄"}</span>
        </span>
      </button>

      {open ? (
        <div className="pb-[14px]">
          {editing ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const field = event.currentTarget.elements.namedItem("content");
                if (field instanceof HTMLTextAreaElement && field.value.trim() !== "") {
                  onSave(field.value.trim());
                } else {
                  onCancelEdit();
                }
              }}
            >
              <textarea
                name="content"
                rows={Math.min(16, Math.max(5, summary.content.split("\n").length + 4))}
                autoFocus
                defaultValue={summary.content}
                className="field resize-none py-[10px]"
                style={{
                  borderColor: "var(--onsen-color-blue-border-strong)",
                  color: "var(--onsen-color-blue-prose)",
                }}
              />
              <div className="mt-[9px] flex gap-[6px]">
                <button type="submit" className="btn flex-1" style={blueSolid}>
                  {strings.chat.memorySave}
                </button>
                <button type="button" className="btn" style={blueOutline} onClick={onCancelEdit}>
                  {strings.common.cancel}
                </button>
              </div>
            </form>
          ) : (
            <>
              <p
                className="mb-[12px] font-prose text-[13.5px] leading-[1.62] whitespace-pre-wrap"
                style={blueProse}
              >
                {summary.content}
              </p>
              <div className="flex gap-[6px]">
                <button
                  type="button"
                  className="btn flex-1"
                  style={blueOutline}
                  onClick={onStartEdit}
                >
                  {strings.chat.memoryEdit}
                </button>
                <button
                  type="button"
                  className="btn flex-1"
                  style={blueOutline}
                  disabled={working}
                  onClick={onRewrite}
                >
                  {strings.chat.memoryRewrite}
                </button>
                <button type="button" className="btn" style={red} onClick={onForget}>
                  {strings.chat.memoryForget}
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
