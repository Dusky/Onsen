import { useState } from "react";
import type { SceneDto, WebhookDto, WebhookEvent } from "@shared/types.ts";
import { WEBHOOK_EVENTS } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { Sheet } from "./Sheet.tsx";
import { useConfirm } from "./ConfirmSheet.tsx";
import {
  useCreateWebhook,
  useDeleteWebhook,
  useRotateWebhookSecret,
  useScenes,
  useTestWebhook,
  useUpdateWebhook,
} from "../lib/queries.ts";

/**
 * A webhook subscription (SPEC §15).
 *
 * The signing key is shown once, on the sheet that created it, and never
 * again — the server does not have it in a form it could return. So the sheet
 * has two states: the form, and the one screen where the key exists.
 */
export function WebhookEditor({
  webhook,
  scenes,
  onClose,
}: {
  webhook: WebhookDto | null;
  scenes: SceneDto[];
  onClose(): void;
}) {
  const create = useCreateWebhook();
  const update = useUpdateWebhook();
  const remove = useDeleteWebhook();
  const rotate = useRotateWebhookSecret();
  const test = useTestWebhook();
  const [confirmNode, confirm] = useConfirm();

  const [events, setEvents] = useState<Set<WebhookEvent>>(
    new Set(webhook?.events ?? ["message.created"]),
  );
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The one screen the key exists on. Nothing else can bring it back.
  if (secret !== null) {
    return (
      <Sheet title={strings.settings.webhookSecret} onClose={onClose}>
        <div className="pt-[8px] pb-[14px]">
          <p className="explain mb-[12px]">
            {strings.settings.webhookSecretHint}
          </p>
          <p className="mb-[16px] font-mono text-[12px] leading-[1.7] break-all select-all">
            {secret}
          </p>
          <button type="button" className="btn btn-primary w-full" onClick={onClose}>
            {strings.settings.webhookSecretDone}
          </button>
        </div>
      </Sheet>
    );
  }

  function toggle(event: WebhookEvent) {
    setEvents((current) => {
      const next = new Set(current);
      if (next.has(event)) next.delete(event);
      else next.add(event);
      return next;
    });
  }

  return (
    <Sheet
      title={webhook === null ? strings.settings.addWebhook : webhook.name}
      onClose={onClose}
    >
      <form
        className="pt-[8px] pb-[14px]"
        onSubmit={(submitted) => {
          submitted.preventDefault();
          const form = new FormData(submitted.currentTarget);
          const name = String(form.get("name") ?? "").trim();
          const url = String(form.get("url") ?? "").trim();
          const sceneId = String(form.get("sceneId") ?? "");
          const chosen = [...events];
          const failed = { onError: (caught: Error) => setError(caught.message) };

          if (webhook === null) {
            create.mutate(
              { name, url, events: chosen, ...(sceneId === "" ? {} : { sceneId }) },
              { ...failed, onSuccess: (made) => setSecret(made.secret) },
            );
          } else {
            update.mutate(
              { id: webhook.id, name, url, events: chosen },
              { ...failed, onSuccess: () => onClose() },
            );
          }
        }}
      >
        <p className="section-label mb-[6px]">{strings.settings.webhookName}</p>
        <input name="name" className="field mb-[16px]" defaultValue={webhook?.name ?? ""} required />

        <p className="section-label mb-[6px]">{strings.settings.webhookUrl}</p>
        <input
          name="url"
          className="field font-mono text-[13px]"
          defaultValue={webhook?.url ?? ""}
          spellCheck={false}
          required
        />
        <p className="explain mt-[7px] mb-[16px]">
          {strings.settings.webhookUrlHint}
        </p>

        <p className="section-label mb-[8px]">{strings.settings.webhookEvents}</p>
        {WEBHOOK_EVENTS.map((event) => (
          <label
            key={event}
            className="flex min-h-[var(--onsen-tap-target)] items-center gap-[10px] border-b border-rule"
          >
            <input type="checkbox" checked={events.has(event)} onChange={() => toggle(event)} />
            <span className="min-w-0 flex-1 text-[14px]">{strings.settings.eventName[event]}</span>
          </label>
        ))}

        {/* The scope is fixed after creation: it decides which scene's events
            this ever hears, and changing it silently would make an existing
            delivery log describe a different subscription. */}
        {webhook === null ? (
          <>
            <p className="section-label mt-[18px] mb-[6px]">{strings.settings.webhookScope}</p>
            <select name="sceneId" className="field mb-[16px]" defaultValue="">
              <option value="">{strings.settings.webhookAllScenes}</option>
              {scenes.map((scene) => (
                <option key={scene.id} value={scene.id}>
                  {scene.title}
                </option>
              ))}
            </select>
          </>
        ) : (
          <div className="mb-[16px]" />
        )}

        {error !== null ? (
          <p className="explain explain-alert mb-[12px]">{error}</p>
        ) : null}

        <button
          type="submit"
          className="btn btn-primary w-full"
          disabled={events.size === 0}
        >
          {strings.settings.save}
        </button>
      </form>

      {webhook !== null ? (
        <div className="border-t border-rule pt-[14px] pb-[10px]">
          <button
            type="button"
            className="btn w-full"
            disabled={test.isPending}
            onClick={() => test.mutate(webhook.id)}
          >
            {test.isPending ? strings.settings.webhookTesting : strings.settings.webhookTest}
          </button>
          {test.data !== undefined ? (
            <p className="explain mt-[10px]">
              {test.data.ok
                ? strings.settings.webhookTestOk(test.data.status)
                : `${strings.settings.webhookTestFail} — ${test.data.detail ?? ""}`}
            </p>
          ) : null}

          <button
            type="button"
            className="btn mt-[8px] w-full"
            onClick={() =>
              confirm(
                strings.settings.webhookRotateHint,
                () =>
                  rotate.mutate(webhook.id, {
                    onSuccess: (made) => setSecret(made.secret),
                  }),
                { confirmLabel: strings.settings.webhookRotate },
              )
            }
          >
            {strings.settings.webhookRotate}
          </button>

          <button
            type="button"
            className="btn mt-[8px] w-full"
            onClick={() =>
              update.mutate({ id: webhook.id, enabled: !webhook.enabled }, { onSuccess: onClose })
            }
          >
            {webhook.enabled ? strings.settings.webhookOff : strings.settings.webhookOn}
          </button>

          <button
            type="button"
            className="btn mt-[8px] w-full"
            onClick={() =>
              confirm(
                strings.settings.webhookDeleteConfirm,
                () => remove.mutate(webhook.id, { onSuccess: () => onClose() }),
                { confirmLabel: strings.settings.webhookDelete },
              )
            }
          >
            {strings.settings.webhookDelete}
          </button>

          {/* The log is why this screen exists: a webhook is the one feature
              whose failures happen entirely off-screen. */}
          <p className="section-label mt-[20px] mb-[8px]">
            {strings.settings.webhookDeliveries}
          </p>
          {webhook.deliveries.length === 0 ? (
            <p className="explain">
              {strings.settings.webhookNoDeliveries}
            </p>
          ) : (
            webhook.deliveries.map((delivery, index) => (
              <div key={`${delivery.at}-${index}`} className="border-b border-rule py-[8px]">
                <div className="flex items-baseline justify-between gap-[10px]">
                  <span className="chrome min-w-0 flex-1 truncate text-[9.5px] tracking-[0.06em] text-ink-dim uppercase">
                    {strings.settings.eventName[delivery.event] ?? delivery.event}
                  </span>
                  <span
                    className="chrome flex-none text-[9.5px] tracking-[0.06em] uppercase"
                    style={
                      delivery.status === "failed"
                        ? { color: "var(--onsen-color-red)" }
                        : undefined
                    }
                  >
                    {strings.settings.webhookDelivery(delivery.status, delivery.responseCode)}
                  </span>
                </div>
                {delivery.detail !== null ? (
                  <p className="chrome mt-[3px] truncate text-[9.5px] text-ink-dim">
                    {delivery.detail}
                  </p>
                ) : null}
              </div>
            ))
          )}
        </div>
      ) : null}
      {confirmNode}
    </Sheet>
  );
}
