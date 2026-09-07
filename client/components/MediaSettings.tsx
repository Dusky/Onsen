import { useState } from "react";
import type { MediaKindDto, MediaServiceDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { Sheet } from "./Sheet.tsx";
import { useConfirm } from "./ConfirmSheet.tsx";
import {
  useComfyuiModels,
  useCreateMediaService,
  useDeleteMediaService,
  useMediaKinds,
  useMediaServices,
  useUpdateMediaService,
} from "../lib/queries.ts";

/**
 * Where pictures and voices come from (SPEC §20 phase 41).
 *
 * Two lists rather than one, because "what draws" and "what speaks" are
 * separate choices with separate defaults — the same reason the table carries a
 * purpose and a default per purpose rather than one flag overall.
 *
 * The kind labels come from the server. Four phases running, a raw enum reached
 * a screen; a list that had to know what `a1111` is called would be the fifth.
 */

export function MediaSettings() {
  const services = useMediaServices();
  const kinds = useMediaKinds();
  const [editing, setEditing] = useState<MediaServiceDto | null>(null);
  const [adding, setAdding] = useState<"image" | "speech" | null>(null);

  const all = services.data?.services ?? [];
  const available = kinds.data?.kinds ?? [];

  return (
    <>
      {(["image", "speech"] as const).map((purpose) => {
        const mine = all.filter((service) => service.purpose === purpose);
        return (
          <div key={purpose} className="mb-[22px]">
            <p className="section-label mb-[8px]">
              {purpose === "image" ? strings.media.imageSection : strings.media.speechSection}
            </p>

            {mine.length === 0 ? (
              <p className="explain mb-[10px]">
                {purpose === "image"
                  ? strings.media.noImageService
                  : strings.media.noSpeechService}
              </p>
            ) : (
              mine.map((service) => (
                <button
                  key={service.id}
                  type="button"
                  onClick={() => setEditing(service)}
                  className="flex w-full items-baseline gap-[10px] border-b border-rule py-[12px] text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{service.name}</span>
                    <span className="meta mt-[4px] block truncate">
                      {[service.kindLabel, service.model ?? null]
                        .filter((part): part is string => part !== null)
                        .join(" · ")}
                    </span>
                  </span>
                  {/* The one in use is marked in red: it is what happens now. */}
                  {service.isDefault ? (
                    <span
                      className="chrome flex-none text-[12px]"
                      style={{ color: "var(--onsen-color-red)" }}
                    >
                      {strings.media.serviceIsDefault}
                    </span>
                  ) : null}
                  {service.enabled ? null : (
                    <span className="chrome flex-none text-[12px] text-ink-dim">
                      {strings.media.serviceOff}
                    </span>
                  )}
                </button>
              ))
            )}

            <button
              type="button"
              className="btn mt-[10px] w-full"
              onClick={() => setAdding(purpose)}
            >
              {purpose === "image" ? strings.media.addImage : strings.media.addSpeech}
            </button>
          </div>
        );
      })}

      {adding !== null ? (
        <ServiceEditor
          purpose={adding}
          kinds={available.filter((kind) => kind.purpose === adding)}
          service={null}
          onClose={() => setAdding(null)}
        />
      ) : null}
      {editing !== null ? (
        <ServiceEditor
          purpose={editing.purpose}
          kinds={available.filter((kind) => kind.purpose === editing.purpose)}
          service={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function ServiceEditor({
  purpose,
  kinds,
  service,
  onClose,
}: {
  purpose: "image" | "speech";
  kinds: MediaKindDto[];
  service: MediaServiceDto | null;
  onClose(): void;
}) {
  const create = useCreateMediaService();
  const update = useUpdateMediaService();
  const remove = useDeleteMediaService();
  const [confirmNode, confirm] = useConfirm();
  // Which kind is selected drives the placeholder and whether a key is even
  // asked for, so it is state rather than something read at submit.
  const [kind, setKind] = useState(service?.kind ?? kinds[0]?.kind ?? "openai");
  const chosen = kinds.find((candidate) => candidate.kind === kind) ?? kinds[0];

  return (
    <Sheet
      title={service?.name ?? (purpose === "image" ? strings.media.addImage : strings.media.addSpeech)}
      onClose={onClose}
    >
      <form
        className="pt-[8px] pb-[14px]"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const apiKey = String(form.get("apiKey") ?? "");
          const workflow = String(form.get("workflow") ?? "").trim();
          const body = {
            name: String(form.get("name") ?? "").trim(),
            baseUrl: String(form.get("baseUrl") ?? "").trim(),
            model: String(form.get("model") ?? "").trim(),
            // Blank leaves the stored key alone. A form that came back empty
            // must not delete a credential nobody touched (§17).
            ...(apiKey === "" ? {} : { apiKey }),
            // The workflow is the one option the ComfyUI kind carries.
            ...((service?.kind ?? kind) === "comfyui" ? { options: { workflow } } : {}),
          };
          if (service === null) {
            create.mutate({ ...body, purpose, kind }, { onSuccess: () => onClose() });
          } else {
            update.mutate({ id: service.id, ...body }, { onSuccess: () => onClose() });
          }
        }}
      >
        {service === null ? (
          <>
            <p className="section-label mb-[6px]">{strings.media.serviceKind}</p>
            <select
              name="kind"
              className="field mb-[6px]"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              {kinds.map((candidate) => (
                <option key={candidate.kind} value={candidate.kind}>
                  {candidate.label}
                </option>
              ))}
            </select>
            <p className="explain mt-[6px] mb-[14px]">
              {chosen?.hint ?? ""}
            </p>
          </>
        ) : null}

        <p className="section-label mb-[6px]">{strings.media.serviceName}</p>
        <input
          name="name"
          className="field mb-[14px]"
          defaultValue={service?.name ?? chosen?.label ?? ""}
          required
        />

        <p className="section-label mb-[6px]">{strings.media.serviceUrl}</p>
        <input
          name="baseUrl"
          className="field mb-[14px]"
          placeholder={chosen?.defaultBaseUrl ?? ""}
          defaultValue={service?.baseUrl ?? chosen?.defaultBaseUrl ?? ""}
        />

        {(service?.kind ?? kind) === "comfyui" ? (
          service === null ? (
            <>
              <p className="section-label mb-[6px]">{strings.media.serviceModel}</p>
              <p className="explain">{strings.media.comfyuiModelSaveFirst}</p>
            </>
          ) : (
            <ComfyuiModelField service={service} />
          )
        ) : (
          <>
            <p className="section-label mb-[6px]">{strings.media.serviceModel}</p>
            <input name="model" className="field" defaultValue={service?.model ?? ""} />
          </>
        )}

        <p className="section-label mb-[6px]">{strings.media.serviceKey}</p>
        <input name="apiKey" type="password" className="field" autoComplete="off" />
        <p className="explain mt-[6px] mb-[16px]">
          {service?.hasApiKey === true
            ? strings.media.serviceKeyKept(service.apiKeyMask ?? "")
            : chosen?.needsKey === true
              ? ""
              : strings.media.serviceKeyNotNeeded}
        </p>

        {(service?.kind ?? kind) === "comfyui" ? (
          <>
            <p className="section-label mb-[6px]">{strings.media.workflow}</p>
            <textarea
              name="workflow"
              rows={8}
              className="field chrome mb-[6px] resize-y text-[12px] leading-[1.6]"
              defaultValue={
                typeof service?.options["workflow"] === "string"
                  ? service.options["workflow"]
                  : ""
              }
              placeholder={strings.media.workflowPlaceholder}
              spellCheck={false}
            />
            <p className="explain mb-[16px]">{strings.media.workflowHint}</p>
          </>
        ) : null}

        <button type="submit" className="btn btn-primary w-full">
          {strings.media.save}
        </button>

        {service === null ? null : (
          <>
            {service.isDefault ? null : (
              <button
                type="button"
                className="btn mt-[8px] w-full"
                onClick={() =>
                  update.mutate({ id: service.id, isDefault: true }, { onSuccess: () => onClose() })
                }
              >
                {strings.media.serviceDefault}
              </button>
            )}
            {/* Says what pressing it does, not what the service currently is.
                A button labelled with its own state reads as a status line
                nobody can act on — the third time that has come up. */}
            <button
              type="button"
              className="btn mt-[8px] w-full"
              onClick={() => update.mutate({ id: service.id, enabled: !service.enabled })}
            >
              {service.enabled ? strings.media.serviceDisable : strings.media.serviceEnable}
            </button>
            <button
              type="button"
              className="btn mt-[8px] w-full"
              style={{
                color: "var(--onsen-color-red)",
                borderColor: "var(--onsen-color-red-border)",
              }}
              onClick={() =>
                confirm(
                  strings.media.serviceDeleteConfirm(service.name),
                  () => remove.mutate(service.id, { onSuccess: () => onClose() }),
                  { confirmLabel: strings.media.serviceDelete },
                )
              }
            >
              {strings.media.serviceDelete}
            </button>
          </>
        )}
      </form>
      {confirmNode}
    </Sheet>
  );
}

/** The checkpoint selector for a saved ComfyUI service (§20 phase 102). */
function ComfyuiModelField({ service }: { service: MediaServiceDto }) {
  const models = useComfyuiModels(service.id);
  const list = models.data?.models ?? [];

  if (models.isError) {
    return (
      <>
        <p className="section-label mb-[6px]">{strings.media.serviceModel}</p>
        <p className="explain explain-alert mb-[6px]">{strings.media.comfyuiModelsFailed}</p>
        <input
          name="model"
          className="field"
          defaultValue={service.model ?? ""}
          placeholder={strings.media.comfyuiModelManual}
        />
      </>
    );
  }

  if (list.length === 0) {
    return (
      <>
        <p className="section-label mb-[6px]">{strings.media.serviceModel}</p>
        <p className="explain mb-[6px]">
          {models.isFetching ? strings.common.working : strings.media.comfyuiModelsNone}
        </p>
        <input
          name="model"
          className="field"
          defaultValue={service.model ?? ""}
          placeholder={strings.media.comfyuiModelManual}
        />
      </>
    );
  }

  return (
    <>
      <p className="section-label mb-[6px]">{strings.media.serviceModel}</p>
      <select name="model" className="field" defaultValue={service.model ?? ""}>
        <option value="">{strings.media.serviceModelNone}</option>
        {service.model !== null && !list.includes(service.model) ? (
          <option value={service.model}>{service.model}</option>
        ) : null}
        {list.map((model) => (
          <option key={model} value={model}>
            {model}
          </option>
        ))}
      </select>
    </>
  );
}
