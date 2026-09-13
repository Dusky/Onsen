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
import { INJECTION_ROLES, MIN_PASSWORD_LENGTH, type MoveDirection } from "@shared/types.ts";
import { LAYOUT_PRESETS, READING_BOUNDS, READING_DEFAULTS } from "@shared/types.ts";
import type { ReaderDto, ReadingDto } from "@shared/types.ts";
import type { LayoutDto, LayoutPreset } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { navigate } from "../lib/router.ts";
import {
  useConnectionProfiles,
  useCreatePreset,
  useImportPreset,
  usePresets,
  useProviders,
  useTasks,
  useUpdateTask,
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
  useInstallPackFromUrl,
  useWebhooks,
  useScenes,
  usePreferences,
  useExportSettings,
  useImportSettings,
  useReader,
  useReading,
  useSetPreferences,
  useApiKeys,
  useSignOut,
  useChangePassword,
  useMoveScript,
  useMoveTrigger,
} from "../lib/queries.ts";
import { useIsDesktop } from "../lib/breakpoint.ts";
import { Sheet } from "../components/Sheet.tsx";
import { Scroller } from "../components/Scroller.tsx";
import { PresetEditor, PresetFields } from "../components/PresetEditor.tsx";
import { ScriptEditor } from "../components/ScriptEditor.tsx";
import { TriggerEditor } from "../components/TriggerEditor.tsx";
import { ExportPackSheet, InstallPackSheet, RemovePackSheet } from "../components/PackSheets.tsx";
import { ExtensionsSection } from "../components/ExtensionManager.tsx";
import { WebhookEditor } from "../components/WebhookEditor.tsx";
import { ApiKeyEditor } from "../components/ApiKeyEditor.tsx";
import { MediaSettings } from "../components/MediaSettings.tsx";
import { MigrationSection } from "../components/MigrationSection.tsx";
import { ThemeSection } from "../components/ThemeSection.tsx";
import { BrandingSection } from "../components/BrandingSection.tsx";
import { Segmented } from "../components/Segmented.tsx";
import { DockSection } from "../components/DockEditor.tsx";
import {
  ProfileEditor,
  ProfileFields,
  ProviderEditor,
  ProviderFields,
  Row,
  kindLabel,
  statusDot,
} from "../components/ConnectionFields.tsx";

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
  return (
    <Sheet title={task.label} onClose={onClose}>
      <div className="pt-[8px] pb-[14px]">
        <OpFields task={task} profiles={profiles} />
      </div>
    </Sheet>
  );
}

/**
 * The op's controls, shared by the desktop's inline expansion and the phone's
 * sheet, so the two cannot drift into different editors (SPEC §16 §Density
 * rule 3, §20 phase 71).
 */
function OpFields({ task, profiles }: { task: TaskDto; profiles: ConnectionProfileDto[] }) {
  const update = useUpdateTask();
  const [template, setTemplate] = useState(task.promptTemplate ?? task.defaultTemplate);

  return (
    <>
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
    </>
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
            className="chrome flex-none text-ui"
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
    save.mutate({ layout: patch });
  }

  return (
    <>
      <p className="section-label mb-[6px]">{strings.settings.layout}</p>

      {/* Four now, so it wraps: a fourth button squeezed onto one phone row
          would be under the tap floor, and the floor is not negotiable. */}
      <div className="mb-[8px] flex flex-wrap gap-[6px]">
        {(["instrument", "quiet", "broadsheet", "document"] as const).map((preset) => (
          <button
            key={preset}
            type="button"
            aria-pressed={layout.preset === preset}
            onClick={() => set({ preset })}
            // A basis rather than bare `flex-1`: four items that may all shrink
            // never wrap, they just get narrow, and narrow is the one thing a
            // button is not allowed to get.
            className={`btn flex-1 basis-[120px] ${layout.preset === preset ? "btn-primary" : ""}`}
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
          { value: "runin", label: strings.settings.layoutAttributionRunin },
        ]}
        onPick={(next) => set({ attribution: next })}
      />

      {/* Shape, per side (§20 phase 57). Two switches each rather than one
          global pair, because the reader's turns and the author's rarely want
          the same treatment — bubbles for what you typed, flat prose for the
          story is the common case, and it is the default Instrument ships. */}
      {(["reader", "author"] as const).map((which) => (
        <div key={which}>
          <Segmented
            label={
              which === "reader"
                ? strings.settings.layoutShapeReader
                : strings.settings.layoutShapeAuthor
            }
            value={layout[which].bubble ? "bubble" : "flat"}
            options={[
              { value: "flat", label: strings.settings.layoutFlat },
              { value: "bubble", label: strings.settings.layoutBubble },
            ]}
            onPick={(next) => set({ [which]: { ...layout[which], bubble: next === "bubble" } })}
          />
          <div className="-mt-[8px]" />
          <Segmented
            label=""
            value={layout[which].avatar ? "on" : "off"}
            options={[
              { value: "off", label: strings.settings.layoutAvatarOff },
              { value: "on", label: strings.settings.layoutAvatarOn },
            ]}
            onPick={(next) => set({ [which]: { ...layout[which], avatar: next === "on" } })}
          />
        </div>
      ))}

      <Segmented
        label={strings.settings.layoutAvatarShape}
        value={layout.avatarShape}
        options={[
          { value: "circle", label: strings.settings.layoutAvatarCircle },
          { value: "square", label: strings.settings.layoutAvatarSquare },
        ]}
        onPick={(next) => set({ avatarShape: next })}
      />
    </>
  );
}

/**
 * The reading surface (SPEC §16 §Density, §20 phase 55).
 *
 * A live sample sits under the sliders and is set in the real prose tokens, so
 * moving one shows the result rather than describing it — the design's own
 * instruction to explain by showing, and the reason there is no sentence here
 * telling anyone what "line spacing" means.
 *
 * The properties are applied globally by `useReadingVariables`, so the sample
 * needs no styling of its own: it is already the thing being changed.
 */
function ReadingControls() {
  const reading = useReading();
  const save = useSetPreferences();
  const set = (patch: Partial<ReadingDto>) => save.mutate({ reading: { ...reading, ...patch } });

  const sliders: { key: keyof ReadingDto; label: string; step: number }[] = [
    { key: "scale", label: strings.settings.prose, step: 0.05 },
    { key: "measure", label: strings.settings.proseMeasure, step: 20 },
    { key: "leading", label: strings.settings.proseLeading, step: 0.05 },
    // A count of turns, not a measure of the page — but it belongs beside the
    // others because it is the same kind of decision: how much of the roleplay
    // is in front of you at once (§20 phase 62).
    { key: "window", label: strings.settings.historyWindow, step: 10 },
  ];

  return (
    <>
      {sliders.map(({ key, label, step }) => {
        const [min, max] = READING_BOUNDS[key];
        return (
          <label key={String(key)} className="row block">
            <span className="flex items-baseline justify-between gap-[10px]">
              <span className="section-label">{label}</span>
              <span className="meta tabular-nums">
                {key === "measure"
                  ? `${reading[key]}px`
                  : key === "window"
                    ? String(reading[key])
                    : reading[key].toFixed(2)}
              </span>
            </span>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={reading[key]}
              aria-label={label}
              className="mt-[6px] w-full"
              onChange={(event) => set({ [key]: Number(event.target.value) } as Partial<ReadingDto>)}
            />
          </label>
        );
      })}

      <p className="mt-[10px] text-[length:var(--onsen-text-prose)] leading-[var(--onsen-leading-prose)]">
        {strings.settings.proseSample}
      </p>

      <button
        type="button"
        className="btn mt-[10px] w-full"
        onClick={() => set(READING_DEFAULTS)}
      >
        {strings.settings.proseReset}
      </button>
    </>
  );
}

/**
 * The controls that belong to the person reading and writing (§20 phase 166).
 *
 * Beside the reading surface rather than inside it: that is four numbers with
 * bounds, published as custom properties; these are discrete behaviours, and
 * the two would have had to mean the same thing to share a type.
 *
 * Every one of them is something the app decided for the reader until now, and
 * every default is what it already did — so nothing here changes behaviour
 * until it is touched. `docs/design/DESIGN.md` says a turn has "no avatar, no
 * timestamp, no shadow", which is why timestamps are an opt-in rather than a
 * correction.
 */
function ReaderControls() {
  const reader = useReader();
  const save = useSetPreferences();
  const set = (patch: Partial<ReaderDto>) => save.mutate({ reader: patch });
  const onOff = [
    { value: "off" as const, label: strings.lore.off },
    { value: "on" as const, label: strings.lore.on },
  ];

  return (
    <>
      <p className="section-label mb-[6px]">{strings.settings.reader}</p>

      <Segmented
        label={strings.settings.readerSend}
        value={reader.send}
        options={[
          { value: "enter", label: strings.settings.readerSendEnter },
          { value: "modEnter", label: strings.settings.readerSendMod },
          { value: "button", label: strings.settings.readerSendButton },
        ]}
        onPick={(send) => set({ send })}
      />

      <Segmented
        label={strings.settings.readerMarks}
        value={reader.marks ? "on" : "off"}
        options={onOff}
        onPick={(next) => set({ marks: next === "on" })}
      />

      <Segmented
        label={strings.settings.readerTimestamps}
        value={reader.timestamps ? "on" : "off"}
        options={onOff}
        onPick={(next) => set({ timestamps: next === "on" })}
      />

      <Segmented
        label={strings.settings.readerAutoScroll}
        value={reader.autoScroll ? "on" : "off"}
        options={onOff}
        onPick={(next) => set({ autoScroll: next === "on" })}
      />

      <Segmented
        label={strings.settings.readerClickToEdit}
        value={reader.clickToEdit ? "on" : "off"}
        options={onOff}
        onPick={(next) => set({ clickToEdit: next === "on" })}
      />

      <Segmented
        label={strings.settings.readerDrafts}
        value={reader.drafts ? "on" : "off"}
        options={onOff}
        onPick={(next) => set({ drafts: next === "on" })}
      />

      <Segmented
        label={strings.settings.readerMedia}
        value={reader.media}
        options={[
          { value: "list", label: strings.settings.readerMediaList },
          { value: "grid", label: strings.settings.readerMediaGrid },
        ]}
        onPick={(media) => set({ media })}
      />

      <Segmented
        label={strings.settings.readerNotices}
        value={reader.notices}
        options={[
          { value: "top", label: strings.settings.readerNoticesTop },
          { value: "topRight", label: strings.settings.readerNoticesTopRight },
          { value: "bottomRight", label: strings.settings.readerNoticesBottomRight },
        ]}
        onPick={(notices) => set({ notices })}
      />

      <Segmented
        label={strings.settings.readerMotion}
        value={reader.motion}
        options={[
          { value: "system", label: strings.settings.readerMotionSystem },
          { value: "reduced", label: strings.settings.readerMotionReduced },
        ]}
        onPick={(motion) => set({ motion })}
      />
    </>
  );
}

/**
 * The whole setup as one file (§20 phase 168).
 *
 * At the end of the Reading group rather than in a category of its own,
 * because what it carries is everything above it: the theme, the sliders, the
 * layout, the reader's controls. A section that travels with the thing it is
 * about needs no explaining.
 *
 * The outcome goes to the notice region rather than to inline text here. It is
 * a background task that finished — and the useful case is a reader who
 * exported, then went on reading, and wants to know the file was written.
 */
function SetupSection() {
  const file = useRef<HTMLInputElement>(null);
  const save = useExportSettings();
  const load = useImportSettings();

  return (
    <>
      <p className="section-label mb-[6px]">{strings.settings.setup}</p>
      <div className="mb-[14px] flex flex-wrap gap-[6px]">
        <button
          type="button"
          className="btn flex-1 basis-[140px]"
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          {strings.settings.setupExport}
        </button>
        <button
          type="button"
          className="btn flex-1 basis-[140px]"
          disabled={load.isPending}
          onClick={() => file.current?.click()}
        >
          {strings.settings.setupImport}
        </button>
        <input
          ref={file}
          type="file"
          hidden
          accept=".json,application/json"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            // Cleared so choosing the same file twice fires again, which a
            // file input otherwise refuses to do.
            event.target.value = "";
            if (chosen !== undefined) load.mutate(chosen);
          }}
        />
      </div>
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

      <ReadingControls />

      <LayoutSection />

      <DockSection />

      <ReaderControls />

      <SetupSection />

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
            className="tap flex w-full items-baseline gap-[9px] text-left"
          >
            {statusDot(!key.revoked)}
            <span className="min-w-0 flex-1">
              <span
                className="block truncate text-[15px] font-medium"
                style={{ opacity: key.revoked ? 0.55 : 1 }}
              >
                {key.name}
              </span>
              <span className="chrome block truncate text-ui text-ink-dim">
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
              className="tap flex w-full items-baseline gap-[9px] text-left"
            >
              {statusDot(webhook.enabled && !failing)}
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate text-[15px] font-medium"
                  style={{ opacity: webhook.enabled ? 1 : 0.55 }}
                >
                  {webhook.name}
                </span>
                <span className="chrome block truncate text-ui text-ink-dim">
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
  const installUrl = useInstallPackFromUrl();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ file: File; plan: PackPlanDto } | null>(null);
  const [removing, setRemoving] = useState<InstalledPackDto | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);

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
            className="tap flex w-full items-baseline gap-[9px] text-left"
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

      {/* An extension is a repository; install it by URL, the way SillyTavern
          installs extensions (§20 phase 109). */}
      <form
        className="mt-[8px] flex gap-[6px]"
        onSubmit={(event) => {
          event.preventDefault();
          if (url.trim() === "") return;
          setUrlError(null);
          installUrl.mutate(url.trim(), {
            onSuccess: () => setUrl(""),
            onError: (caught) => setUrlError(caught.message),
          });
        }}
      >
        <input
          className="field min-h-0 flex-1 py-[8px] text-[13px]"
          placeholder={strings.settings.packUrlPlaceholder}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
        <button type="submit" className="btn flex-none px-[12px]" disabled={installUrl.isPending || url.trim() === ""}>
          {installUrl.isPending ? strings.settings.packInstalling : strings.settings.packInstallUrl}
        </button>
      </form>
      {urlError !== null ? (
        <p className="explain explain-alert mt-[6px]">{urlError}</p>
      ) : null}

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
/**
 * Up and down, for a list whose order is the point.
 *
 * Arrows rather than drag, for the reason `PresetEditor`'s prompt manager
 * gives: there is no drag-reorder anywhere in this client to match, HTML5 drag
 * is poor under a thumb, and a library is a dependency for something an arrow
 * does. The label carries the row's name because six of these in a column are
 * otherwise six identical "Move up" buttons to a screen reader.
 *
 * No disabled state at the ends. Which row is first depends on the *stage* or
 * *event* it belongs to rather than its position in this list, so a row that
 * looks like the last one here may have somewhere to go — the server answers
 * that question and does nothing when there is nowhere.
 */
function Arrows({
  name,
  onMove,
}: {
  name: string;
  onMove(direction: MoveDirection): void;
}) {
  return (
    <span className="flex flex-none items-center self-center">
      <button
        type="button"
        aria-label={`${strings.settings.blockUp} ${name}`}
        onClick={() => onMove("up")}
        className="chrome tap flex items-center justify-center px-[6px] text-[12px] text-ink-dim hover:text-ink-label"
      >
        ↑
      </button>
      <button
        type="button"
        aria-label={`${strings.settings.blockDown} ${name}`}
        onClick={() => onMove("down")}
        className="chrome tap flex items-center justify-center px-[6px] text-[12px] text-ink-dim hover:text-ink-label"
      >
        ↓
      </button>
    </span>
  );
}

function AutomationSection() {
  const scripts = useScripts();
  const triggers = useTriggers();
  const actions = useTriggerActions();
  const moveScript = useMoveScript();
  const moveTrigger = useMoveTrigger();
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
         <div className="flex items-center gap-[4px]">
          <button
            type="button"
            onClick={() => setEditingScript(script)}
            className="tap flex w-full items-baseline gap-[9px] text-left"
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
          <Arrows
            name={script.name}
            onMove={(direction) => moveScript.mutate({ id: script.id, direction })}
          />
         </div>
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
         <div className="flex items-center gap-[4px]">
          <button
            type="button"
            onClick={() => setEditingTrigger(trigger)}
            className="tap flex w-full items-baseline gap-[9px] text-left"
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
          <Arrows
            name={trigger.name}
            onMove={(direction) => moveTrigger.mutate({ id: trigger.id, direction })}
          />
         </div>
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
  const [source, setSource] = useState<"local" | "endpoint" | "lexical">(
    config.data?.source ?? "local",
  );

  function setSourceAndSave(next: "local" | "endpoint" | "lexical") {
    setSource(next);
    save.mutate(
      { source: next, ...(next === "endpoint" ? {} : { baseUrl: null, model: null }) },
      { onSuccess: () => setSaved(true) },
    );
  }

  return (
    <>
      <p className="group-heading mb-[12px]">{strings.settings.embeddings}</p>

      <p className="section-label mb-[6px]">{strings.settings.embeddingsSource}</p>
      <div className="mb-[10px] flex flex-wrap gap-[6px]">
        {(["local", "endpoint", "lexical"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={source === option}
            onClick={() => setSourceAndSave(option)}
            className={`btn flex-none ${source === option ? "btn-primary" : ""}`}
          >
            {option === "local"
              ? strings.settings.embeddingsSourceLocal
              : option === "endpoint"
                ? strings.settings.embeddingsSourceEndpoint
                : strings.settings.embeddingsSourceLexical}
          </button>
        ))}
      </div>
      <p className="explain mb-[12px]">
        {source === "local"
          ? strings.settings.embeddingsLocal
          : source === "lexical"
            ? strings.settings.embeddingsLexical
            : strings.settings.embeddingsBaseUrl}
      </p>

      {source !== "endpoint" ? null : (
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
                source: "endpoint",
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
      )}
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
  { id: "branding", words: ["logo", "mark", "icon", "wordmark", "silhouette", "branding"] },
  { id: "backgrounds", words: ["backdrop", "background", "wallpaper", "picture"] },
  { id: "media", words: ["picture", "voice", "image", "speech", "tts", "draw", "caption"] },
  { id: "data", words: ["embedding", "document", "retrieval", "rag", "data bank"] },
  { id: "automation", words: ["trigger", "script", "regex", "action", "event"] },
  { id: "outward", words: ["api key", "webhook", "outbound", "bridge", "token"] },
  { id: "packs", words: ["pack", "update", "import", "export", "version", "extension"] },
  {
    id: "migrate",
    words: ["sillytavern", "migrate", "move", "switch", "chats", "jsonl", "import"],
  },
] as const;

type CategoryId = (typeof CATEGORIES)[number]["id"];

/**
 * Changing the password, which is also the app's only session revocation.
 *
 * Two fields and a consequence worth stating: the server bumps a generation
 * counter that every outstanding cookie is checked against, so this signs out
 * every other device. The one making the change is re-issued in the response
 * and stays put — a password change that logged you out would be indisputably
 * correct and completely useless.
 */
function PasswordSheet({ onClose }: { onClose(): void }) {
  const change = useChangePassword();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  return (
    <Sheet title={strings.settings.changePassword} onClose={onClose}>
      <form
        className="pt-[8px] pb-[14px]"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          change.mutate(
            { current, next },
            {
              onSuccess: () => {
                setDone(true);
                setCurrent("");
                setNext("");
              },
              onError: (caught: Error) => setError(caught.message),
            },
          );
        }}
      >
        <p className="section-label mb-[6px]">{strings.settings.currentPassword}</p>
        <input
          type="password"
          autoComplete="current-password"
          className="field mb-[14px]"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          required
        />

        <p className="section-label mb-[6px]">{strings.settings.newPassword}</p>
        <input
          type="password"
          autoComplete="new-password"
          className="field mb-[14px]"
          value={next}
          onChange={(event) => setNext(event.target.value)}
          minLength={MIN_PASSWORD_LENGTH}
          required
        />

        {error !== null ? <p className="explain explain-alert mb-[12px]">{error}</p> : null}
        {done ? <p className="explain mb-[12px]">{strings.settings.changePasswordDone}</p> : null}

        <button type="submit" className="btn btn-primary w-full" disabled={change.isPending}>
          {strings.settings.changePasswordGo}
        </button>
      </form>
    </Sheet>
  );
}

export function SettingsScreen() {
  const signOut = useSignOut();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [category, setCategory] = useState<CategoryId>("models");
  const [filter, setFilter] = useState("");
  const isDesktop = useIsDesktop();

  /**
   * Which categories the filter leaves standing. An empty filter leaves all of
   * them, so typing is additive rather than a mode to get into and out of. The
   * preset editor moved to the left rail's Preset tab, so on a desktop this
   * category is not here at all — the rail is the one surface (§20 phase 106).
   */
  const needle = filter.trim().toLowerCase();
  const matching = CATEGORIES.filter(
    (entry) =>
      !(isDesktop && entry.id === "generation") &&
      (needle === "" ||
        (strings.settings.categories[entry.id] ?? entry.id).toLowerCase().includes(needle) ||
        entry.words.some((word) => word.includes(needle))),
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
  const createPreset = useCreatePreset();
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
  /** The op expanded inline in the routing list, desktop only (§20 phase 71). */
  const [openOp, setOpenOp] = useState<string | null>(null);

  const profileList = profiles.data ?? [];
  const providerList = providers.data ?? [];
  const byId = new Map(providerList.map((provider) => [provider.id, provider]));

  return (
    <div className="flex screen-height flex-col bg-bg">
      <header
        className="screen-header screen-header-wide hairline flex-none px-[22px] pb-[14px]"
        style={{ paddingTop: "22px" }}
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
        {/* Ten categories in 390px: four fit and six sat off the right edge
            with nothing saying so, which on a phone made Automation and
            Connections out unreachable for a reader who did not guess to
            swipe. `Scroller` fades whichever edge still has something past
            it. */}
        <Scroller className="-mx-[4px] flex gap-[3px]" watch={matching.length}>
          {matching.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setCategory(entry.id)}
              aria-current={entry.id === active ? "page" : undefined}
              className="chrome flex min-h-[44px] flex-none items-center px-[10px] text-[13px]"
              style={{
                color:
                  entry.id === active
                    ? "var(--onsen-color-text)"
                    : "var(--onsen-color-text-muted)",
                // Interactive/selected — blue, matching the rails' own active
                // tab (design review fix 1, follow-up sweep).
                borderBottom: `2px solid ${entry.id === active ? "var(--onsen-color-blue)" : "transparent"}`,
              }}
            >
              {strings.settings.categories[entry.id] ?? entry.id}
            </button>
          ))}
        </Scroller>
      </div>

      <div className="flex min-h-0 flex-1">
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
          {providerList.map((provider) => {
            const isOpen = isDesktop && editingProviderId === provider.id;
            return (
              <Row key={provider.id}>
                <button
                  type="button"
                  onClick={() => setEditingProviderId(isOpen ? undefined : provider.id)}
                  aria-expanded={isDesktop ? isOpen : undefined}
                  className="tap flex w-full gap-[9px] text-left"
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
                  <span className="chrome flex-none self-center text-[12px] text-ink-dim">
                    {isDesktop ? (isOpen ? "▾" : "›") : "›"}
                  </span>
                </button>
                {isOpen ? (
                  <div className="mt-[14px] border-t border-rule pt-[14px]">
                    <ProviderFields
                      provider={provider}
                      onClose={() => setEditingProviderId(undefined)}
                    />
                  </div>
                ) : null}
              </Row>
            );
          })}
          {isDesktop && editingProviderId === null ? (
            <div className="mb-[26px] mt-[12px] border-t border-rule pt-[14px]">
              <ProviderFields provider={null} onClose={() => setEditingProviderId(undefined)} />
            </div>
          ) : (
            <button
              type="button"
              className="btn mt-[12px] mb-[26px] w-full"
              onClick={() => setEditingProviderId(null)}
            >
              {strings.settings.addProvider}
            </button>
          )}

          {/* Profiles */}
          <p className="group-heading mb-[12px]">{strings.settings.profiles}</p>
          {profileList.map((profile) => {
            const isOpen = isDesktop && editingProfile?.id === profile.id;
            return (
              <Row key={profile.id}>
                <button
                  type="button"
                  onClick={() => setEditingProfile(isOpen ? undefined : profile)}
                  aria-expanded={isDesktop ? isOpen : undefined}
                  className="tap flex w-full items-baseline gap-[9px] text-left"
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
                      className="chrome flex-none text-[12px]"
                      style={{ color: "var(--onsen-color-amber)" }}
                    >
                      {strings.settings.profileDefault}
                    </span>
                  ) : null}
                  <span className="chrome flex-none self-center text-[12px] text-ink-dim">
                    {isDesktop ? (isOpen ? "▾" : "›") : "›"}
                  </span>
                </button>
                {isOpen ? (
                  <div className="mt-[14px] border-t border-rule pt-[14px]">
                    <ProfileFields
                      profile={profile}
                      providers={providerList}
                      onClose={() => setEditingProfile(undefined)}
                    />
                  </div>
                ) : null}
              </Row>
            );
          })}
          {isDesktop && editingProfile === null ? (
            <div className="mb-[26px] mt-[12px] border-t border-rule pt-[14px]">
              <ProfileFields
                profile={null}
                providers={providerList}
                onClose={() => setEditingProfile(undefined)}
              />
            </div>
          ) : (
            <button
              type="button"
              className="btn mt-[12px] mb-[26px] w-full"
              onClick={() => setEditingProfile(null)}
            >
              {strings.settings.addProfile}
            </button>
          )}

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
                className="tap flex w-full items-baseline gap-[9px] text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-[8px]">
                    <span className="truncate text-[15px] font-medium">{preset.name}</span>
                    {preset.isDefault ? (
                      <span className="meta flex-none" style={{ color: "var(--onsen-color-amber)" }}>
                        {strings.settings.presetIsDefault}
                      </span>
                    ) : null}
                  </span>
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
          <button
            type="button"
            className="btn mt-[12px] w-full"
            disabled={createPreset.isPending}
            onClick={() =>
              createPreset.mutate(strings.settings.addPreset, {
                onSuccess: (made) => setEditingPreset(made),
              })
            }
          >
            {strings.settings.addPreset}
          </button>
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
            const isOpen = isDesktop && openOp === task.key;
            return (
              <Row key={task.key}>
                <button
                  type="button"
                  onClick={() =>
                    isDesktop ? setOpenOp(isOpen ? null : task.key) : setEditingOp(task)
                  }
                  aria-expanded={isDesktop ? isOpen : undefined}
                  className="tap flex w-full items-baseline gap-[9px] text-left"
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
                  <span className="chrome flex-none text-ui text-ink-muted">
                    {routed}
                  </span>
                  <span className="chrome flex-none self-center text-[12px] text-ink-dim">
                    {isDesktop ? (isOpen ? "▾" : "›") : "›"}
                  </span>
                </button>

                {/* With room, the options are the row itself (design 4a,
                    §20 phase 71): expand in place, no sheet between the reader
                    and the setting. On a phone there is no room, so the sheet
                    stays. */}
                {isOpen ? (
                  <div className="mt-[14px] border-t border-rule pt-[14px]">
                    <OpFields task={task} profiles={profileList} />
                  </div>
                ) : null}
              </Row>
            );
          })}
            </>
          ) : null}
          <div className="h-[20px]" />

          {show("reading") ? <ReadingSection /> : null}

          {show("branding") ? <BrandingSection /> : null}

          {/* Backgrounds has no rail of its own — it is configured once
              rather than worked in, so it links out to its own screen
              instead of inventing a fourth destination (design review
              fix 5). */}
          {show("backgrounds") ? (
            <>
              <p className="group-heading mb-[12px]">{strings.settings.categories.backgrounds}</p>
              <button
                type="button"
                className="btn"
                onClick={() => navigate({ name: "backgrounds" })}
              >
                {strings.settings.backgroundsOpen}
              </button>
            </>
          ) : null}

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
              <p className="group-heading mb-[12px] mt-[22px]">{strings.settings.extensions}</p>
              <ExtensionsSection />
              <UpdateGroup />
            </>
          ) : null}

          {show("automation") ? <AutomationSection /> : null}

          {show("data") ? <EmbeddingsSection /> : null}

          {show("migrate") ? <MigrationSection /> : null}

          {/* Last, and on their own: the two controls here that act on the
              session rather than on what is in it. The password change is
              beside Sign out because it is the stronger version of it — the
              server bumps a generation counter every outstanding cookie is
              checked against, so it signs out every *other* device too, which
              is the only revocation this install has. */}
          <div className="mt-[26px] flex flex-col gap-[8px] border-t border-rule pt-[18px]">
            <button type="button" className="btn w-full" onClick={() => setPasswordOpen(true)}>
              {strings.settings.changePassword}
            </button>
            <button type="button" className="btn w-full" onClick={() => signOut.mutate(undefined)}>
              {strings.settings.signOut}
            </button>
          </div>
        </div>
      </main>

      {passwordOpen ? <PasswordSheet onClose={() => setPasswordOpen(false)} /> : null}

      {/* The preset editor deserves more than a sheet (§20 phase 73): with
          room it is a pane beside the list, the same shape the chat screen's
          inspector takes. The body is the one `PresetFields`, so the pane and
          the phone's sheet cannot drift. */}
      {isDesktop && editingPreset !== null ? (
        <aside className="flex w-[480px] flex-none flex-col overflow-y-auto border-l border-rule bg-bg-sunken">
          <div className="hairline flex flex-none items-baseline gap-[10px] px-[18px] py-[13px]">
            <p className="section-label flex-1 truncate">{editingPreset.name}</p>
            <button
              type="button"
              aria-label={strings.common.back}
              className="chrome flex-none text-[13px] text-ink-muted"
              onClick={() => setEditingPreset(null)}
            >
              ×
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-[18px] py-[14px]">
            <PresetFields
              preset={
                (presets.data ?? []).find((row) => row.id === editingPreset.id) ?? editingPreset
              }
              onClose={() => setEditingPreset(null)}
            />
          </div>
        </aside>
      ) : null}
      </div>

      {!isDesktop && editingProviderId !== undefined ? (
        <ProviderEditor
          provider={
            editingProviderId === null
              ? null
              : (providerList.find((row) => row.id === editingProviderId) ?? null)
          }
          onClose={() => setEditingProviderId(undefined)}
        />
      ) : null}
      {!isDesktop && editingProfile !== undefined ? (
        <ProfileEditor
          profile={editingProfile}
          providers={providerList}
          onClose={() => setEditingProfile(undefined)}
        />
      ) : null}
      {!isDesktop && editingPreset !== null ? (
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
    </div>
  );
}
