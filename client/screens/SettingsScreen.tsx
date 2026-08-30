import { useState } from "react";
import type { ConnectionProfileDto, PresetDto, ProviderDto, TaskDto } from "@shared/types.ts";
import { PROVIDER_KINDS, INJECTION_ROLES } from "@shared/types.ts";
import { strings } from "../strings.ts";
import {
  useConnectionProfiles,
  useCreateProfile,
  useCreateProvider,
  useDeleteProfile,
  useDeleteProvider,
  usePresets,
  useProviders,
  useTasks,
  useUpdateProfile,
  useUpdateProvider,
  useUpdateTask,
} from "../lib/queries.ts";
import { TabBar } from "../components/TabBar.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { PresetEditor } from "../components/PresetEditor.tsx";

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
  const [error, setError] = useState<string | null>(null);

  return (
    <Sheet
      title={provider === null ? strings.settings.addProvider : provider.name}
      onClose={onClose}
    >
      <form
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
                  {kind}
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
        <input name="model" className="field mb-[14px]" defaultValue={provider?.model ?? ""} />

        <p className="section-label mb-[6px]">{strings.settings.providerKey}</p>
        <input name="apiKey" type="password" className="field" autoComplete="off" />
        <p className="chrome mt-[6px] mb-[14px] text-[9px] leading-[1.5] text-ink-dim">
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
            <p className="chrome mb-[14px] text-[9px] leading-[1.5] text-ink-dim">
              {strings.settings.providerPrefillHint}
            </p>
          </>
        )}

        {error === null ? null : (
          <p className="chrome mb-[10px] text-[9.5px] leading-[1.5] text-red-text">{error}</p>
        )}

        <div className="flex gap-[8px]">
          <button type="submit" className="btn btn-primary flex-1">
            {strings.settings.save}
          </button>
          {provider === null ? null : (
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (!window.confirm(strings.settings.removeConfirm)) return;
                remove.mutate(provider.id, {
                  onSuccess: () => onClose(),
                  onError: (e) => setError(e.message),
                });
              }}
            >
              {strings.settings.remove}
            </button>
          )}
        </div>
      </form>
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

  return (
    <Sheet title={profile === null ? strings.settings.addProfile : profile.name} onClose={onClose}>
      <form
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
        <input name="model" className="field mb-[14px]" defaultValue={profile?.model ?? ""} />

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
              onClick={() => {
                if (!window.confirm(strings.settings.removeConfirm)) return;
                remove.mutate(profile.id, {
                  onSuccess: () => onClose(),
                  onError: (e) => setError(e.message),
                });
              }}
            >
              {strings.settings.remove}
            </button>
          )}
        </div>
      </form>
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
            <p className="chrome mb-[16px] text-[9px] leading-[1.5] text-ink-dim">
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
          <p className="chrome mb-[16px] text-[9px] leading-[1.5] text-ink-dim">
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
            <p className="chrome mt-[6px] text-[9px] leading-[1.5] text-ink-dim">
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

export function SettingsScreen() {
  const providers = useProviders();
  const profiles = useConnectionProfiles();
  const presets = usePresets();
  const tasks = useTasks();

  const [editingProvider, setEditingProvider] = useState<ProviderDto | null | undefined>(undefined);
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
        className="hairline flex-none px-[22px] pb-[14px]"
        style={{ paddingTop: "calc(22px + env(safe-area-inset-top))" }}
      >
        <p className="screen-kicker">{strings.settings.kicker}</p>
        <h1 className="screen-title mt-[6px]">{strings.settings.title}</h1>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-[22px] py-[16px]">
        <div className="mx-auto w-full max-w-[var(--onsen-prose-measure)]">
          {/* Providers */}
          <p className="section-label mb-[4px]">{strings.settings.providers}</p>
          <p className="chrome mb-[10px] text-[9px] leading-[1.5] text-ink-dim">
            {strings.settings.providersHint}
          </p>
          {providerList.map((provider) => (
            <Row key={provider.id}>
              <button
                type="button"
                onClick={() => setEditingProvider(provider)}
                className="flex w-full gap-[9px] text-left"
              >
                {statusDot(provider.enabled && provider.baseUrl !== null)}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{provider.name}</span>
                  <span className="chrome block truncate text-[9px] tracking-[0.06em] text-ink-dim uppercase">
                    {[provider.model, provider.kind, provider.hasApiKey ? "keyed" : null]
                      .filter((part) => part !== null && part !== "")
                      .join(" · ")}
                  </span>
                </span>
              </button>
            </Row>
          ))}
          <button
            type="button"
            className="btn mt-[12px] mb-[26px] w-full"
            onClick={() => setEditingProvider(null)}
          >
            {strings.settings.addProvider}
          </button>

          {/* Profiles */}
          <p className="section-label mb-[4px]">{strings.settings.profiles}</p>
          <p className="chrome mb-[10px] text-[9px] leading-[1.5] text-ink-dim">
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
          <p className="chrome mb-[10px] text-[9px] leading-[1.5] text-ink-dim">
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
              </button>
            </Row>
          ))}
          <div className="mb-[26px]" />

          {/* Routing by operation — the interesting one. */}
          <p className="section-label mb-[4px]">{strings.settings.routing}</p>
          <p className="chrome mb-[10px] text-[9px] leading-[1.5] text-ink-dim">
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
                </button>
              </Row>
            );
          })}
          <div className="h-[20px]" />
        </div>
      </main>

      {editingProvider !== undefined ? (
        <ProviderEditor
          provider={editingProvider}
          onClose={() => setEditingProvider(undefined)}
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
