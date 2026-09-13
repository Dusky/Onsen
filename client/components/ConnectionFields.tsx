import { useRef, useState, type ReactNode } from "react";
import type { ConnectionProfileDto, ProviderDto } from "@shared/types.ts";
import { PROVIDER_KINDS, type ProviderKind } from "@shared/types.ts";
import { strings } from "../strings.ts";
import {
  useCreateProfile,
  useCreateProvider,
  useDeleteProfile,
  useDeleteProvider,
  useTestConnection,
  useUpdateProfile,
  useUpdateProvider,
  usePresets,
} from "../lib/queries.ts";
import { useConfirm } from "./ConfirmSheet.tsx";
import { InstructPicker } from "./InstructPicker.tsx";
import { ModelPicker } from "./ModelPicker.tsx";
import { Sheet } from "./Sheet.tsx";

/**
 * The provider and connection-profile forms (§16, §20 phases 72, 178).
 *
 * Lifted out of `SettingsScreen.tsx` by phase 178, which put the same two
 * lists in a rail panel: a credential form is the last thing that should exist
 * twice, and the settings screen was 2471 lines with these 480 inside it. The
 * same move `Segmented` made in phase 166, for the same reason — a second host
 * needs it and a circular import is the alternative.
 *
 * Each form is shared by three hosts now: the settings screen's inline
 * expansion on a desktop, its sheet on a phone, and `ModelsPanel`'s rows in a
 * rail. One editor, so the three cannot drift.
 */

export function Row({ children }: { children: React.ReactNode }) {
  return <div className="row">{children}</div>;
}

/**
 * A provider kind as a person would say it. The column stores an enum and it
 * was reaching the screen as `OPENAI_COMPATIBLE`.
 */
export function kindLabel(kind: ProviderKind): string {
  switch (kind) {
    case "openai_compatible":
      return "OpenAI-compatible";
    case "anthropic":
      return "Anthropic";
    case "text_completion":
      return "Text completion";
  }
}

export function statusDot(ok: boolean) {
  return (
    <span
      className="mt-[5px] inline-block h-[7px] w-[7px] flex-none"
      style={{
        background: ok ? "var(--onsen-color-green)" : "var(--onsen-color-text-dim)",
      }}
    />
  );
}

/**
 * Save, and Remove where there is something to remove (§20 phase 178).
 *
 * Sticky, and the reason is a measurement: the provider form is 606px tall,
 * and in a 950px window its bottom sat at 998px — Save was below the fold on
 * a desktop, before a rail 326px wide made it worse. A form whose commit
 * button has to be hunted for is a form people abandon half-filled.
 *
 * `bottom: -1px` and a matching negative margin so the row sits flush against
 * the bottom edge of whatever scrolls it, with the panel's own ground behind
 * it rather than a translucent strip showing the fields sliding under.
 */
function ActionRow({
  onRemove,
  children,
}: {
  onRemove: (() => void) | null;
  /** Anything between Save and Remove — the profile form's "make default". */
  children?: ReactNode;
}) {
  return (
    <div
      className="sticky bottom-[-1px] -mx-[2px] flex flex-wrap gap-[8px] px-[2px] pt-[10px] pb-[2px]"
      style={{ background: "var(--onsen-color-bg-raised)" }}
    >
      <button type="submit" className="btn btn-primary flex-1">
        {strings.settings.save}
      </button>
      {children}
      {onRemove === null ? null : (
        <button type="button" className="btn" onClick={onRemove}>
          {strings.settings.remove}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Providers                                                           */
/* ------------------------------------------------------------------ */

export function ProviderEditor({
  provider,
  onClose,
}: {
  provider: ProviderDto | null;
  onClose(): void;
}) {
  return (
    <Sheet
      title={provider === null ? strings.settings.addProvider : provider.name}
      onClose={onClose}
    >
      <div className="pt-[8px] pb-[14px]">
        <ProviderFields provider={provider} onClose={onClose} />
      </div>
    </Sheet>
  );
}

/**
 * The provider's form, shared by the desktop's inline expansion and the
 * phone's sheet, so the two cannot drift into different editors (§20 phase 72).
 */
export function ProviderFields({
  provider,
  onClose,
}: {
  provider: ProviderDto | null;
  onClose(): void;
}) {
  const create = useCreateProvider();
  const update = useUpdateProvider();
  const remove = useDeleteProvider();
  const test = useTestConnection();
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const modelRef = useRef<HTMLInputElement>(null);
  const [chosenModel, setChosenModel] = useState(provider?.model ?? "");
  const [confirmNode, confirm] = useConfirm();
  const formRef = useRef<HTMLFormElement>(null);
  /*
   * Prefill and the instruct template used to write to the server the moment
   * they were clicked, while every other field waited for Save — so Save meant
   * "save some of this", and a reader who set both and then closed without
   * saving had stored half their edit (§20 phase 178). They are form state now
   * and go with the submit. Held as state rather than in the form because both
   * are button groups rather than inputs.
   */
  const [prefill, setPrefill] = useState<boolean | null>(provider?.supportsPrefill ?? null);
  const [instruct, setInstruct] = useState<string | null>(provider?.instructTemplate ?? null);

  // The model list comes from the provider's own API (§16). The key crosses to
  // our server transiently for the call — never stored, never to a third party.
  // Read at click time, not from state: this form is uncontrolled and is still
  // being typed into.
  function modelRequest() {
    const data = new FormData(formRef.current ?? undefined);
    return {
      kind: provider?.kind ?? String(data.get("kind") ?? ""),
      baseUrl: String(data.get("baseUrl") ?? ""),
      apiKey: String(data.get("apiKey") ?? ""),
      ...(provider === null ? {} : { providerId: provider.id }),
    };
  }

  return (
    <>
      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const name = String(form.get("name") ?? "").trim();
          const baseUrl = String(form.get("baseUrl") ?? "").trim();
          const model = String(form.get("model") ?? "").trim();
          const apiKey = String(form.get("apiKey") ?? "").trim();
          const kind = String(form.get("kind") ?? "openai_compatible");

          const done = { onSuccess: () => onClose(), onError: (e: Error) => setError(e.message) };
          if (provider === null) {
            create.mutate(
              {
                name,
                kind: kind as ProviderDto["kind"],
                baseUrl: baseUrl === "" ? null : baseUrl,
                model: model === "" ? null : model,
                apiKey: apiKey === "" ? null : apiKey,
              },
              done,
            );
          } else {
            update.mutate(
              {
                id: provider.id,
                name,
                baseUrl: baseUrl === "" ? null : baseUrl,
                model: model === "" ? null : model,
                supportsPrefill: prefill,
                instructTemplate: instruct,
                // Blank leaves the stored key alone. A form that came back
                // empty must not delete a credential nobody touched (§17).
                ...(apiKey === "" ? {} : { apiKey }),
              },
              done,
            );
          }
        }}
      >
        <p className="section-label mb-[6px]">{strings.settings.providerName}</p>
        <input name="name" className="field mb-[14px]" defaultValue={provider?.name ?? ""} required />

        {provider === null ? (
          <>
            <p className="section-label mb-[6px]">{strings.settings.providerKind}</p>
            <select name="kind" className="field mb-[14px]">
              {PROVIDER_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kindLabel(kind)}
                </option>
              ))}
            </select>
          </>
        ) : null}

        <p className="section-label mb-[6px]">{strings.settings.providerBaseUrl}</p>
        <input
          name="baseUrl"
          className="field mb-[14px]"
          placeholder="http://localhost:8080/v1"
          defaultValue={provider?.baseUrl ?? ""}
        />

        <p className="section-label mb-[6px]">{strings.settings.providerModel}</p>
        <div className="mb-[14px]">
          <ModelPicker
            request={modelRequest}
            selected={chosenModel}
            onPick={(model) => {
              // Written straight to the field, which is uncontrolled; the state
              // is kept in step so the pick stays highlighted.
              if (modelRef.current !== null) modelRef.current.value = model;
              setChosenModel(model);
            }}
          >
            <input
              ref={modelRef}
              name="model"
              className="field min-w-0 flex-1"
              defaultValue={provider?.model ?? ""}
              onChange={(event) => setChosenModel(event.target.value)}
            />
          </ModelPicker>
        </div>

        <p className="section-label mb-[6px]">{strings.settings.providerKey}</p>
        <input name="apiKey" type="password" className="field" autoComplete="off" />
        <p className="explain mt-[6px] mb-[14px]">
          {provider === null
            ? strings.settings.providerKeyNone
            : provider.hasApiKey
              ? `${strings.settings.providerKeyHeld(provider.apiKeyMask ?? "")} · ${strings.settings.providerKeyKeep}`
              : strings.settings.providerKeyNone}
        </p>

        {/* Whether this endpoint takes a prefill (SPEC §13). Three-valued, and
            all three are real: prefill is a property of the endpoint rather
            than the wire format, so "the adapter decides" is a different answer
            from "no". Only offered on an existing provider, since it is a
            correction to what the adapter assumed. */}
        {provider === null ? null : (
          <>
            <p className="section-label mb-[6px]">{strings.settings.providerPrefill}</p>
            <div className="mb-[6px] flex gap-[6px]">
              {(
                [
                  [null, strings.settings.providerPrefillAuto],
                  [true, strings.settings.providerPrefillYes],
                  [false, strings.settings.providerPrefillNo],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={String(value)}
                  type="button"
                  className={`btn flex-1 ${prefill === value ? "btn-primary" : ""}`}
                  onClick={() => setPrefill(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="explain mb-[14px]">
              {strings.settings.providerPrefillHint}
            </p>
          </>
        )}

        {/* Text completion only: how this model's turns are marked (SPEC §4).
            The chat adapters send a message array and the provider applies its
            own, so the setting would be a switch that does nothing. */}
        {provider === null || provider.kind !== "text_completion" ? null : (
          <InstructPicker
            provider={{ ...provider, instructTemplate: instruct }}
            onSelect={setInstruct}
            onError={setError}
          />
        )}

        {error === null ? null : (
          <p className="explain explain-alert mb-[10px]">{error}</p>
        )}

        {/* §16: one round trip, so a bad key reads here rather than on the
            first generation — and on the values in the form, so a new provider
            can be tested before it is committed (§20 phase 178). It used to
            need a saved row, which made adding one a loop of save, reopen,
            test, fix, save. */}
        <div className="mb-[10px] flex items-center gap-[8px]">
          <button
            type="button"
            className="btn flex-1"
            disabled={test.isPending}
            onClick={() =>
              test.mutate(modelRequest(), {
                onSuccess: (result) =>
                  setTestResult(
                    result.ok
                      ? `${strings.settings.providerTestOk} · ${result.latencyMs}ms`
                      : `${strings.settings.providerTestFail} — ${result.detail ?? ""}`,
                  ),
                onError: (e: Error) => setTestResult(e.message),
              })
            }
          >
            {test.isPending ? strings.settings.providerTesting : strings.settings.providerTest}
          </button>
          {testResult === null ? null : (
            <span className="chrome min-w-0 flex-1 truncate text-[12px] leading-[1.4] text-ink-dim">
              {testResult}
            </span>
          )}
        </div>

        <ActionRow
          onRemove={
            provider === null
              ? null
              : () =>
                  confirm(
                    strings.settings.removeConfirm,
                    () =>
                      remove.mutate(provider.id, {
                        onSuccess: () => onClose(),
                        onError: (e) => setError(e.message),
                      }),
                    { confirmLabel: strings.settings.remove },
                  )
          }
        />
      </form>
      {confirmNode}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Profiles                                                            */
/* ------------------------------------------------------------------ */

export function ProfileEditor({
  profile,
  providers,
  onClose,
}: {
  profile: ConnectionProfileDto | null;
  providers: ProviderDto[];
  onClose(): void;
}) {
  return (
    <Sheet title={profile === null ? strings.settings.addProfile : profile.name} onClose={onClose}>
      <div className="pt-[8px] pb-[14px]">
        <ProfileFields profile={profile} providers={providers} onClose={onClose} />
      </div>
    </Sheet>
  );
}

/**
 * The profile's form, shared by the desktop's inline expansion and the phone's
 * sheet, so the two cannot drift into different editors (§20 phase 72).
 */
export function ProfileFields({
  profile,
  providers,
  onClose,
}: {
  profile: ConnectionProfileDto | null;
  providers: ProviderDto[];
  onClose(): void;
}) {
  const create = useCreateProfile();
  const update = useUpdateProfile();
  const remove = useDeleteProfile();
  const presets = usePresets().data ?? [];
  const [error, setError] = useState<string | null>(null);
  const [confirmNode, confirm] = useConfirm();
  const modelRef = useRef<HTMLInputElement>(null);
  const [chosenModel, setChosenModel] = useState(profile?.model ?? "");
  const formRef = useRef<HTMLFormElement>(null);

  // A profile's model list comes from the provider it points at — the profile
  // itself has no address, so the selected provider supplies both the URL and
  // the stored key (§16).
  function modelRequest() {
    const data = new FormData(formRef.current ?? undefined);
    const providerId = String(data.get("providerId") ?? "");
    const provider = providers.find((candidate) => candidate.id === providerId);
    // An empty address makes the picker say why, rather than calling and
    // failing: the profile has no address of its own, only the provider's.
    return {
      kind: provider?.kind ?? "",
      baseUrl: provider?.baseUrl ?? "",
      ...(provider === undefined ? {} : { providerId: provider.id }),
    };
  }

  return (
    <>
      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const name = String(form.get("name") ?? "").trim();
          const providerId = String(form.get("providerId") ?? "");
          const model = String(form.get("model") ?? "").trim();
          const presetRaw = String(form.get("presetId") ?? "");
          const presetId = presetRaw === "" ? null : presetRaw;
          const done = { onSuccess: () => onClose(), onError: (e: Error) => setError(e.message) };

          if (profile === null) {
            create.mutate(
              { name, providerId, model: model === "" ? null : model, presetId },
              done,
            );
          } else {
            update.mutate(
              { id: profile.id, name, providerId, model: model === "" ? null : model, presetId },
              done,
            );
          }
        }}
      >
        <p className="section-label mb-[6px]">{strings.settings.profileName}</p>
        <input name="name" className="field mb-[14px]" defaultValue={profile?.name ?? ""} required />

        <p className="section-label mb-[6px]">{strings.settings.providers}</p>
        <select name="providerId" className="field mb-[14px]" defaultValue={profile?.providerId ?? ""}>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </select>

        {/* §20 phase 54. A preset holds the samplers, the window and the
            response reservation; until now nothing in the client could attach
            one, so whichever row setup wrote was the only one that ever ran. */}
        <p className="section-label mb-[6px]">{strings.settings.preset}</p>
        <select
          name="presetId"
          className="field mb-[14px]"
          defaultValue={profile?.presetId ?? ""}
        >
          <option value="">{strings.settings.presetDefault}</option>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>

        <p className="section-label mb-[6px]">{strings.settings.providerModel}</p>
        <div className="mb-[14px]">
          <ModelPicker
            request={modelRequest}
            selected={chosenModel}
            emptyMessage={strings.settings.modelsNoProviderAddress}
            onPick={(model) => {
              if (modelRef.current !== null) modelRef.current.value = model;
              setChosenModel(model);
            }}
          >
            <input
              ref={modelRef}
              name="model"
              className="field min-w-0 flex-1"
              defaultValue={profile?.model ?? ""}
              onChange={(event) => setChosenModel(event.target.value)}
            />
          </ModelPicker>
        </div>

        {error === null ? null : (
          <p className="explain explain-alert mb-[10px]">{error}</p>
        )}

        <ActionRow
          onRemove={
            profile === null
              ? null
              : () =>
                  confirm(
                    strings.settings.removeConfirm,
                    () =>
                      remove.mutate(profile.id, {
                        onSuccess: () => onClose(),
                        onError: (e) => setError(e.message),
                      }),
                    { confirmLabel: strings.settings.remove },
                  )
          }
        >
          {profile === null || profile.isDefault ? null : (
            <button
              type="button"
              className="btn"
              onClick={() =>
                update.mutate(
                  { id: profile.id, isDefault: true },
                  { onSuccess: () => onClose(), onError: (e) => setError(e.message) },
                )
              }
            >
              {strings.settings.makeDefault}
            </button>
          )}
        </ActionRow>
      </form>
      {confirmNode}
    </>
  );
}

