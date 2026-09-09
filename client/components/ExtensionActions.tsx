import { useState } from "react";
import { useExtensionActions, useRunExtensionAction } from "../lib/queries.ts";
import { Sheet } from "./Sheet.tsx";
import { strings } from "../strings.ts";

/**
 * Extension actions (SPEC §15, §20 phase 148).
 *
 * The buttons enabled extensions offer near the input. Pressing one runs the
 * action against the scene and shows what the model answered. The host renders
 * the menu; the extension only declared what to call each entry and what to do
 * with the answer.
 */

export function ExtensionActionsSheet({ sceneId, onClose }: { sceneId: string; onClose(): void }) {
  const actions = useExtensionActions();
  const run = useRunExtensionAction(sceneId);
  const [result, setResult] = useState<string | null>(null);

  const list = actions.data ?? [];

  return (
    <Sheet title={strings.chat.extensionActions} onClose={onClose}>
      <div className="pt-[8px] pb-[14px]">
        {list.length === 0 ? (
          <p className="chrome text-[13px] leading-[1.6] text-ink-dim">
            {strings.chat.extensionActionsNone}
          </p>
        ) : (
          list.map((action) => (
            <button
              key={action.key}
              type="button"
              className="row flex w-full items-baseline gap-[9px] text-left"
              disabled={run.isPending}
              onClick={() => {
                setResult(null);
                run.mutate(action.key, { onSuccess: (data) => setResult(data.text) });
              }}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">{action.label}</span>
                {action.description === null || action.description === "" ? null : (
                  <span className="chrome block truncate text-[12.5px] text-ink-dim">
                    {action.description}
                  </span>
                )}
              </span>
              <span className="chrome flex-none self-center text-[12px] text-ink-dim">
                {run.isPending && run.variables === action.key ? strings.chat.memoryWorking : "›"}
              </span>
            </button>
          ))
        )}
        {result === null ? null : (
          <p className="chrome mt-[12px] whitespace-pre-wrap border-t border-rule pt-[12px] text-[12.5px] leading-[1.6] text-ink-dim">
            {result}
          </p>
        )}
      </div>
    </Sheet>
  );
}

/** The trigger button, so a phone drawer and the wide Direct row share it. */
export function ExtensionActionsButton({
  sceneId,
  wide = false,
}: {
  sceneId: string;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={strings.chat.extensionActions}
        className={
          wide
            ? "chrome h-[34px] flex-none border border-border-quiet px-[10px] text-[12px] text-ink-muted"
            : "btn flex-none px-[12px]"
        }
      >
        {strings.chat.extensionActionsShort}
      </button>
      {open ? <ExtensionActionsSheet sceneId={sceneId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
