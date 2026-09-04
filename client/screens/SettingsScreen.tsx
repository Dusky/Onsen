import { useRef, useState } from "react";
import type {
  ConnectionProfileDto,
  EventTriggerDto,
  ApiKeyDto,
  InstalledPackDto,
  PackPlanDto,
  WebhookDto,
  PresetDto,
  ProviderDto,
  RegexScriptDto,
  TaskDto,
  UpdateStatusDto,
} from "@shared/types.ts";
import { PROVIDER_KINDS, INJECTION_ROLES, type ProviderKind } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { useConfirm } from "../components/ConfirmSheet.tsx";
import { InstructPicker } from "../components/InstructPicker.tsx";
import {
  useConnectionProfiles,
  useCreateProfile,
  useCreateProvider,
  useDeleteProfile,
  useDeleteProvider,
  useImportPreset,
  usePresets,
  useProviders,
  useTasks,
  useUpdateProfile,
  useUpdateProvider,
  useUpdateTask,
  useTestProvider,
  useFetchModels,
  useApplyUpdate,
  useCheckUpdate,
  useUpdateStatus,
  useEmbeddingsConfig,
  useSaveEmbeddingsConfig,
  useScripts,
  useTriggerActions,
  useTriggers,
  usePacks,
  usePreviewPack,
  useWebhooks,
  useScenes,
  usePreferences,
  useSetPreferences,
  useApiKeys,
} from "../lib/queries.ts";
import { TabBar } from "../components/TabBar.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { PresetEditor } from "../components/PresetEditor.tsx";
import { ScriptEditor } from "../components/ScriptEditor.tsx";
import { TriggerEditor } from "../components/TriggerEditor.tsx";
import { ExportPackSheet, InstallPackSheet, RemovePackSheet } from "../components/PackSheets.tsx";
import { WebhookEditor } from "../components/WebhookEditor.tsx";
import { ApiKeyEditor } from "../components/ApiKeyEditor.tsx";
import { MediaSettings } from "../components/MediaSettings.tsx";

/**
 * Settings (design handoff, screen 3i).
 *
 * Two groups, each a mono section label over hairline rows: **Connections** and
 * **Routing by operation**. The design is emphatic that the second is *the*
 * interesting screen for this audience — per-operation model routing is a
 * headline capability, not a preference — so it is not buried under an advanced
 * toggle and it names what each operation actually does.
 *
 * The design's third group, Reading, is theme, prose size and VN stage. All
 * three belong to features that do not exist yet, so the group is absent rather
 * than drawn with nothing behind it.
 */

function Row({ children }: { children: React.ReactNode }) {
  return <div className="border-b border-rule py-[12px]">{children}</div>;
}

/**
 * A provider kind as a person would say it. The column stores an enum and it
 * was reaching the screen as `OPENAI_COMPATIBLE`.
 */
function kindLabel(kind: ProviderKind): string {
  switch (kind) {
    case "openai_compatible":
      return "OpenAI-compatible";
    case "anthropic":
      return "Anthropic";
    case "text_completion":
      return "Text completion";
  }
}

function statusDot(ok: boolean) {
  return (
    <span
      className="mt-[5px] inline-block h-[7px] w-[7px] flex-none"
      style={{
        background: ok ? "var(--onsen-color-green)" : "var(--onsen-color-text-dim)",
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Providers                                                           */
/* ------------------------------------------------------------------ */

function ProviderEditor({
  provider,
  onClose,
}: {
  provider: ProviderDto | null;
  onClose(): void;
}) {
  const create = useCreateProvider();
  const update = useUpdateProvider();
  const remove = useDeleteProvider();
  const test = useTestProvider(provider?.id ?? "");
  const fetchModels = useFetchModels();
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [confirmNode, confirm] = useConfirm();
  const formRef = useRef<HTMLFormElement>(null);

  // The model list comes from the provider's own API (§16). The key crosses to
  // our server transiently for the call — never stored, never to a third party.
  function onFetchModels() {
    const form = formRef.current;
    if (form === null) return;
    const data = new FormData(form);
    fetchModels.mutate(
      {
        kind: provider?.kind ?? String(data.get("kind") ?? ""),
        baseUrl: String(data.get("baseUrl") ?? ""),
        apiKey: String(data.get("apiKey") ?? ""),
        ...(provider === null ? {} : { providerId: provider.id }),
      },
      {
        onSuccess: ({ models }) => setModelOptions(models),
        onError: (e: Error) => setError(e.message),
      },
    );
  }

  return (
    <Sheet
      title={provider === null ? strings.settings.addProvider : provider.name}
      onClose={onClose}
    >
      <form
        ref={formRef}
        className="pt-[8px] pb-[14px]"
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
        <div className="mb-[14px] flex gap-[6px]">
          <input
            name="model"
            className="field flex-1"
            list={`models-${provider?.id ?? "new"}`}
            defaultValue={provider?.model ?? ""}
          />
          <button
            type="button"
            className="btn flex-none"
            disabled={fetchModels.isPending}
            onClick={onFetchModels}
          >
            {fetchModels.isPending ? strings.settings.fetchingModels : strings.settings.fetchModels}
          </button>
        </div>
        <datalist id={`models-${provider?.id ?? "new"}`}>
          {modelOptions.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>

        <p className="section-label mb-[6px]">{strings.settings.providerKey}</p>
        <input name="apiKey" type="password" className="field" autoComplete="off" />
        <p className="chrome mt-[6px] mb-[14px] text-[10px] leading-[1.6] text-ink-dim">
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
                  className={`btn flex-1 ${provider.supportsPrefill === value ? "btn-primary" : ""}`}
                  onClick={() =>
                    update.mutate(
                      { id: provider.id, supportsPrefill: value },
                      { onError: (e: Error) => setError(e.message) },
                    )
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="chrome mb-[14px] text-[10px] leading-[1.6] text-ink-dim">
              {strings.settings.providerPrefillHint}
            </p>
          </>
        )}

        {/* Text completion only: how this model's turns are marked (SPEC §4).
            The chat adapters send a message array and the provider applies its
            own, so the setting would be a switch that does nothing. */}
        {provider === null || provider.kind !== "text_completion" ? null : (
          <InstructPicker
            provider={provider}
            onSelect={(templateId) =>
              update.mutate(
                { id: provider.id, instructTemplate: templateId },
                { onError: (e: Error) => setError(e.message) },
              )
            }
            onError={setError}
          />
        )}

        {error === null ? null : (
          <p className="chrome mb-[10px] text-[9.5px] leading-[1.5] text-red-text">{error}</p>
        )}

        {/* §16: one round trip, so a bad key reads here rather than on the first
            generation. Shown only when the editor has an id to test. */}
        {provider !== null ? (
          <div className="mb-[10px] flex items-center gap-[8px]">
            <button
              type="button"
              className="btn flex-1"
              disabled={test.isPending}
              onClick={() =>
                test.mutate(undefined, {
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
            {testResult !== null ? (
              <span className="chrome min-w-0 flex-1 truncate text-[8.5px] leading-[1.4] text-ink-dim">
                {testResult}
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="flex gap-[8px]">
          <button type="submit" className="btn btn-primary flex-1">
            {strings.settings.save}
          </button>
          {provider === null ? null : (
            <button
              type="button"
              className="btn"
              onClick={() =>
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
            >
              {strings.settings.remove}
            </button>
          )}
        </div>
      </form>
      {confirmNode}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Profiles                                                            */
/* ------------------------------------------------------------------ */

function ProfileEditor({
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
  const fetchModels = useFetchModels();
  const [error, setError] = useState<string | null>(null);
  const [confirmNode, confirm] = useConfirm();
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const formRef = useRef<HTMLFormElement>(null);

  // A profile's model list comes from the provider it points at — the profile
  // itself has no address, so the selected provider supplies both the URL and
  // the stored key (§16).
  function onFetchModels() {
    const form = formRef.current;
    if (form === null) return;
    const data = new FormData(form);
    const providerId = String(data.get("providerId") ?? "");
    const provider = providers.find((candidate) => candidate.id === providerId);
    if (provider === undefined || provider.baseUrl === null) {
      setError("This provider has no address to fetch models from.");
      return;
    }
    fetchModels.mutate(
      { baseUrl: provider.baseUrl, providerId: provider.id },
      {
        onSuccess: ({ models }) => setModelOptions(models),
        onError: (e: Error) => setError(e.message),
      },
    );
  }

  return (
    <Sheet title={profile === null ? strings.settings.addProfile : profile.name} onClose={onClose}>
      <form
        ref={formRef}
        className="pt-[8px] pb-[14px]"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const name = String(form.get("name") ?? "").trim();
          const providerId = String(form.get("providerId") ?? "");
          const model = String(form.get("model") ?? "").trim();
          const done = { onSuccess: () => onClose(), onError: (e: Error) => setError(e.message) };

          if (profile === null) {
            create.mutate({ name, providerId, model: model === "" ? null : model }, done);
          } else {
            update.mutate(
              { id: profile.id, name, providerId, model: model === "" ? null : model },
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

        <p className="section-label mb-[6px]">{strings.settings.providerModel}</p>
        <div className="mb-[14px] flex gap-[6px]">
          <input
            name="model"
            className="field flex-1"
            list={`profile-models-${profile?.id ?? "new"}`}
            defaultValue={profile?.model ?? ""}
          />
          <button
            type="button"
            className="btn flex-none"
            disabled={fetchModels.isPending}
            onClick={onFetchModels}
          >
            {fetchModels.isPending ? strings.settings.fetchingModels : strings.settings.fetchModels}
          </button>
        </div>
        <datalist id={`profile-models-${profile?.id ?? "new"}`}>
          {modelOptions.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>

        {error === null ? null : (
          <p className="chrome mb-[10px] text-[9.5px] leading-[1.5] text-red-text">{error}</p>
        )}

        <div className="flex gap-[8px]">
          <button type="submit" className="btn btn-primary flex-1">
            {strings.settings.save}
          </button>
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
          {profile === null ? null : (
            <button
              type="button"
              className="btn"
              onClick={() =>
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
              {strings.settings.remove}
            </button>
          )}
        </div>
      </form>
      {confirmNode}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Routing by operation                                                */
/* ------------------------------------------------------------------ */

function OpEditor({
  task,
  profiles,
  onClose,
}: {
  task: TaskDto;
  profiles: ConnectionProfileDto[];
  onClose(): void;
}) {
  const update = useUpdateTask();
  const [template, setTemplate] = useState(task.promptTemplate ?? task.defaultTemplate);

  return (
    <Sheet title={task.label} onClose={onClose}>
      <div className="pt-[8px] pb-[14px]">
        <p className="chrome mb-[16px] text-[9.5px] leading-[1.5] text-ink-dim">
          {task.description}
        </p>

        <div className="mb-[16px] flex gap-[6px]">
          <button
            type="button"
            className={`btn flex-1 ${task.enabled ? "btn-primary" : ""}`}
            onClick={() => update.mutate({ key: task.key, enabled: !task.enabled })}
          >
            {task.enabled ? strings.settings.opEnabled : strings.settings.opDisabled}
          </button>
          {task.hideable ? (
            <button
              type="button"
              className={`btn flex-1 ${task.buttonVisible ? "" : "btn-primary"}`}
              onClick={() => update.mutate({ key: task.key, buttonVisible: !task.buttonVisible })}
            >
              {strings.settings.opHidden}
            </button>
          ) : null}
        </div>

        {/* Anything that runs behind a finished turn can go on the automatic
            list — SPEC §7.5's passes and §8's guides both make `auto_trigger` a
            per-op switch. What it does when it runs is fixed by the op, and
            worth saying: only some of them rewrite anything. */}
        {task.stage === "post_generation" ? (
          <>
            <button
              type="button"
              className={`btn mb-[10px] w-full ${task.autoTrigger ? "btn-primary" : ""}`}
              onClick={() => update.mutate({ key: task.key, autoTrigger: !task.autoTrigger })}
            >
              {strings.settings.opAutoTrigger}
            </button>
            <p className="chrome mb-[16px] text-[10px] leading-[1.6] text-ink-dim">
              {task.effect === "replace"
                ? strings.settings.opEffectReplace
                : task.effect === "flag"
                  ? strings.settings.opEffectFlag
                  : strings.settings.opEffectGuide}
            </p>
          </>
        ) : null}

        {/* Routing only means something for an op that makes its own call. */}
        {task.runs === "side_call" ? (
          <>
            <p className="section-label mb-[6px]">{strings.settings.routing}</p>
            <div className="mb-[16px] flex flex-wrap gap-[6px]">
              <button
                type="button"
                className={`btn ${task.connectionProfileId === null ? "btn-primary" : ""}`}
                onClick={() => update.mutate({ key: task.key, connectionProfileId: null })}
              >
                {strings.settings.routingSame}
              </button>
              {profiles.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  className={`btn ${task.connectionProfileId === profile.id ? "btn-primary" : ""}`}
                  onClick={() => update.mutate({ key: task.key, connectionProfileId: profile.id })}
                >
                  {profile.name}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="chrome mb-[16px] text-[10px] leading-[1.6] text-ink-dim">
            {strings.settings.opTurnOnly}
          </p>
        )}

        {/* A turn instruction's words are the thing worth changing; a side
            call's question is a shape, not a paragraph, so it has none. */}
        {task.defaultTemplate === "" ? null : (
          <>
            <p className="section-label mb-[6px]">{strings.settings.opWords}</p>
            {/* Mono, not Spectral: a template is machinery — it has braces in
                it — and the design gives the app's own voice the mono face. */}
            <textarea
              className="field chrome min-h-[120px] resize-y text-[12px] leading-[1.6]"
              value={template}
              onChange={(event) => setTemplate(event.target.value)}
            />
            <p className="chrome mt-[6px] text-[10px] leading-[1.6] text-ink-dim">
              {strings.settings.opWordsHint(
                task.variables.map((name) => `{{${name}}}`).join(" · "),
              )}
            </p>
            <div className="mt-[9px] mb-[16px] flex gap-[6px]">
              <button
                type="button"
                className="btn btn-primary flex-1"
                onClick={() => update.mutate({ key: task.key, promptTemplate: template })}
              >
                {strings.settings.save}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setTemplate(task.defaultTemplate);
                  update.mutate({ key: task.key, promptTemplate: null });
                }}
              >
                {strings.settings.opWordsReset}
              </button>
            </div>

            <p className="section-label mb-[6px]">{strings.settings.opRole}</p>
            <div className="flex gap-[6px]">
              {INJECTION_ROLES.map((role) => (
                <button
                  key={role}
                  type="button"
                  className={`btn flex-1 ${task.injectionRole === role ? "btn-primary" : ""}`}
                  onClick={() => update.mutate({ key: task.key, injectionRole: role })}
                >
                  {role}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Update (SPEC §17)                                                   */
/* ------------------------------------------------------------------ */

/**
 * Where the running code stands against its remote, for a git-checkout
 * deployment. The same layout as every other group — a row that states the
 * facts, buttons that act on them — because an update is a fact about this
 * install, not a preference in it.
 */
function UpdateGroup() {
  const status = useUpdateStatus();
  const check = useCheckUpdate();
  const apply = useApplyUpdate();
  const [refusal, setRefusal] = useState<string | null>(null);

  const s = status.data;
  if (s === undefined) return null;

  // A container image or the standalone executable has no checkout to pull.
  // The group stays rather than vanishing, saying why — an updater that is
  // silently absent looks like an up-to-date install.
  if (s.mode !== "git") {
    return (
      <>
        <p className="section-label mb-[4px]">{strings.settings.update}</p>
        <p className="chrome mb-[10px] text-[10px] leading-[1.6] text-ink-dim">
          {strings.settings.updateNotGit}
        </p>
        <div className="mb-[26px]" />
      </>
    );
  }

  const behind = s.behind;
  // The state, read strictly: unknown before a check, absent from the remote
  // once a check has looked. A branch the remote does not carry is a fact
  // about the deployment, not a nag to press the button again.
  const state =
    behind === null
      ? s.lastCheckedAt === null
        ? strings.settings.updateUnchecked
        : strings.settings.updateNoRemote
      : behind === 0
        ? strings.settings.updateUpToDate
        : strings.settings.updateBehind(behind);
  return (
    <>
      <p className="section-label mb-[4px]">{strings.settings.update}</p>
      <p className="chrome mb-[10px] text-[10px] leading-[1.6] text-ink-dim">
        {strings.settings.updateHint}
      </p>
      <Row>
        <div className="flex items-baseline gap-[9px]">
          <span className="min-w-0 flex-1">
            {/* What the install is, not what its last commit said: a commit
                subject is machinery, and one glance at a real log shows why it
                makes a poor label. */}
            <span className="block truncate text-[15px] font-medium">
              {strings.settings.updateInstall}
            </span>
            <span className="chrome block truncate text-[9px] tracking-[0.06em] text-ink-dim uppercase">
              {[s.branch, s.commit?.slice(0, 7), s.dirty ? strings.settings.updateChanged : null]
                .filter((part) => part !== null && part !== undefined && part !== "")
                .join(" · ")}
            </span>
          </span>
          {/* Red is attention — owed by "behind" alone, not by every state
              that is not an error. */}
          <span
            className="chrome flex-none text-[9px] tracking-[0.06em] uppercase"
            style={{ color: behind !== null && behind > 0 ? "var(--onsen-color-red)" : undefined }}
          >
            {state}
          </span>
        </div>
      </Row>
      <div className="mt-[12px] flex gap-[8px]">
        <button
          type="button"
          className="btn flex-1"
          disabled={check.isPending || apply.isPending}
          onClick={() => {
            setRefusal(null);
            check.mutate(undefined, { onError: (e: Error) => setRefusal(e.message) });
          }}
        >
          {check.isPending ? strings.settings.updateChecking : strings.settings.updateCheck}
        </button>
        {behind !== null && behind > 0 ? (
          <button
            type="button"
            className="btn btn-primary flex-1"
            disabled={check.isPending || apply.isPending || s.dirty}
            onClick={() =>
              apply.mutate(undefined, { onError: (e: Error) => setRefusal(e.message) })
            }
          >
            {apply.isPending
              ? strings.settings.updateApplying
              : strings.settings.updateApply(behind)}
          </button>
        ) : null}
      </div>
      {/* Chrome, not rows: these are conditions, not things to tap. */}
      {s.dirty ? (
        <p className="chrome mt-[10px] text-[10px] leading-[1.6] text-ink-dim">
          {strings.settings.updateDirty}
        </p>
      ) : null}
      {s.error === null ? null : (
        <p className="chrome mt-[10px] text-[9.5px] leading-[1.5] text-red-text">{s.error}</p>
      )}
      {refusal === null ? null : (
        <p className="chrome mt-[10px] text-[9.5px] leading-[1.5] text-red-text">{refusal}</p>
      )}
      {s.restartRequired ? (
        <p className="chrome mt-[10px] text-[10px] leading-[1.6] text-ink-dim">
          {strings.settings.updateRestart}
        </p>
      ) : null}
      <div className="mb-[26px]" />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Embeddings (SPEC §11, phase 30)                                     */
/* ------------------------------------------------------------------ */

/** The data bank's embeddings provider — base URL, model, key — or nothing,
 * which is the keyword fallback, and the section says so rather than hiding. */
/**
 * Reading preferences (SPEC §5, §16).
 *
 * The design's third settings group is "Reading" — theme, prose size, VN stage.
 * Two of those three still belong to features that do not exist, so this is the
 * group with one thing in it rather than the group drawn with nothing behind it.
 */
function ReadingSection() {
  const preferences = usePreferences();
  const save = useSetPreferences();
  const chime = preferences.data?.completionChime === true;

  return (
    <>
      <p className="section-label mb-[4px]">{strings.settings.reading}</p>
      <p className="chrome mb-[10px] text-[10px] leading-[1.6] text-ink-dim">
        {strings.settings.readingHint}
      </p>
      <p className="section-label mb-[6px]">{strings.settings.chime}</p>
      <div className="flex gap-[6px]">
        {[
          [false, strings.settings.chimeOff],
          [true, strings.settings.chimeOn],
        ].map(([value, label]) => (
          <button
            key={String(value)}
            type="button"
            className={`btn flex-1 ${chime === value ? "btn-primary" : ""}`}
            onClick={() => save.mutate({ completionChime: value as boolean })}
          >
            {label as string}
          </button>
        ))}
      </div>
      <p className="chrome mt-[7px] mb-[26px] text-[10px] leading-[1.6] text-ink-dim">
        {strings.settings.chimeHint}
      </p>
    </>
  );
}

/**
 * Bearer keys for §19's outbound API.
 *
 * The keys live here and the per-roleplay switch lives in that roleplay's
 * setup, because they are different questions: "who may reach this install" is
 * about the install, and "may this story be driven from outside" is about the
 * story. The hint on this section says where the other half is, since neither
 * one alone opens anything.
 */
function ApiKeysSection() {
  const apiKeys = useApiKeys();
  const scenes = useScenes();
  const [editing, setEditing] = useState<ApiKeyDto | null | undefined>(undefined);

  const keys = apiKeys.data ?? [];

  return (
    <>
      <p className="section-label mb-[4px]">{strings.settings.apiKeys}</p>
      <p className="chrome mb-[10px] text-[10px] leading-[1.6] text-ink-dim">
        {strings.settings.apiKeysHint}
      </p>

      {keys.length === 0 ? (
        <p className="chrome mb-[10px] text-[10px] leading-[1.6] text-ink-dim">
          {strings.settings.apiKeyNone}
        </p>
      ) : null}
      {keys.map((key) => (
        <Row key={key.id}>
          <button
            type="button"
            onClick={() => setEditing(key)}
            className="flex w-full items-baseline gap-[9px] text-left"
          >
            {statusDot(!key.revoked)}
            <span className="min-w-0 flex-1">
              <span
                className="block truncate text-[15px] font-medium"
                style={{ opacity: key.revoked ? 0.55 : 1 }}
              >
                {key.name}
              </span>
              <span className="chrome block truncate text-[9px] tracking-[0.06em] text-ink-dim">
                <span className="font-mono">{key.hint}…</span>
                <span className="uppercase">
                  {[
                    key.sceneTitle,
                    key.revoked ? strings.settings.apiKeyRevoked : null,
                    key.uses === 0
                      ? strings.settings.apiKeyUnused
                      : strings.settings.apiKeyUses(key.uses),
                  ]
                    .filter((part) => part !== null && part !== undefined)
                    .map((part) => ` \u00b7 ${part}`)
                    .join("")}
                </span>
              </span>
            </span>
            <span className="chrome flex-none self-center text-[12px] text-ink-dim">›</span>
          </button>
        </Row>
      ))}

      <button
        type="button"
        className="btn mt-[12px] mb-[26px] w-full"
        onClick={() => setEditing(null)}
      >
        {strings.settings.addApiKey}
      </button>

      {editing !== undefined ? (
        <ApiKeyEditor
          apiKey={editing}
          scenes={scenes.data ?? []}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </>
  );
}

/**
 * Outbound webhooks (SPEC §15).
 *
 * The row carries the delivery state rather than hiding it behind the sheet: a
 * subscription that has been failing for a week and one that is working look
 * identical otherwise, and this is the one feature whose failures happen
 * entirely off-screen.
 */
function WebhooksSection() {
  const webhooks = useWebhooks();
  const scenes = useScenes();
  const [editing, setEditing] = useState<WebhookDto | null | undefined>(undefined);

  const subscriptions = webhooks.data ?? [];

  return (
    <>
      <p className="section-label mb-[4px]">{strings.settings.webhooks}</p>
      <p className="chrome mb-[10px] text-[10px] leading-[1.6] text-ink-dim">
        {strings.settings.webhooksHint}
      </p>

      {subscriptions.length === 0 ? (
        <p className="chrome mb-[10px] text-[10px] leading-[1.6] text-ink-dim">
          {strings.settings.webhookNone}
        </p>
      ) : null}
      {subscriptions.map((webhook) => {
        const failing = webhook.failures > 0;
        return (
          <Row key={webhook.id}>
            <button
              type="button"
              onClick={() => setEditing(webhook)}
              className="flex w-full items-baseline gap-[9px] text-left"
            >
              {statusDot(webhook.enabled && !failing)}
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate text-[15px] font-medium"
                  style={{ opacity: webhook.enabled ? 1 : 0.55 }}
                >
                  {webhook.name}
                </span>
                <span className="chrome block truncate text-[9px] tracking-[0.06em] text-ink-dim">
                  {/* The URL keeps its own case. Everything else in this
                      subtitle is chrome and is uppercased; a URL is not chrome,
                      and a path is case-sensitive. */}
                  <span>{webhook.url}</span>
                  <span className="uppercase">
                    {[
                      webhook.enabled
                        ? null
                        : (webhook.disabledReason ?? strings.settings.webhookIsOff),
                      failing ? strings.settings.webhookFailures(webhook.failures) : null,
                    ]
                      .filter((part) => part !== null)
                      .map((part) => ` \u00b7 ${part}`)
                      .join("")}
                  </span>
                </span>
              </span>
              <span className="chrome flex-none self-center text-[12px] text-ink-dim">›</span>
            </button>
          </Row>
        );
      })}

      <button
        type="button"
        className="btn mt-[12px] mb-[26px] w-full"
        onClick={() => setEditing(null)}
      >
        {strings.settings.addWebhook}
      </button>

      {editing !== undefined ? (
        <WebhookEditor
          webhook={editing}
          scenes={scenes.data ?? []}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </>
  );
}

/**
 * Packs (SPEC §15 tier 2).
 *
 * The preview is not optional here. A pack writes many rows at once and can
 * take them all away again, and a person is owed the answer to "what is this
 * about to add" before the button that adds it — so choosing a file opens the
 * plan rather than installing it.
 */
function PacksSection() {
  const packs = usePacks();
  const preview = usePreviewPack();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ file: File; plan: PackPlanDto } | null>(null);
  const [removing, setRemoving] = useState<InstalledPackDto | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const installed = packs.data?.packs ?? [];

  return (
    <>
      <p className="section-label mb-[4px]">{strings.settings.packs}</p>
      <p className="chrome mb-[10px] text-[10px] leading-[1.6] text-ink-dim">
        {strings.settings.packsHint}
      </p>

      {installed.length === 0 ? (
        <p className="chrome mb-[10px] text-[10px] leading-[1.6] text-ink-dim">
          {strings.settings.packNone}
        </p>
      ) : null}
      {installed.map((pack) => (
        <Row key={pack.id}>
          <button
            type="button"
            onClick={() => setRemoving(pack)}
            className="flex w-full items-baseline gap-[9px] text-left"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium">{pack.name}</span>
              <span className="chrome block truncate text-[9px] tracking-[0.06em] text-ink-dim uppercase">
                {[
                  strings.settings.packVersion(pack.version),
                  pack.author === "" ? null : strings.settings.packBy(pack.author),
                  strings.settings.packOwns(pack.rowCount),
                ]
                  .filter((part) => part !== null)
                  .join(" \u00b7 ")}
              </span>
            </span>
            <span className="chrome flex-none self-center text-[12px] text-ink-dim">›</span>
          </button>
        </Row>
      ))}

      <input
        ref={fileInput}
        type="file"
        hidden
        accept=".onsenpack,.zip,application/zip"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file === undefined) return;
          setError(null);
          preview.mutate(file, {
            onSuccess: (plan) => setPending({ file, plan }),
            onError: (caught: Error) => setError(caught.message),
          });
        }}
      />
      <button
        type="button"
        className="btn mt-[12px] w-full"
        disabled={preview.isPending}
        onClick={() => fileInput.current?.click()}
      >
        {preview.isPending ? strings.settings.packInstalling : strings.settings.packInstall}
      </button>
      <button type="button" className="btn mt-[8px] w-full" onClick={() => setExporting(true)}>
        {strings.settings.packExport}
      </button>
      {error !== null ? (
        <p className="chrome mt-[10px] text-[10px] leading-[1.6] text-red-text">{error}</p>
      ) : null}
      <div className="mb-[26px]" />

      {pending !== null ? (
        <InstallPackSheet
          file={pending.file}
          plan={pending.plan}
          onClose={() => setPending(null)}
        />
      ) : null}
      {removing !== null ? (
        <RemovePackSheet pack={removing} onClose={() => setRemoving(null)} />
      ) : null}
      {exporting ? <ExportPackSheet onClose={() => setExporting(false)} /> : null}
    </>
  );
}

/**
 * Regex scripts and event triggers (SPEC §14).
 *
 * One section rather than two, because they are one feature used together: a
 * trigger's most useful action is firing a script, and a script written to be
 * fired by a trigger is switched off on the automatic paths. Splitting them
 * would put the two halves of one setup in different parts of the screen.
 */
function AutomationSection() {
  const scripts = useScripts();
  const triggers = useTriggers();
  const actions = useTriggerActions();
  const [editingScript, setEditingScript] = useState<RegexScriptDto | null | undefined>(undefined);
  const [editingTrigger, setEditingTrigger] = useState<EventTriggerDto | null | undefined>(
    undefined,
  );

  const scriptList = scripts.data ?? [];

  /**
   * What a trigger points at, as a person would say it rather than as an id or
   * a bare enum. The same list the editor offers, so a row and its sheet cannot
   * disagree about what a trigger runs.
   */
  const named = new Map(
    (["guide", "tracker", "script"] as const).flatMap((action) =>
      (actions.data?.[action] ?? []).map((ref) => [`${action}:${ref.value}`, ref.label] as const),
    ),
  );
  function refLabel(trigger: EventTriggerDto): string {
    return named.get(`${trigger.action}:${trigger.actionRef}`) ?? trigger.actionRef;
  }

  return (
    <>
      <p className="section-label mb-[4px]">{strings.settings.automation}</p>
      <p className="chrome mb-[16px] text-[10px] leading-[1.6] text-ink-dim">
        {strings.settings.automationHint}
      </p>

      <p className="section-label mb-[4px]">{strings.settings.scripts}</p>
      <p className="chrome mb-[10px] text-[10px] leading-[1.6] text-ink-dim">
        {strings.settings.scriptsHint}
      </p>
      {scriptList.map((script) => (
        <Row key={script.id}>
          <button
            type="button"
            onClick={() => setEditingScript(script)}
            className="flex w-full items-baseline gap-[9px] text-left"
          >
            <span className="min-w-0 flex-1">
              <span
                className="block truncate text-[15px] font-medium"
                style={{ opacity: script.enabled ? 1 : 0.55 }}
              >
                {script.name}
              </span>
              <span className="chrome block truncate text-[9px] tracking-[0.06em] text-ink-dim uppercase">
                {[
                  strings.settings.stageLabel[script.applyTo],
                  strings.settings.scopeLabel[script.scope],
                  script.enabled ? null : strings.settings.scriptOff,
                ]
                  .filter((part) => part !== null && part !== undefined)
                  .join(" \u00b7 ")}
              </span>
            </span>
            <span className="chrome flex-none self-center text-[12px] text-ink-dim">›</span>
          </button>
        </Row>
      ))}
      <button
        type="button"
        className="btn mt-[12px] mb-[26px] w-full"
        onClick={() => setEditingScript(null)}
      >
        {strings.settings.addScript}
      </button>

      <p className="section-label mb-[4px]">{strings.settings.triggers}</p>
      <p className="chrome mb-[10px] text-[10px] leading-[1.6] text-ink-dim">
        {strings.settings.triggersHint}
      </p>
      {(triggers.data ?? []).map((trigger) => (
        <Row key={trigger.id}>
          <button
            type="button"
            onClick={() => setEditingTrigger(trigger)}
            className="flex w-full items-baseline gap-[9px] text-left"
          >
            <span className="min-w-0 flex-1">
              <span
                className="block truncate text-[15px] font-medium"
                style={{ opacity: trigger.enabled ? 1 : 0.55 }}
              >
                {trigger.name}
              </span>
              <span className="chrome block truncate text-[9px] tracking-[0.06em] text-ink-dim uppercase">
                {[strings.settings.eventLabel[trigger.event], refLabel(trigger)]
                  .filter((part) => part !== undefined)
                  .join(" \u00b7 ")}
              </span>
            </span>
            <span className="chrome flex-none self-center text-[12px] text-ink-dim">›</span>
          </button>
        </Row>
      ))}
      <button
        type="button"
        className="btn mt-[12px] w-full"
        disabled={scriptList.length === 0 && (triggers.data ?? []).length === 0}
        onClick={() => setEditingTrigger(null)}
      >
        {strings.settings.addTrigger}
      </button>
      <div className="mb-[26px]" />

      {editingScript !== undefined ? (
        <ScriptEditor script={editingScript} onClose={() => setEditingScript(undefined)} />
      ) : null}
      {editingTrigger !== undefined ? (
        <TriggerEditor trigger={editingTrigger} onClose={() => setEditingTrigger(undefined)} />
      ) : null}
    </>
  );
}

function EmbeddingsSection() {
  const config = useEmbeddingsConfig();
  const save = useSaveEmbeddingsConfig();
  const [saved, setSaved] = useState(false);

  return (
    <>
      <p className="section-label mb-[4px]">{strings.settings.embeddings}</p>
      <p className="chrome mb-[10px] text-[10px] leading-[1.6] text-ink-dim">
        {strings.settings.embeddingsHint}
      </p>
      {config.data !== undefined && config.data.baseUrl === null ? (
        <p className="chrome mb-[10px] text-[10px] leading-[1.6] text-ink-dim">
          {strings.settings.embeddingsLexical}
        </p>
      ) : null}
      <form
        className="mb-[14px]"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const baseUrl = String(form.get("baseUrl") ?? "").trim();
          const model = String(form.get("model") ?? "").trim();
          const apiKey = String(form.get("apiKey") ?? "").trim();
          save.mutate(
            {
              baseUrl: baseUrl === "" ? null : baseUrl,
              model: model === "" ? null : model,
              ...(apiKey === "" ? {} : { apiKey }),
            },
            { onSuccess: () => setSaved(true) },
          );
        }}
      >
        <p className="section-label mb-[6px]">{strings.settings.embeddingsBaseUrl}</p>
        <input
          name="baseUrl"
          className="field mb-[10px]"
          placeholder="http://localhost:11434/v1"
          defaultValue={config.data?.baseUrl ?? ""}
        />
        <p className="section-label mb-[6px]">{strings.settings.embeddingsModel}</p>
        <input
          name="model"
          className="field mb-[10px]"
          placeholder="nomic-embed-text"
          defaultValue={config.data?.model ?? ""}
        />
        <p className="section-label mb-[6px]">{strings.settings.embeddingsKey}</p>
        <input name="apiKey" type="password" className="field mb-[10px]" autoComplete="off" />
        <div className="flex items-center gap-[8px]">
          <button type="submit" className="btn btn-primary flex-1">
            {strings.settings.embeddingsSave}
          </button>
          {saved ? (
            <span className="chrome text-[9px] tracking-[0.08em] text-ink-dim uppercase">
              {strings.settings.embeddingsSaved}
            </span>
          ) : null}
        </div>
      </form>
      <div className="mb-[26px]" />
    </>
  );
}

/* ------------------------------------------------------------------ */

export function SettingsScreen() {
  const providers = useProviders();
  const profiles = useConnectionProfiles();
  const presets = usePresets();
  const importPreset = useImportPreset();
  const [presetReport, setPresetReport] = useState<string | null>(null);
  const tasks = useTasks();

  // The provider being edited is held by **id**, not as a snapshot of its row.
  // The editor changes settings in place — prefill, the instruct template — and
  // a captured DTO never sees the result, so the buttons would write to the
  // server and then show the old answer back. `undefined` is closed, `null` is
  // the new-provider form.
  const [editingProviderId, setEditingProviderId] = useState<string | null | undefined>(undefined);
  const [editingProfile, setEditingProfile] = useState<ConnectionProfileDto | null | undefined>(
    undefined,
  );
  const [editingOp, setEditingOp] = useState<TaskDto | null>(null);
  const [editingPreset, setEditingPreset] = useState<PresetDto | null>(null);

  const profileList = profiles.data ?? [];
  const providerList = providers.data ?? [];
  const byId = new Map(providerList.map((provider) => [provider.id, provider]));

  return (
    <div className="flex screen-height flex-col bg-bg">
      <header
        className="screen-header screen-header-wide hairline flex-none px-[22px] pb-[14px]"
        style={{ paddingTop: "calc(22px + env(safe-area-inset-top))" }}
      >
        <p className="screen-kicker">{strings.nav.appName}</p>
        <h1 className="screen-title mt-[6px]">{strings.settings.kicker}</h1>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-[22px] py-[16px]">
        <div className="mx-auto w-full max-w-[var(--onsen-list-measure)]">
          {/* Providers */}
          <p className="section-label mb-[4px]">{strings.settings.providers}</p>
          <p className="chrome mb-[10px] text-[10px] leading-[1.6] text-ink-dim">
            {strings.settings.providersHint}
          </p>
          {providerList.map((provider) => (
            <Row key={provider.id}>
              <button
                type="button"
                onClick={() => setEditingProviderId(provider.id)}
                className="flex w-full gap-[9px] text-left"
              >
                {statusDot(provider.enabled && provider.baseUrl !== null)}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{provider.name}</span>
                  <span className="chrome block truncate text-[9px] tracking-[0.06em] text-ink-dim uppercase">
                    {[provider.model, kindLabel(provider.kind), provider.hasApiKey ? "keyed" : null]
                      .filter((part) => part !== null && part !== "")
                      .join(" · ")}
                  </span>
                </span>
                <span className="chrome flex-none self-center text-[12px] text-ink-dim">›</span>
              </button>
            </Row>
          ))}
          <button
            type="button"
            className="btn mt-[12px] mb-[26px] w-full"
            onClick={() => setEditingProviderId(null)}
          >
            {strings.settings.addProvider}
          </button>

          {/* Profiles */}
          <p className="section-label mb-[4px]">{strings.settings.profiles}</p>
          <p className="chrome mb-[10px] text-[10px] leading-[1.6] text-ink-dim">
            {strings.settings.profilesHint}
          </p>
          {profileList.map((profile) => (
            <Row key={profile.id}>
              <button
                type="button"
                onClick={() => setEditingProfile(profile)}
                className="flex w-full items-baseline gap-[9px] text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{profile.name}</span>
                  <span className="chrome block truncate text-[9px] tracking-[0.06em] text-ink-dim uppercase">
                    {[byId.get(profile.providerId)?.name, profile.model]
                      .filter((part) => part !== undefined && part !== null && part !== "")
                      .join(" · ")}
                  </span>
                </span>
                {profile.isDefault ? (
                  <span
                    className="chrome flex-none text-[8.5px] tracking-[0.12em] uppercase"
                    style={{ color: "var(--onsen-color-red)" }}
                  >
                    {strings.settings.profileDefault}
                  </span>
                ) : null}
                <span className="chrome flex-none self-center text-[12px] text-ink-dim">›</span>
              </button>
            </Row>
          ))}
          <button
            type="button"
            className="btn mt-[12px] mb-[26px] w-full"
            onClick={() => setEditingProfile(null)}
          >
            {strings.settings.addProfile}
          </button>

          {/* How the model is asked to write (SPEC §13). */}
          <p className="section-label mb-[4px]">{strings.settings.generation}</p>
          <p className="chrome mb-[10px] text-[10px] leading-[1.6] text-ink-dim">
            {strings.settings.generationHint}
          </p>
          {(presets.data ?? []).map((preset) => (
            <Row key={preset.id}>
              <button
                type="button"
                onClick={() => setEditingPreset(preset)}
                className="flex w-full items-baseline gap-[9px] text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{preset.name}</span>
                  <span className="chrome block truncate text-[9px] tracking-[0.06em] text-ink-dim uppercase">
                    {[
                      `${strings.settings.samplerTemperature} ${preset.samplerSettings.temperature ?? "—"}`,
                      preset.samplerSettings.dry_multiplier ? "DRY" : null,
                      preset.samplerSettings.xtc_probability ? "XTC" : null,
                      `${preset.contextSize} ${strings.settings.contextSizeUnit}`,
                    ]
                      .filter((part) => part !== null)
                      .join(" · ")}
                  </span>
                </span>
                <span className="chrome flex-none self-center text-[12px] text-ink-dim">›</span>
              </button>
            </Row>
          ))}
          <input
            type="file"
            hidden
            accept=".json,application/json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file === undefined) return;
              importPreset.mutate(file, {
                onSuccess: (report) =>
                  setPresetReport(
                    `${strings.settings.presetImported(report.presetName)} ${strings.settings.presetReport(report)}`,
                  ),
                onError: (error) => setPresetReport(error.message),
              });
              event.target.value = "";
            }}
            id="preset-import"
          />
          <button
            type="button"
            className="btn mt-[12px] w-full"
            disabled={importPreset.isPending}
            onClick={() => document.getElementById("preset-import")?.click()}
          >
            {importPreset.isPending
              ? strings.settings.importingPreset
              : strings.settings.importPreset}
          </button>
          {presetReport !== null ? (
            <p className="chrome mt-[10px] text-[10px] leading-[1.6] text-ink-dim">{presetReport}</p>
          ) : null}
          <div className="mb-[26px]" />

          {/* Routing by operation — the interesting one. */}
          <p className="section-label mb-[4px]">{strings.settings.routing}</p>
          <p className="chrome mb-[10px] text-[10px] leading-[1.6] text-ink-dim">
            {strings.settings.routingHint}
          </p>
          {(tasks.data ?? []).map((task) => {
            const routed =
              task.runs === "turn"
                ? "—"
                : task.connectionProfileId === null
                  ? strings.settings.routingSame
                  : (profileList.find((profile) => profile.id === task.connectionProfileId)?.name ??
                    strings.settings.routingSame);
            return (
              <Row key={task.key}>
                <button
                  type="button"
                  onClick={() => setEditingOp(task)}
                  className="flex w-full items-baseline gap-[9px] text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span
                      className="block truncate text-[15px] font-medium"
                      style={{ opacity: task.enabled ? 1 : 0.55 }}
                    >
                      {task.label}
                    </span>
                    <span className="chrome block truncate text-[9px] tracking-[0.06em] text-ink-dim uppercase">
                      {[
                        task.enabled ? null : strings.settings.opDisabled,
                        task.promptTemplate === null
                          ? strings.settings.opWordsDefault
                          : strings.settings.opWordsOverridden,
                      ]
                        .filter((part) => part !== null)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="chrome flex-none text-[9px] tracking-[0.06em] text-ink-muted uppercase">
                    {routed}
                  </span>
                  <span className="chrome flex-none self-center text-[12px] text-ink-dim">›</span>
                </button>
              </Row>
            );
          })}
          <div className="h-[20px]" />

          <ReadingSection />

          <ApiKeysSection />

          <WebhooksSection />

          {/* §20 phase 41: what draws and what speaks. Near the data bank and
              the webhooks rather than up with the providers, because these are
              services the app talks to and not models it writes with. */}
          <p className="section-label mb-[4px]">{strings.media.title}</p>
          <MediaSettings />

          <PacksSection />

          <AutomationSection />

          <EmbeddingsSection />

          <UpdateGroup />
        </div>
      </main>

      {editingProviderId !== undefined ? (
        <ProviderEditor
          provider={
            editingProviderId === null
              ? null
              : (providerList.find((row) => row.id === editingProviderId) ?? null)
          }
          onClose={() => setEditingProviderId(undefined)}
        />
      ) : null}
      {editingProfile !== undefined ? (
        <ProfileEditor
          profile={editingProfile}
          providers={providerList}
          onClose={() => setEditingProfile(undefined)}
        />
      ) : null}
      {editingPreset !== null ? (
        <PresetEditor
          preset={(presets.data ?? []).find((row) => row.id === editingPreset.id) ?? editingPreset}
          onClose={() => setEditingPreset(null)}
        />
      ) : null}
      {editingOp !== null ? (
        <OpEditor
          task={(tasks.data ?? []).find((task) => task.key === editingOp.key) ?? editingOp}
          profiles={profileList}
          onClose={() => setEditingOp(null)}
        />
      ) : null}

      <TabBar active="settings" />
    </div>
  );
}
