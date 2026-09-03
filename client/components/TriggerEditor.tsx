import { useState } from "react";
import type { EventTriggerDto, TriggerAction, TriggerEvent } from "@shared/types.ts";
import { TRIGGER_ACTIONS, TRIGGER_EVENTS } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { Sheet } from "./Sheet.tsx";
import { useConfirm } from "./ConfirmSheet.tsx";
import {
  useCreateTrigger,
  useDeleteTrigger,
  useRunTrigger,
  useScenes,
  useTriggerActions,
  useUpdateTrigger,
} from "../lib/queries.ts";

/**
 * An event trigger (SPEC §14).
 *
 * The "which one" list comes from the server rather than being written out
 * here, because the set of scripts changes and a trigger pointing at a deleted
 * one is automation that silently never works. Offering only what exists is
 * cheaper than explaining afterwards why nothing happened.
 */
export function TriggerEditor({
  trigger,
  onClose,
}: {
  trigger: EventTriggerDto | null;
  onClose(): void;
}) {
  const create = useCreateTrigger();
  const update = useUpdateTrigger();
  const remove = useDeleteTrigger();
  const run = useRunTrigger();
  const options = useTriggerActions();
  const scenes = useScenes();
  const [confirmNode, confirm] = useConfirm();
  const [error, setError] = useState<string | null>(null);

  const [event, setEvent] = useState<TriggerEvent>(trigger?.event ?? "after_generation");
  const [action, setAction] = useState<TriggerAction>(trigger?.action ?? "guide");
  const [scope, setScope] = useState<"global" | "scene">(trigger?.scope ?? "global");
  const sceneList = scenes.data ?? [];
  const [runIn, setRunIn] = useState<string>(trigger?.sceneId ?? "");

  /**
   * What this action can point at. Named by the server, which knows what the
   * rest of the app calls a guide - the alternative is `situational` on screen
   * beside `Clothes` for the same kind of thing.
   */
  const refs = options.data?.[action] ?? [];

  return (
    <Sheet title={trigger === null ? strings.settings.addTrigger : trigger.name} onClose={onClose}>
      <form
        className="pt-[8px] pb-[14px]"
        onSubmit={(submitted) => {
          submitted.preventDefault();
          const form = new FormData(submitted.currentTarget);
          const name = String(form.get("name") ?? "").trim();
          const actionRef = String(form.get("actionRef") ?? "");
          const automationId = String(form.get("automationId") ?? "").trim();
          const sceneId = String(form.get("sceneId") ?? "");
          const done = { onSuccess: () => onClose(), onError: (e: Error) => setError(e.message) };

          if (trigger === null) {
            create.mutate(
              {
                name,
                event,
                action,
                actionRef,
                scope,
                ...(event === "lore_activation" ? { automationId } : {}),
                ...(scope === "scene" ? { sceneId } : {}),
              },
              done,
            );
          } else {
            // The event and the action decide which columns are legal, so
            // neither is editable: changing them is writing a different trigger.
            update.mutate(
              {
                id: trigger.id,
                name,
                actionRef,
                ...(trigger.event === "lore_activation" ? { automationId } : {}),
              },
              done,
            );
          }
        }}
      >
        <p className="section-label mb-[6px]">{strings.settings.triggerName}</p>
        <input name="name" className="field mb-[16px]" defaultValue={trigger?.name ?? ""} required />

        <p className="section-label mb-[6px]">{strings.settings.triggerEvent}</p>
        <select
          className="field mb-[16px]"
          value={event}
          disabled={trigger !== null}
          onChange={(changed) => setEvent(changed.target.value as TriggerEvent)}
        >
          {TRIGGER_EVENTS.map((value) => (
            <option key={value} value={value}>
              {strings.settings.eventLabel[value]}
            </option>
          ))}
        </select>

        {event === "lore_activation" ? (
          <>
            <p className="section-label mb-[6px]">{strings.settings.triggerAutomationId}</p>
            <input
              name="automationId"
              className="field font-mono text-[13px]"
              defaultValue={trigger?.automationId ?? ""}
              spellCheck={false}
              required
            />
            <p className="chrome mt-[7px] mb-[16px] text-[10px] leading-[1.6] text-ink-dim">
              {strings.settings.triggerAutomationIdHint}
            </p>
          </>
        ) : null}

        <p className="section-label mb-[6px]">{strings.settings.triggerAction}</p>
        <select
          className="field mb-[10px]"
          value={action}
          disabled={trigger !== null}
          onChange={(changed) => setAction(changed.target.value as TriggerAction)}
        >
          {TRIGGER_ACTIONS.map((value) => (
            <option key={value} value={value}>
              {strings.settings.actionLabel[value]}
            </option>
          ))}
        </select>

        <p className="section-label mb-[6px]">{strings.settings.triggerActionRef}</p>
        <select name="actionRef" className="field mb-[16px]" defaultValue={trigger?.actionRef ?? ""}>
          {refs.map((ref) => (
            <option key={ref.value} value={ref.value}>
              {ref.label}
            </option>
          ))}
        </select>

        {trigger === null ? (
          <>
            <p className="section-label mb-[6px]">{strings.settings.scriptScope}</p>
            <select
              className="field mb-[10px]"
              value={scope}
              onChange={(changed) => setScope(changed.target.value as "global" | "scene")}
            >
              <option value="global">{strings.settings.scopeLabel["global"]}</option>
              <option value="scene">{strings.settings.scopeLabel["scene"]}</option>
            </select>
            {scope === "scene" ? (
              <select name="sceneId" className="field mb-[16px]" required>
                {sceneList.map((scene) => (
                  <option key={scene.id} value={scene.id}>
                    {scene.title}
                  </option>
                ))}
              </select>
            ) : null}
          </>
        ) : null}

        {error !== null ? (
          <p className="chrome mb-[12px] text-[10px] leading-[1.6] text-red-text">{error}</p>
        ) : null}

        <button type="submit" className="btn btn-primary w-full">
          {strings.settings.save}
        </button>
        {trigger !== null ? (
          <button
            type="button"
            className="btn mt-[8px] w-full"
            onClick={() =>
              confirm(
                strings.settings.triggerDeleteConfirm,
                () => remove.mutate(trigger.id, { onSuccess: () => onClose() }),
                { confirmLabel: strings.settings.triggerDelete },
              )
            }
          >
            {strings.settings.triggerDelete}
          </button>
        ) : null}
      </form>

      {/* A trigger bound to a lore entry may not fire for days, and "did I wire
          this up correctly" should not be a question only the scene can answer. */}
      {trigger !== null ? (
        <div className="border-t border-rule pt-[14px] pb-[10px]">
          <p className="section-label mb-[4px]">{strings.settings.triggerRun}</p>
          <p className="chrome mb-[10px] text-[10px] leading-[1.6] text-ink-dim">
            {strings.settings.triggerRunHint}
          </p>
          <select
            className="field"
            value={runIn}
            onChange={(changed) => setRunIn(changed.target.value)}
          >
            <option value="">—</option>
            {sceneList.map((scene) => (
              <option key={scene.id} value={scene.id}>
                {scene.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn mt-[10px] w-full"
            disabled={runIn === "" || run.isPending}
            onClick={() => run.mutate({ id: trigger.id, sceneId: runIn })}
          >
            {strings.settings.triggerRun}
          </button>
          {run.data !== undefined ? (
            <p className="chrome mt-[10px] text-[10px] leading-[1.6] text-ink-dim">
              {run.data.detail}
            </p>
          ) : null}
          {run.error !== null ? (
            <p className="chrome mt-[10px] text-[10px] leading-[1.6] text-red-text">
              {run.error.message}
            </p>
          ) : null}
        </div>
      ) : null}
      {confirmNode}
    </Sheet>
  );
}
