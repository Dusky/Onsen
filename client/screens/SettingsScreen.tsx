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
import { LAYOUT_PRESETS } from "@shared/types.ts";
import type { LayoutDto, LayoutPreset } from "@shared/types.ts";
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
  useSignOut,
} from "../lib/queries.ts";
import { TabBar } from "../components/TabBar.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { PresetEditor } from "../components/PresetEditor.tsx";
import { ScriptEditor } from "../components/ScriptEditor.tsx";
import { TriggerEditor } from "../components/TriggerEditor.tsx";
import { ExportPackSheet, InstallPackSheet, RemovePackSheet } from "../components/PackSheets.tsx";
import { WebhookEditor } from "../components/WebhookEditor.tsx";
import { ApiKeyEditor } from "../components/ApiKeyEditor.tsx";
import { ModelPicker } from "../components/ModelPicker.tsx";
import { MediaSettings } from "../components/MediaSettings.tsx";
import { MigrationSection } from "../components/MigrationSection.tsx";
import { ThemeSection } from "../components/ThemeSection.tsx";

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
  return <div className="row">{children}</div>;
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
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const modelRef = useRef<HTMLInputElement>(null);
  const [chosenModel, setChosenModel] = useState(provider?.model ?? "");
  const [confirmNode, confirm] = useConfirm();
  const formRef = useRef<HTMLFormElement>(null);

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
          <p className="explain explain-alert mb-[10px]">{error}</p>
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
              <span className="chrome min-w-0 flex-1 truncate text-[10px] leading-[1.4] text-ink-dim">
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
        <p className="explain mb-[16px]">
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
            <p className="explain mb-[16px]">
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
          <p className="explain mb-[16px]">
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
            <p className="explain mt-[6px]">
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
        <p className="group-heading mb-[12px]">{strings.settings.update}</p>
        <p className="explain mb-[10px]">
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
      <p className="group-heading mb-[12px]">{strings.settings.update}</p>
      <Row>
        <div className="flex items-baseline gap-[9px]">
          <span className="min-w-0 flex-1">
            {/* What the install is, not what its last commit said: a commit
                subject is machinery, and one glance at a real log shows why it
                makes a poor label. */}
            <span className="block truncate text-[15px] font-medium">
              {strings.settings.updateInstall}
            </span>
            <span className="meta block truncate">
              {[s.branch, s.commit?.slice(0, 7), s.dirty ? strings.settings.updateChanged : null]
                .filter((part) => part !== null && part !== undefined && part !== "")
                .join(" · ")}
            </span>
          </span>
          {/* Red is attention — owed by "behind" alone, not by every state
              that is not an error. */}
          <span
            className="chrome flex-none text-[10.5px]"
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
        <p className="explain mt-[10px]">
          {strings.settings.updateDirty}
        </p>
      ) : null}
      {s.error === null ? null : (
        <p className="explain explain-alert mt-[10px]">{s.error}</p>
      )}
      {refusal === null ? null : (
        <p className="explain explain-alert mt-[10px]">{refusal}</p>
      )}
      {s.restartRequired ? (
        <p className="explain mt-[10px]">
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
/**
 * The chat layout (SPEC §16, §20 phase 52).
 *
 * Three named starting points and the four switches under them, in that order:
 * a preset is where you begin, not a mode you are locked into. Touching a
 * switch moves you to "Yours" rather than silently disagreeing with the name
 * above it.
 *
 * Four switches is the whole surface, deliberately. §16's guardrail is that a
 * matrix of toggles in place of a default is the incumbent's answer and the
 * thing this app is reacting against.
 */
function LayoutSection() {
  const preferences = usePreferences();
  const save = useSetPreferences();
  const layout = preferences.data?.layout ?? { preset: "instrument", ...LAYOUT_PRESETS.instrument };

  function set(patch: Partial<Omit<LayoutDto, "preset">> | { preset: LayoutPreset }) {
    save.mutate({ layout: patch } as never);
  }

  function Segmented<T extends string>({
    label,
    value,
    options,
    onPick,
    hint,
  }: {
    label: string;
    value: T;
    options: { value: T; label: string }[];
    onPick(next: T): void;
    hint?: string;
  }) {
    return (
      <div className="mb-[14px]">
        <p className="section-label mb-[6px]">{label}</p>
        <div className="flex gap-[6px]">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={option.value === value}
              onClick={() => onPick(option.value)}
              className={`btn flex-1 ${option.value === value ? "btn-primary" : ""}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {hint === undefined ? null : <p className="explain mt-[6px]">{hint}</p>}
      </div>
    );
  }

  return (
    <>
      <p className="section-label mb-[6px]">{strings.settings.layout}</p>

      <div className="mb-[8px] flex gap-[6px]">
        {(["instrument", "quiet", "broadsheet"] as const).map((preset) => (
          <button
            key={preset}
            type="button"
            aria-pressed={layout.preset === preset}
            onClick={() => set({ preset })}
            className={`btn flex-1 ${layout.preset === preset ? "btn-primary" : ""}`}
          >
            {strings.settings.layoutPresets[preset]}
          </button>
        ))}
      </div>
      <p className="explain mb-[16px]">
        {strings.settings.layoutPresetHint[layout.preset] ??
          strings.settings.layoutPresetHint["custom"]}
      </p>

      <Segmented
        label={strings.settings.layoutReadouts}
        value={layout.readouts ? "on" : "off"}
        options={[
          { value: "on", label: strings.lore.on },
          { value: "off", label: strings.lore.off },
        ]}
        onPick={(next) => set({ readouts: next === "on" })}
      />

      <Segmented
        label={strings.settings.layoutCast}
        value={layout.cast}
        options={[
          { value: "segments", label: strings.settings.layoutCastSegments },
          { value: "line", label: strings.settings.layoutCastLine },
        ]}
        onPick={(next) => set({ cast: next })}
      />

      <Segmented
        label={strings.settings.layoutDek}
        value={layout.dek ? "on" : "off"}
        options={[
          { value: "on", label: strings.lore.on },
          { value: "off", label: strings.lore.off },
        ]}
        onPick={(next) => set({ dek: next === "on" })}
      />

      <Segmented
        label={strings.settings.layoutAttribution}
        value={layout.attribution}
        options={[
          { value: "stacked", label: strings.settings.layoutAttributionStacked },
          { value: "inline", label: strings.settings.layoutAttributionInline },
        ]}
        onPick={(next) => set({ attribution: next })}
      />
    </>
  );
}

function ReadingSection() {
  const preferences = usePreferences();
  const save = useSetPreferences();
  const chime = preferences.data?.completionChime === true;

  return (
    <>
      <p className="group-heading mb-[12px]">{strings.settings.reading}</p>

      <ThemeSection />

      <LayoutSection />

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
      <p className="group-heading mb-[12px]">{strings.settings.apiKeys}</p>

      {keys.length === 0 ? (
        <p className="explain mb-[10px]">
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
              <span className="chrome block truncate text-[10.5px] text-ink-dim">
                <span className="font-mono">{key.hint}…</span>
                <span className="">
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
      <p className="group-heading mb-[12px]">{strings.settings.webhooks}</p>

      {subscriptions.length === 0 ? (
        <p className="explain mb-[10px]">
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
                <span className="chrome block truncate text-[10.5px] text-ink-dim">
                  {/* The URL keeps its own case. Everything else in this
                      subtitle is chrome and is uppercased; a URL is not chrome,
                      and a path is case-sensitive. */}
                  <span>{webhook.url}</span>
                  <span className="">
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
      <p className="group-heading mb-[12px]">{strings.settings.packs}</p>

      {installed.length === 0 ? (
        <p className="explain mb-[10px]">
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
              <span className="meta block truncate">
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
        <p className="explain explain-alert mt-[10px]">{error}</p>
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
      <p className="group-heading mb-[12px]">{strings.settings.automation}</p>

      <p className="group-heading mb-[12px]">{strings.settings.scripts}</p>
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
              <span className="meta block truncate">
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

      <p className="group-heading mb-[12px]">{strings.settings.triggers}</p>
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
              <span className="meta block truncate">
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
      <p className="group-heading mb-[12px]">{strings.settings.embeddings}</p>
      {config.data !== undefined && config.data.baseUrl === null ? (
        <p className="explain mb-[10px]">
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
            <span className="meta">
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

/**
 * The nine places settings live (SPEC §20 phase 43).
 *
 * Thirty-one section labels in one 1,596-line scroll was not a hierarchy: when
 * everything is a heading, nothing is, and nothing can be found twice. The
 * filter searches these names and the words under them, so a reader who
 * remembers "webhook" but not "connections out" still lands on it.
 */
const CATEGORIES = [
  { id: "models", words: ["provider", "profile", "model", "api key", "endpoint", "anthropic", "llama"] },
  { id: "generation", words: ["preset", "sampler", "temperature", "context", "reasoning", "prefill"] },
  { id: "tasks", words: ["routing", "ops", "background", "guide", "summariser", "classifier"] },
  { id: "reading", words: ["font", "size", "theme", "prose", "light", "dark"] },
  { id: "media", words: ["picture", "voice", "image", "speech", "tts", "draw", "caption"] },
  { id: "data", words: ["embedding", "document", "retrieval", "rag", "data bank"] },
  { id: "automation", words: ["trigger", "script", "regex", "action", "event"] },
  { id: "outward", words: ["api key", "webhook", "outbound", "bridge", "token"] },
  { id: "packs", words: ["pack", "update", "import", "export", "version"] },
  {
    id: "migrate",
    words: ["sillytavern", "migrate", "move", "switch", "chats", "jsonl", "import"],
  },
] as const;

type CategoryId = (typeof CATEGORIES)[number]["id"];

export function SettingsScreen() {
  const signOut = useSignOut();
  const [category, setCategory] = useState<CategoryId>("models");
  const [filter, setFilter] = useState("");

  /**
   * Which categories the filter leaves standing. An empty filter leaves all of
   * them, so typing is additive rather than a mode to get into and out of.
   */
  const needle = filter.trim().toLowerCase();
  const matching = CATEGORIES.filter(
    (entry) =>
      needle === "" ||
      (strings.settings.categories[entry.id] ?? entry.id).toLowerCase().includes(needle) ||
      entry.words.some((word) => word.includes(needle)),
  );
  // A filter that hides the open category would show an empty pane, so the
  // first survivor takes over.
  const active = matching.some((entry) => entry.id === category)
    ? category
    : (matching[0]?.id ?? category);
  const show = (id: CategoryId) => id === active;
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

      {/* §20 phase 43: nine places, and a filter that searches the words under
          them as well as their names — a reader who remembers "webhook" but not
          "connections out" still lands on it. Horizontal on a phone, because a
          left rail there would eat a third of the width. */}
      <div className="hairline flex flex-none flex-col gap-[9px] px-[22px] pb-[11px]">
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={strings.settings.filterSettings}
          aria-label={strings.settings.filterSettings}
          className="field"
        />
        <div className="-mx-[4px] flex gap-[3px] overflow-x-auto">
          {matching.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setCategory(entry.id)}
              aria-current={entry.id === active ? "page" : undefined}
              className="chrome flex min-h-[44px] flex-none items-center px-[10px] text-[11px]"
              style={{
                color:
                  entry.id === active
                    ? "var(--onsen-color-text)"
                    : "var(--onsen-color-text-muted)",
                borderBottom: `2px solid ${entry.id === active ? "var(--onsen-color-red)" : "transparent"}`,
              }}
            >
              {strings.settings.categories[entry.id] ?? entry.id}
            </button>
          ))}
        </div>
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto px-[16px] py-[16px]">
        {/* On a raised surface rather than on the page (phase 49). Twelve
            groups of hairline rows directly on the ground read as one
            undifferentiated dark field. */}
        <div className="surface mx-auto w-full max-w-[var(--onsen-list-measure)]">
          {matching.length === 0 ? (
            <p className="explain">
              {strings.settings.categoryEmpty}
            </p>
          ) : null}
          {show("models") ? (
            <>
          {/* Providers */}
          <p className="group-heading mb-[12px]">{strings.settings.providers}</p>
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
                  <span className="meta block truncate">
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
          <p className="group-heading mb-[12px]">{strings.settings.profiles}</p>
          {profileList.map((profile) => (
            <Row key={profile.id}>
              <button
                type="button"
                onClick={() => setEditingProfile(profile)}
                className="flex w-full items-baseline gap-[9px] text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{profile.name}</span>
                  <span className="meta block truncate">
                    {[byId.get(profile.providerId)?.name, profile.model]
                      .filter((part) => part !== undefined && part !== null && part !== "")
                      .join(" · ")}
                  </span>
                </span>
                {profile.isDefault ? (
                  <span
                    className="chrome flex-none text-[10px]"
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

            </>
          ) : null}
          {show("generation") ? (
            <>
          {/* How the model is asked to write (SPEC §13). */}
          <p className="group-heading mb-[12px]">{strings.settings.generation}</p>
          {(presets.data ?? []).map((preset) => (
            <Row key={preset.id}>
              <button
                type="button"
                onClick={() => setEditingPreset(preset)}
                className="flex w-full items-baseline gap-[9px] text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{preset.name}</span>
                  <span className="meta block truncate">
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
            <p className="explain mt-[10px]">{presetReport}</p>
          ) : null}
          <div className="mb-[26px]" />

            </>
          ) : null}
          {show("tasks") ? (
            <>
          {/* Routing by operation — the interesting one. */}
          <p className="group-heading mb-[12px]">{strings.settings.routing}</p>
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
                    <span className="meta block truncate">
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
                  <span className="chrome flex-none text-[10.5px] text-ink-muted">
                    {routed}
                  </span>
                  <span className="chrome flex-none self-center text-[12px] text-ink-dim">›</span>
                </button>
              </Row>
            );
          })}
            </>
          ) : null}
          <div className="h-[20px]" />

          {show("reading") ? <ReadingSection /> : null}

          {show("outward") ? (
            <>
              <ApiKeysSection />
              <WebhooksSection />
            </>
          ) : null}

          {/* §20 phase 41: what draws and what speaks. Its own category rather
              than filed under the data bank, because "what draws" is a question
              nobody goes looking for under "embeddings". */}
          {show("media") ? (
            <>
              <p className="group-heading mb-[12px]">{strings.media.title}</p>
              <MediaSettings />
            </>
          ) : null}

          {show("packs") ? (
            <>
              <PacksSection />
              <UpdateGroup />
            </>
          ) : null}

          {show("automation") ? <AutomationSection /> : null}

          {show("data") ? <EmbeddingsSection /> : null}

          {show("migrate") ? <MigrationSection /> : null}

          {/* Last, and on its own: the only control here that ends the
              session rather than changing it. */}
          <div className="mt-[26px] border-t border-rule pt-[18px]">
            <button type="button" className="btn w-full" onClick={() => signOut.mutate(undefined)}>
              {strings.settings.signOut}
            </button>
          </div>
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
