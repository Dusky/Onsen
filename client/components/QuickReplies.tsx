import { useState } from "react";
import type { QuickReplyDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { Sheet } from "./Sheet.tsx";
import { useConfirm } from "./ConfirmSheet.tsx";
import {
  useCreateQuickReply,
  useDeleteQuickReply,
  useMoveQuickReply,
  useQuickReplies,
  useUpdateQuickReply,
} from "../lib/queries.ts";

/**
 * Quick replies (SPEC §7, §20 phase 65): a label and a prompt the reader
 * writes once and fires from the composer with one tap.
 *
 * The row is a set of chips pinned above the composer. Firing one sends its
 * prompt through the nudge path — a one-shot instruction for the next turn,
 * never a message — which is the whole reason this feature is storage plus a
 * row of buttons and nothing new behind the scenes. The edit chip opens the
 * sheet, which is the one place a reply is written, reordered or removed.
 */

/**
 * The composer row. A horizontally scrolling set of chips so a reader's whole
 * set stays one thumb-swipe away even at 390px. With none written, the row is
 * a single chip that opens the sheet — an empty state that offers the thing it
 * is empty of rather than disappearing.
 */
export function QuickReplyRow({
  onFire,
  onEdit,
  disabled,
}: {
  onFire(prompt: string): void;
  onEdit(): void;
  disabled: boolean;
}) {
  const replies = useQuickReplies();
  const list = replies.data ?? [];

  return (
    <div className="flex items-center gap-[6px] overflow-x-auto pb-[2px]">
      {list.map((reply) => (
        <button
          key={reply.id}
          type="button"
          disabled={disabled}
          onClick={() => onFire(reply.prompt)}
          title={reply.prompt}
          className="chrome tap flex flex-none items-center border border-border-quiet px-[9px] text-[12px] text-ink-label disabled:opacity-40"
        >
          {reply.label}
        </button>
      ))}
      <button
        type="button"
        onClick={onEdit}
        aria-label={strings.chat.quickRepliesEdit}
        title={strings.chat.quickRepliesEdit}
        className="chrome tap flex flex-none items-center border border-border-quiet px-[9px] text-[12px] text-ink-dim"
      >
        {list.length === 0 ? strings.chat.quickReplies : "✎"}
      </button>
    </div>
  );
}

/**
 * The management sheet. Two states, one sheet: the list, and the one-field
 * form a reply is written in. Editing in place rather than a second sheet —
 * a quick reply is two fields, and a sheet on a sheet is the depth this
 * feature does not earn.
 */
export function QuickReplySheet({ onClose }: { onClose(): void }) {
  const replies = useQuickReplies();
  const create = useCreateQuickReply();
  const update = useUpdateQuickReply();
  const remove = useDeleteQuickReply();
  const move = useMoveQuickReply();
  const [confirmNode, confirm] = useConfirm();
  /** Null is the new-reply form; a row is the edit form; undefined is the list. */
  const [editing, setEditing] = useState<QuickReplyDto | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const list = replies.data ?? [];

  const form = editing === undefined ? null : (
    <form
      className="pt-[8px] pb-[14px]"
      onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const label = String(fields.get("label") ?? "").trim();
        const prompt = String(fields.get("prompt") ?? "").trim();
        if (label === "" || prompt === "") return;
        const done = {
          onSuccess: () => setEditing(undefined),
          onError: (e: Error) => setError(e.message),
        };
        if (editing === null) create.mutate({ label, prompt }, done);
        else update.mutate({ id: editing.id, label, prompt }, done);
      }}
    >
      <p className="section-label mb-[6px]">{strings.chat.quickReplyLabel}</p>
      <input
        name="label"
        className="field mb-[14px]"
        defaultValue={editing?.label ?? ""}
        placeholder={strings.chat.quickReplyLabelPlaceholder}
        required
        maxLength={120}
      />

      <p className="section-label mb-[6px]">{strings.chat.quickReplyPrompt}</p>
      <textarea
        name="prompt"
        rows={3}
        className="field min-h-[72px] resize-none py-[10px]"
        defaultValue={editing?.prompt ?? ""}
        placeholder={strings.chat.quickReplyPromptPlaceholder}
        required
        maxLength={2000}
      />
      <p className="explain mt-[6px] mb-[14px]">
        {strings.chat.quickReplyPromptHint}
      </p>

      {error !== null ? <p className="explain explain-alert mb-[12px]">{error}</p> : null}

      <button type="submit" className="btn btn-primary w-full">
        {strings.chat.save}
      </button>
      <button type="button" className="btn mt-[8px] w-full" onClick={() => setEditing(undefined)}>
        {strings.common.cancel}
      </button>
      {confirmNode}
    </form>
  );

  return (
    <Sheet title={strings.chat.quickReplies} onClose={onClose}>
      {form !== null ? (
        form
      ) : (
        <>
          {list.length === 0 ? (
            <p className="meta py-[10px] leading-[1.5]">
              {strings.chat.quickRepliesEmpty}
            </p>
          ) : (
            list.map((reply) => (
              <div key={reply.id} className="row flex items-center gap-[6px]">
                <button
                  type="button"
                  onClick={() => setEditing(reply)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="chrome block truncate text-ui text-ink-label">
                    {reply.label}
                  </span>
                  <span className="meta block truncate">{reply.prompt}</span>
                </button>
                <button
                  type="button"
                  aria-label={strings.chat.quickReplyMoveUp}
                  title={strings.chat.quickReplyMoveUp}
                  onClick={() => move.mutate({ id: reply.id, direction: "up" })}
                  className="chrome flex-none px-[7px] py-[6px] text-[12px] text-ink-muted"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={strings.chat.quickReplyMoveDown}
                  title={strings.chat.quickReplyMoveDown}
                  onClick={() => move.mutate({ id: reply.id, direction: "down" })}
                  className="chrome flex-none px-[7px] py-[6px] text-[12px] text-ink-muted"
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={strings.chat.quickReplyDelete}
                  title={strings.chat.quickReplyDelete}
                  onClick={() =>
                    confirm(strings.chat.quickReplyDeleteConfirm, () => remove.mutate(reply.id), {
                      confirmLabel: strings.chat.quickReplyDelete,
                    })
                  }
                  className="chrome flex-none px-[7px] py-[6px] text-[12px] text-ink-muted"
                >
                  ×
                </button>
              </div>
            ))
          )}
          <button
            type="button"
            className="btn btn-primary mt-[14px] w-full"
            onClick={() => {
              setError(null);
              setEditing(null);
            }}
          >
            {strings.chat.quickReplyAdd}
          </button>
          {confirmNode}
        </>
      )}
    </Sheet>
  );
}
