import type { MessageDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { Sheet } from "./Sheet.tsx";
import { useConfirm } from "./ConfirmSheet.tsx";
import {
  useCheckpoints,
  useCreateCheckpoint,
  useDeleteCheckpoint,
  useRestoreCheckpoint,
} from "../lib/queries.ts";

/**
 * Named places in the tree (SPEC §2).
 *
 * The server half has existed since phase 2 and nothing ever called it — the
 * same failure `scenario_override` had, which §10 records as surviving
 * seventeen migrations unwired.
 *
 * A branch and a mark are not the same thing, which is why a tree alone does
 * not cover this. A branch is where the story went; a mark is somewhere you
 * decided you might want to come back to, named while you still remember why.
 * Going back to one moves where the next line attaches and destroys nothing.
 */

/** What the sheet header shows while the name is being typed. */
function excerptOf(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length <= 60 ? flat : `${flat.slice(0, 59)}…`;
}

export function MarkSheet({
  sceneId,
  message,
  onClose,
}: {
  sceneId: string;
  message: MessageDto;
  onClose(): void;
}) {
  const create = useCreateCheckpoint(sceneId);
  return (
    <Sheet title={strings.chat.checkpoint} meta={excerptOf(message.content)} onClose={onClose}>
      <form
        className="pt-[8px] pb-[14px]"
        onSubmit={(event) => {
          event.preventDefault();
          const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
          if (name === "") return;
          create.mutate({ name, messageId: message.id }, { onSuccess: () => onClose() });
        }}
      >
        <p className="section-label mb-[6px]">{strings.chat.checkpointName}</p>
        <input
          name="name"
          className="field mb-[8px]"
          placeholder={strings.chat.checkpointNamePlaceholder}
          autoFocus
          required
          maxLength={120}
        />
        <p className="explain mb-[16px]">
          {strings.chat.checkpointsHint}
        </p>
        <button type="submit" className="btn btn-primary w-full">
          {strings.chat.checkpointSave}
        </button>
      </form>
    </Sheet>
  );
}

export function CheckpointsSheet({
  sceneId,
  onClose,
}: {
  sceneId: string;
  onClose(): void;
}) {
  const checkpoints = useCheckpoints(sceneId);
  const restore = useRestoreCheckpoint(sceneId);
  const remove = useDeleteCheckpoint(sceneId);
  const [confirmNode, confirm] = useConfirm();

  const marks = checkpoints.data ?? [];

  return (
    <Sheet title={strings.chat.checkpoints} onClose={onClose}>
      <div className="pt-[8px] pb-[14px]">
        {marks.length === 0 ? (
          <p className="explain mb-[10px]">
            {strings.chat.checkpointsEmpty}
          </p>
        ) : (
          marks.map((mark) => (
            <div key={mark.id} className="border-b border-rule py-[12px]">
              <p className="text-[15px] font-medium">{mark.name}</p>
              {/* Which message, not just what it was called. Two marks with the
                  same name are otherwise indistinguishable, which is what a
                  list of six identical rows looked like. */}
              {mark.excerpt === null ? null : (
                <p className="mt-[3px] line-clamp-2 text-[13px] leading-[1.5] text-ink-prose-muted">
                  {mark.excerpt}
                </p>
              )}
              <div className="mt-[8px] flex gap-[8px]">
                <button
                  type="button"
                  className="btn flex-1"
                  disabled={restore.isPending}
                  onClick={() => restore.mutate(mark.id, { onSuccess: () => onClose() })}
                >
                  {strings.chat.checkpointGo}
                </button>
                <button
                  type="button"
                  className="btn flex-none"
                  style={{
                    color: "var(--onsen-color-red)",
                    borderColor: "var(--onsen-color-red-border)",
                  }}
                  onClick={() =>
                    confirm(
                      strings.chat.checkpointForgetConfirm(mark.name),
                      () => remove.mutate(mark.id),
                      { confirmLabel: strings.chat.checkpointForget },
                    )
                  }
                >
                  {strings.chat.checkpointForget}
                </button>
              </div>
            </div>
          ))
        )}
        <p className="explain mt-[12px]">
          {strings.chat.checkpointsHint}
        </p>
      </div>
      {confirmNode}
    </Sheet>
  );
}
