import { useState } from "react";
import type { ApiKeyDto, SceneDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { Sheet } from "./Sheet.tsx";
import { useConfirm } from "./ConfirmSheet.tsx";
import { useCreateApiKey, useDeleteApiKey, useRevokeApiKey } from "../lib/queries.ts";

/**
 * A bearer key for §19's outbound API.
 *
 * Two states, because the token has two: the form, and the one screen where the
 * key exists. The column holds a hash, so there is no path in this app that
 * could show it again.
 */
export function ApiKeyEditor({
  apiKey,
  scenes,
  onClose,
}: {
  apiKey: ApiKeyDto | null;
  scenes: SceneDto[];
  onClose(): void;
}) {
  const create = useCreateApiKey();
  const revoke = useRevokeApiKey();
  const remove = useDeleteApiKey();
  const [confirmNode, confirm] = useConfirm();
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (token !== null) {
    return (
      <Sheet title={strings.settings.apiKeyToken} onClose={onClose}>
        <div className="pt-[8px] pb-[14px]">
          <p className="explain mb-[12px]">
            {strings.settings.apiKeyTokenHint}
          </p>
          <p className="mb-[16px] font-mono text-[12px] leading-[1.7] break-all select-all">
            {token}
          </p>
          <button type="button" className="btn btn-primary w-full" onClick={onClose}>
            {strings.settings.apiKeyTokenDone}
          </button>
        </div>
      </Sheet>
    );
  }

  if (apiKey === null) {
    return (
      <Sheet title={strings.settings.addApiKey} onClose={onClose}>
        <form
          className="pt-[8px] pb-[14px]"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const sceneId = String(form.get("sceneId") ?? "");
            create.mutate(
              {
                name: String(form.get("name") ?? "").trim(),
                ...(sceneId === "" ? {} : { sceneId }),
              },
              {
                onSuccess: (made) => setToken(made.token),
                onError: (caught: Error) => setError(caught.message),
              },
            );
          }}
        >
          <p className="section-label mb-[6px]">{strings.settings.apiKeyName}</p>
          <input name="name" className="field mb-[16px]" required />

          <p className="section-label mb-[6px]">{strings.settings.apiKeyScope}</p>
          <select name="sceneId" className="field mb-[16px]" defaultValue="">
            <option value="">{strings.settings.apiKeyAllScenes}</option>
            {scenes.map((scene) => (
              <option key={scene.id} value={scene.id}>
                {scene.title}
              </option>
            ))}
          </select>

          {error !== null ? (
            <p className="explain explain-alert mb-[12px]">{error}</p>
          ) : null}
          <button type="submit" className="btn btn-primary w-full">
            {strings.settings.addApiKey}
          </button>
        </form>
      </Sheet>
    );
  }

  return (
    <Sheet title={apiKey.name} meta={apiKey.hint} onClose={onClose}>
      <div className="pt-[8px] pb-[14px]">
        <p className="explain mb-[16px]">
          {[
            apiKey.sceneTitle ?? strings.settings.apiKeyAllScenes,
            apiKey.uses === 0
              ? strings.settings.apiKeyUnused
              : strings.settings.apiKeyUses(apiKey.uses),
            apiKey.revoked ? strings.settings.apiKeyRevoked : null,
          ]
            .filter((part) => part !== null)
            .join(" · ")}
        </p>

        {apiKey.revoked ? null : (
          <button
            type="button"
            className="btn mb-[8px] w-full"
            onClick={() =>
              confirm(
                strings.settings.apiKeyRevokeConfirm,
                () => revoke.mutate(apiKey.id, { onSuccess: () => onClose() }),
                { confirmLabel: strings.settings.apiKeyRevoke },
              )
            }
          >
            {strings.settings.apiKeyRevoke}
          </button>
        )}
        <button
          type="button"
          className="btn w-full"
          onClick={() =>
            confirm(
              strings.settings.apiKeyDeleteConfirm,
              () => remove.mutate(apiKey.id, { onSuccess: () => onClose() }),
              { confirmLabel: strings.settings.apiKeyDelete },
            )
          }
        >
          {strings.settings.apiKeyDelete}
        </button>

        {/* The log is where a client's mistakes become visible — including the
            one §19 is most worried about, a frontend that assembled its own
            character card before calling. */}
        <p className="section-label mt-[20px] mb-[8px]">{strings.settings.apiKeyRequests}</p>
        {apiKey.requests.length === 0 ? (
          <p className="explain">
            {strings.settings.apiKeyNoRequests}
          </p>
        ) : (
          apiKey.requests.map((request, index) => (
            <div key={`${request.at}-${index}`} className="border-b border-rule py-[8px]">
              <div className="flex items-baseline justify-between gap-[10px]">
                <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                  {request.model}
                </span>
                <span
                  className="chrome flex-none text-[9.5px] tracking-[0.06em] uppercase"
                  style={
                    request.status >= 400 ? { color: "var(--onsen-color-red)" } : undefined
                  }
                >
                  {request.status}
                </span>
              </div>
              {request.warning !== null ? (
                <p className="explain mt-[3px]">
                  {strings.settings.apiKeyWarned}
                </p>
              ) : null}
            </div>
          ))
        )}
      </div>
      {confirmNode}
    </Sheet>
  );
}
