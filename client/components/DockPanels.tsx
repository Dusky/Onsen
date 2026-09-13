import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BookMarked,
  Contact,
  Feather,
  ListChecks,
  MessageSquareOff,
  Plug,
  Sigma,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  AuthorDto,
  DockPanel,
  GuideDto,
  GuideKind,
  LoreActivationDto,
  PromptBlock,
  PromptDebugInfo,
} from "@shared/types.ts";
import { GUIDE_KINDS } from "@shared/types.ts";
import { strings } from "../strings.ts";
import {
  useAddBan,
  useAnalyseBans,
  useAuthors,
  useBans,
  useCharacters,
  useConnectionProfiles,
  useCreateAuthor,
  useCreateCharacter,
  useCreatePreset,
  useEditGuide,
  useFlushGuides,
  useImportCharacter,
  useImportPreset,
  useLoreActivation,
  usePresets,
  usePreviewPrompt,
  useRebuildGuides,
  useScene,
  useScenes,
  useTasks,
  useUpdateAuthor,
  useUpdateBan,
  useUpdatePreset,
  useUpdateScene,
  useUpdateTask,
} from "../lib/queries.ts";
import { useUiStore } from "../state/ui.ts";
import { PresetFields, PromptManager } from "./PresetEditor.tsx";
import { GuidesBody } from "./GuidesPanel.tsx";
import { TextField } from "./TextField.tsx";
import { LorePane } from "./LorePane.tsx";
import { EditorField } from "./EditorField.tsx";
import { CastEditPane } from "./CastEditPane.tsx";
import { ModelsPanel } from "./ModelsPanel.tsx";

/**
 * The nine panels the two rails can host, and the registry that makes any of
 * them dockable to either side (§20 phase 173).
 *
 * Six of these were already pure functions of a scene id, written before this
 * batch existed — `PromptPanel` through `AuthorPane` below are relocated from
 * `LeftRail.tsx` and `RightRail.tsx` verbatim, not rewritten, because a panel
 * being movable does not change what it draws. `models` is a seventh of that
 * kind, added by phase 179 and living in its own file because the credential
 * forms it renders are shared with the settings screen.
 *
 * The other two are not components of their own but slots `ChatScreen` fills
 * with live scene state, read back here wherever the reader has docked them:
 * `scene` with the Context/Cast/You panes, and `ooc` with the off-script
 * exchange (§20 phase 177), which had been a modal until the report that a
 * conversation held *while* reading does not belong over the log.
 */

interface PanelMeta {
  Icon: LucideIcon;
  /** Tab caption and collapsed-strip tooltip. */
  label: string;
  /** The left rail's own header bar, when this panel is open there. */
  titleLabel: string;
  Component: (props: { sceneId: string | null }) => ReactNode;
  /**
   * This panel manages its own height, scrolling and padding, so the rail
   * hands it the space and stays out of the way (§20 phase 177).
   *
   * Every other panel is a column of content the rail scrolls for it. `ooc` is
   * the first that cannot be: its composer is pinned under a scrolling log, and
   * a rail-level scroll container would scroll the composer off the bottom.
   */
  fills?: boolean;
}

/* ------------------------------------------------------------------ */
/* Prompt — the window being assembled                                 */
/* ------------------------------------------------------------------ */

/** What a block costs its share of the bar, coloured by where it sits. */
function blockColor(block: PromptBlock): string {
  if (block.placement.kind === "prefix") return "var(--onsen-color-amber)";
  if (block.placement.kind === "outlet") return "var(--onsen-color-blue)";
  return "var(--onsen-color-text-dim)"; // depth: the history
}

/** Where a block lands, for the provenance line under its name. */
function placementOf(block: PromptBlock): string {
  switch (block.placement.kind) {
    case "prefix":
      return strings.chat.inspectorPrefix;
    case "depth":
      return strings.chat.inspectorDepth(block.placement.depth);
    case "outlet":
      return strings.chat.inspectorOutlet(block.placement.name);
  }
}

export function PromptPanel({ sceneId }: { sceneId: string | null }) {
  const presets = usePresets();
  const preview = usePreviewPrompt(sceneId ?? "");
  const [debug, setDebug] = useState<PromptDebugInfo | null>(null);
  const [rawOpen, setRawOpen] = useState(false);

  // The panel mounts when the section is chosen, so choosing it is the fetch:
  // the next turn's prompt, block by block, with what the window could not
  // carry. It is a POST because assembling costs a token count, and it must be
  // asked for rather than polled.
  useEffect(() => {
    if (sceneId === null) {
      setDebug(null);
      return;
    }
    preview.mutate({}, { onSuccess: (dto) => setDebug(dto.debug) });
    // The mutation identity is not stable across renders; only re-fetch on the
    // scene, never on the mutation itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId]);

  // Outside a roleplay there is nothing assembled yet, but the prompt's
  // structure — the blocks, their order and their switches — is the preset's
  // and is edited here (§20 phase 100).
  if (sceneId === null) {
    const preset =
      (presets.data ?? []).find((row) => row.isDefault) ?? (presets.data ?? [])[0] ?? null;
    if (preset === null) {
      return <p className="explain mt-[14px]">{strings.settings.presetDefault}</p>;
    }
    return (
      <div className="mt-[12px]">
        <PromptManager preset={preset} />
      </div>
    );
  }

  if (debug === null) {
    if (preview.isError) {
      return (
        <p className="explain-alert mt-[14px]">
          {preview.error instanceof Error ? preview.error.message : strings.errors.network}
        </p>
      );
    }
    return <p className="meta mt-[14px]">{strings.common.working}</p>;
  }

  // The summary's free percent, for the header line. The budget bar draws the
  // same numbers as a stripe; the header states them.
  const free = Math.max(debug.headroom, 0);
  const freePct = Math.round((free / Math.max(debug.totalTokens + free, 1)) * 100);

  return (
    <div>
      <div className="mt-[12px] flex items-baseline justify-between gap-[10px]">
        <span className="meta tabular-nums">
          {strings.leftRail.promptSummary(debug.totalTokens, debug.available, freePct)}
        </span>
        <span className="flex items-center gap-[12px]">
          <button
            type="button"
            className="chrome text-[12.5px]"
            aria-pressed={rawOpen}
            style={{ color: rawOpen ? "var(--onsen-color-amber)" : "var(--onsen-color-blue-text)" }}
            onClick={() => setRawOpen(!rawOpen)}
          >
            {strings.leftRail.viewRaw}
          </button>
          <button
            type="button"
            className="chrome text-[12.5px]"
            style={{ color: "var(--onsen-color-blue-text)" }}
            onClick={() => preview.mutate({}, { onSuccess: (dto) => setDebug(dto.debug) })}
          >
            {strings.leftRail.refresh}
          </button>
        </span>
      </div>

      {rawOpen ? (
        <pre className="chrome mt-[10px] max-h-[360px] overflow-auto border border-rule bg-bg-sunken px-[10px] py-[8px] text-[12.5px] leading-[1.6] whitespace-pre-wrap">
          {debug.blocks.map((block) => block.content).join("\n\n")}
        </pre>
      ) : (
        <>
          {/* The budget bar: one segment per block, the free headroom as the
              empty tail — the whole argument in a single stripe. */}
          <BudgetBar debug={debug} />

          <p className="section-label mt-[16px] mb-[6px]">{strings.chat.inspectorBlocks}</p>
          <BlockList debug={debug} />

          {debug.evicted.length > 0 ? (
            <>
              <p className="section-label mt-[16px] mb-[6px]">{strings.chat.inspectorEvicted}</p>
              {debug.evicted.map((item, index) => (
                <div
                  key={`${item.blockId}-${index}`}
                  className="flex items-baseline gap-[9px] border-b border-rule py-[8px]"
                >
                  <span className="chrome min-w-0 flex-1 truncate text-[12.5px] text-ink-dim">
                    {item.label}
                  </span>
                  <span
                    className="chrome flex-none text-[12.5px]"
                    style={{ color: "var(--onsen-color-red)" }}
                  >
                    {strings.chat.inspectorEviction[item.reason]}
                  </span>
                  <span className="chrome flex-none text-[12.5px] text-ink-muted">
                    {strings.chat.inspectorTokens(item.tokens)}
                  </span>
                </div>
              ))}
            </>
          ) : null}

          {/* The lore verdicts for this prompt: every entry considered, and
              what decided it. */}
          {debug.loreTrace.length > 0 ? (
            <>
              <p className="section-label mt-[16px] mb-[6px]">{strings.chat.inspectorLore}</p>
              {debug.loreTrace.map((entry) => (
                <div
                  key={entry.entryId}
                  className="flex items-baseline gap-[9px] border-b border-rule py-[8px]"
                >
                  <span
                    className="h-[7px] w-[7px] flex-none self-center"
                    style={{
                      background:
                        entry.skipped === null
                          ? "var(--onsen-color-green)"
                          : "var(--onsen-color-rule-strong)",
                    }}
                  />
                  <span className="chrome min-w-0 flex-1 truncate text-[12.5px] text-ink-dim">
                    {entry.title}
                  </span>
                  <span
                    className="chrome flex-none text-[12.5px]"
                    style={{
                      color: entry.skipped === null ? undefined : "var(--onsen-color-text-dim)",
                    }}
                  >
                    {entry.skipped === null
                      ? entry.matchedKey === null
                        ? strings.chat.inspectorLoreConstant
                        : strings.chat.inspectorLoreFired(entry.matchedKey)
                      : strings.chat.inspectorSkip[entry.skipped]}
                  </span>
                </div>
              ))}
            </>
          ) : null}

          {debug.unresolvedOutlets.length > 0 ? (
            <p className="chrome mt-[14px] text-[12.5px] leading-[1.5] text-ink-dim">
              {strings.chat.inspectorOutlets(debug.unresolvedOutlets.join(", "))}
            </p>
          ) : null}
          {debug.unknownMacros.length > 0 ? (
            <p className="chrome mt-[8px] text-[12.5px] leading-[1.5] text-ink-dim">
              {strings.chat.inspectorMacros(debug.unknownMacros.join(", "))}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function BudgetBar({ debug }: { debug: PromptDebugInfo }) {
  const free = Math.max(debug.headroom, 0);
  const total = Math.max(debug.totalTokens + free, 1);
  return (
    <div className="mt-[12px] flex h-[8px] w-full overflow-hidden" aria-hidden="true">
      {debug.blocks.map((block, index) => (
        <div
          key={`${block.id}-${index}`}
          style={{
            width: `${(block.tokens / total) * 100}%`,
            background: blockColor(block),
            flex: "none",
          }}
        />
      ))}
      <div
        style={{ width: `${(free / total) * 100}%`, background: "var(--onsen-color-rule-strong)" }}
      />
    </div>
  );
}

function BlockList({ debug }: { debug: PromptDebugInfo }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div>
      {debug.blocks.map((block, index) => {
        const key = `${index}-${block.id}`;
        const isOpen = open === key;
        return (
          <div key={key} className="border-b border-rule py-[9px]">
            <button
              type="button"
              className="flex w-full items-baseline gap-[9px] text-left"
              onClick={() => setOpen(isOpen ? null : key)}
            >
              <span
                className="mr-[5px] h-[7px] w-[7px] flex-none self-center"
                style={{ background: blockColor(block) }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{block.label}</span>
                <span className="meta block truncate">
                  {[block.source, placementOf(block), block.role]
                    .filter((part) => part !== "")
                    .join(" · ")}
                </span>
              </span>
              <span className="chrome flex-none text-[12.5px] text-ink-muted">
                {strings.chat.inspectorTokens(block.tokens)}
              </span>
            </button>
            {isOpen && block.content !== "" ? (
              <pre className="chrome mt-[8px] max-h-[240px] overflow-y-auto border border-rule bg-bg-sunken px-[10px] py-[8px] text-[12.5px] leading-[1.6] whitespace-pre-wrap">
                {block.content}
              </pre>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Preset — the samplers                                               */
/* ------------------------------------------------------------------ */

/** The three the mockup leads with; the rest live in the full editor. */
export function PresetPanel({ sceneId }: { sceneId: string | null }) {
  const presets = usePresets();
  const profiles = useConnectionProfiles();
  const update = useUpdatePreset();
  const create = useCreatePreset();
  const importPreset = useImportPreset();
  const fileInput = useRef<HTMLInputElement>(null);
  const [presetId, setPresetId] = useState<string | null>(null);
  const rows = presets.data ?? [];
  const preset =
    rows.find((row) => row.id === presetId) ??
    rows.find((row) => row.isDefault) ??
    rows[0] ??
    null;

  if (preset === null) {
    return <p className="explain mt-[14px]">{strings.settings.presetDefault}</p>;
  }

  return (
    <div className="mt-[12px]">
      {/* The presets as rows, not a dropdown: browsing is the point, and the
          default is stated rather than implied. */}
      <p className="section-label mb-[6px]">{strings.leftRail.presetTitle}</p>
      {rows.map((row) => {
        const on = row.id === preset.id;
        return (
          <button
            key={row.id}
            type="button"
            onClick={() => setPresetId(row.id)}
            aria-current={on ? "true" : undefined}
            className="flex w-full items-baseline gap-[8px] border-b border-rule py-[7px] text-left"
          >
            <span
              className="min-w-0 flex-1 truncate text-[13.5px] font-medium"
              style={{ color: on ? "var(--onsen-color-text)" : "var(--onsen-color-text-muted)" }}
            >
              {row.name}
            </span>
            {row.isDefault ? (
              <span className="chrome flex-none text-[11px] text-ink-dim">
                {strings.settings.presetDefaultBadge}
              </span>
            ) : null}
          </button>
        );
      })}

      {/* Make and import, then the selected preset's own actions — a preset is
          made, imported, saved, promoted and removed here rather than behind
          Settings (§20 phase 105). */}
      <div className="mt-[10px] flex gap-[6px]">
        <button
          type="button"
          className="btn flex-1 px-[8px]"
          disabled={create.isPending}
          onClick={() =>
            create.mutate(strings.settings.addPreset, { onSuccess: (made) => setPresetId(made.id) })
          }
        >
          {strings.settings.addPreset}
        </button>
        <button
          type="button"
          className="btn flex-1 px-[8px]"
          disabled={importPreset.isPending}
          onClick={() => fileInput.current?.click()}
        >
          {importPreset.isPending ? strings.settings.importingPreset : strings.settings.importPreset}
        </button>
      </div>
      <input
        ref={fileInput}
        type="file"
        hidden
        accept=".json,application/json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file === undefined) return;
          importPreset.mutate(file, { onSuccess: (report) => setPresetId(report.presetId) });
        }}
      />
      {importPreset.error !== null ? (
        <p className="explain explain-alert mb-[8px]">{importPreset.error.message}</p>
      ) : null}

      {/* The model this preset answers with, when the scene names none (§20
          phase 105). */}
      <label className="chrome mb-[6px] block text-[12.5px] text-ink-muted">
        {strings.leftRail.presetModel}
      </label>
      <select
        className="field mb-[16px]"
        value={preset.connectionProfileId ?? ""}
        onChange={(event) =>
          update.mutate({ id: preset.id, connectionProfileId: event.target.value || null })
        }
      >
        <option value="">{strings.leftRail.presetModelNone}</option>
        {(profiles.data ?? []).map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name}
          </option>
        ))}
      </select>

      {/*
       * The whole editor, not a subset of it (§20 phase 169).
       *
       * This panel's own comment has claimed since phase 106 that "the rail is
       * the editor, not a teaser that hides the rest behind a button" — and it
       * was true of the samplers and false of everything else. `PresetFields`
       * covers seven more sections: the context size, the automatic retries,
       * example eviction, squashed system turns, the prefill, the ops' prompts
       * and reasoning. None of them were reachable at desktop width at all,
       * because `SettingsScreen` drops its `generation` category on a desktop
       * precisely to leave this the one surface — so the only path to them was
       * to narrow the window.
       *
       * Found while adding the two precedence switches, which would have
       * shipped into the same dead end. The samplers, the export pair and the
       * default/delete buttons this replaced were all `PresetFields`' own,
       * reimplemented here; one copy is the point.
       */}
      <PresetFields preset={preset} onClose={() => setPresetId(null)} />

      {/* The ban list is per scene, so it sits here only while a roleplay is
          open (§13.6). */}
      {sceneId === null ? null : <BanList sceneId={sceneId} />}
    </div>
  );
}

/**
 * The ban list (SPEC §13.6): what the scene has stopped the model from
 * writing, editable in the rail the same way the prompt is.
 */
function BanList({ sceneId }: { sceneId: string }) {
  const bans = useBans(sceneId, true);
  const add = useAddBan(sceneId);
  const analyse = useAnalyseBans(sceneId);
  const update = useUpdateBan(sceneId);
  const [draft, setDraft] = useState("");

  const phrases = bans.data?.phrases ?? [];
  const active = phrases.filter((phrase) => phrase.enabled);
  const proposed = phrases.filter((phrase) => !phrase.enabled && phrase.origin === "proposed");

  return (
    <div className="mt-[22px]">
      <p className="section-label mb-[8px]">
        {strings.leftRail.banList} · {strings.chat.inspectorTokens(bans.data?.tokenCount ?? 0)}
      </p>

      {active.length === 0 && proposed.length === 0 ? (
        <p className="explain mb-[10px]">{strings.leftRail.banEmpty}</p>
      ) : null}

      {active.map((phrase) => (
        <div key={phrase.id} className="flex items-center gap-[8px] border-b border-rule py-[7px]">
          <span className="min-w-0 flex-1 truncate text-[13px]">{phrase.phrase}</span>
          {phrase.hits > 0 ? (
            <span className="meta flex-none">{strings.sceneSetup.bansHits(phrase.hits)}</span>
          ) : null}
          <button
            type="button"
            aria-label={strings.settings.remove}
            className="chrome flex-none text-[13px] text-ink-dim"
            onClick={() => update.mutate({ banId: phrase.id, enabled: false })}
          >
            {"×"}
          </button>
        </div>
      ))}

      {/* Proposals the analyser made, awaiting a decision (§13.6). */}
      {proposed.map((phrase) => (
        <div key={phrase.id} className="flex items-center gap-[8px] border-b border-rule py-[7px]">
          <span className="min-w-0 flex-1 truncate text-[13px]" style={{ color: "var(--onsen-color-text-dim)" }}>
            {phrase.phrase}
          </span>
          <button
            type="button"
            className="chrome flex-none text-[12.5px]"
            style={{ color: "var(--onsen-color-green)" }}
            onClick={() => update.mutate({ banId: phrase.id, accept: true })}
          >
            {strings.sceneSetup.bansAccept}
          </button>
        </div>
      ))}

      <form
        className="mt-[10px] flex gap-[6px]"
        onSubmit={(event) => {
          event.preventDefault();
          const value = draft.trim();
          if (value === "") return;
          add.mutate({ phrase: value });
          setDraft("");
        }}
      >
        <input
          className="field min-h-0 flex-1 py-[8px] text-[13px]"
          placeholder={strings.sceneSetup.bansPlaceholder}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="btn flex-none px-[12px]" disabled={draft.trim() === ""}>
          {strings.sceneSetup.bansAdd}
        </button>
      </form>

      <button
        type="button"
        className="btn mt-[8px] w-full"
        disabled={analyse.isPending}
        onClick={() => analyse.mutate(undefined)}
      >
        {strings.leftRail.banAnalyse}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lore — what fired                                                   */
/* ------------------------------------------------------------------ */

export function LorePanel({ sceneId }: { sceneId: string | null }) {
  const lore = useLoreActivation(sceneId ?? "", sceneId !== null);
  const rows = lore.data ?? [];
  // The fired/missed verdicts are per scene; the books themselves are not, so
  // the books are always here and the verdicts only while a roleplay is open
  // (§20 phase 100).
  const showActivation = sceneId !== null && rows.length > 0;

  return (
    <div className="mt-[12px]">
      {showActivation ? (
        <>
          <p className="meta mb-[6px]">{strings.leftRail.loreTitle}</p>
          {rows.map((entry) => <LoreRow key={entry.entryId} entry={entry} />)}
          <p className="section-label mt-[14px] mb-[4px]">{strings.lore.books}</p>
        </>
      ) : (
        <p className="section-label mb-[4px]">{strings.lore.books}</p>
      )}
      <LorePane />
    </div>
  );
}

function LoreRow({ entry }: { entry: LoreActivationDto }) {
  const fired = entry.skipped === null;
  return (
    <div className="flex items-baseline gap-[9px] border-b border-rule py-[8px]">
      <span
        className="h-[7px] w-[7px] flex-none self-center"
        style={{ background: fired ? "var(--onsen-color-green)" : "var(--onsen-color-rule-strong)" }}
      />
      <span
        className="chrome min-w-0 flex-1 truncate text-[12.5px]"
        style={{ color: fired ? "var(--onsen-color-text)" : "var(--onsen-color-text-dim)" }}
      >
        {entry.title}
      </span>
      <span className="chrome flex-none text-[12.5px] text-ink-muted">
        {fired
          ? entry.matchedKey === null
            ? strings.chat.inspectorLoreConstant
            : entry.matchedKey
          : strings.chat.inspectorSkip[entry.skipped!]}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Guides — injected now                                               */
/* ------------------------------------------------------------------ */

export function GuidesPanel({ sceneId }: { sceneId: string | null }) {
  const scene = useScene(sceneId ?? "", undefined, sceneId !== null);
  const tasks = useTasks();
  const flushGuides = useFlushGuides(sceneId ?? "");
  const rebuildGuides = useRebuildGuides(sceneId ?? "");
  const editGuide = useEditGuide(sceneId ?? "");
  const updateScene = useUpdateScene(sceneId ?? "");

  // Outside a roleplay the guides' *prompts* are still the guides: what each
  // kind asks. The generated content is per scene, but the question is not
  // (§20 phase 149).
  if (sceneId === null) return <GuidePrompts />;
  const guides: GuideDto[] = scene.data?.guides ?? [];
  const order = scene.data?.scene.guideOrder ?? null;
  const customPrompt = scene.data?.scene.customGuidePrompt ?? null;
  const working = rebuildGuides.isPending ? (rebuildGuides.variables?.kind ?? "all") : null;

  // Reorder is weighting here: guides injected earlier carry more weight. The
  // order is the scene's own, and the move writes it straight back.
  function move(kind: GuideKind, by: number) {
    const kinds = [...new Set<GuideKind>([...(order ?? GUIDE_KINDS), ...GUIDE_KINDS])];
    const index = kinds.indexOf(kind);
    const to = index + by;
    if (index < 0 || to < 0 || to >= kinds.length) return;
    const next = [...kinds];
    const [moved] = next.splice(index, 1);
    next.splice(to, 0, moved!);
    updateScene.mutate({ guideOrder: next });
  }

  return (
    <div className="mt-[12px]">
      <GuidesBody
        guides={guides}
        tasks={tasks.data ?? []}
        customPrompt={customPrompt}
        working={working}
        order={order}
        onMove={move}
        onRebuild={(kind) => rebuildGuides.mutate(kind === "all" ? {} : { kind })}
        onEdit={(guideId, content) => editGuide.mutate({ guideId, content })}
        onFlush={(kind) => flushGuides.mutate(kind)}
      />
    </div>
  );
}

/**
 * What each guide asks, editable without a roleplay (§20 phase 149).
 *
 * The generated content is per scene; the question is not. So outside a chat
 * the Guides tab still works — it is the prompts, each kind's own words, with
 * the built-in text as the starting value and an empty commit as a reset.
 */
function GuidePrompts() {
  const tasks = useTasks();
  const update = useUpdateTask();
  const rows = (tasks.data ?? []).filter((task) => task.key.startsWith("guide_"));

  return (
    <div className="mt-[12px]">
      <p className="explain mb-[10px]">{strings.leftRail.guidePromptsNote}</p>
      {rows.map((task) => (
        <div key={task.key} className="mb-[12px]">
          <p className="section-label mb-[6px]">{task.label}</p>
          <TextField
            value={task.promptTemplate ?? task.defaultTemplate}
            rows={3}
            onCommit={(promptTemplate) =>
              update.mutate({ key: task.key, promptTemplate: promptTemplate.trim() || null })
            }
          />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Scene — the slot ChatScreen fills                                    */
/* ------------------------------------------------------------------ */

/**
 * Not a component of its own — a read of the slot `ChatScreen` fills with the
 * scene's own Context/Cast/You panes while a roleplay is open. Dockable to
 * either side like the rest, even though there is nothing here to fetch.
 */
export function ScenePanel() {
  const sceneInspector = useUiStore((state) => state.sceneInspector);
  return sceneInspector ?? <p className="explain px-[16px] py-[14px]">{strings.rightRail.noScene}</p>;
}

/* ------------------------------------------------------------------ */
/* Off script — the other slot ChatScreen fills                        */
/* ------------------------------------------------------------------ */

/**
 * The off-script exchange, wherever the reader has docked it (§20 phase 177).
 *
 * The same slot arrangement `scene` uses, and for the same reason: the channel
 * needs the scene's live messages and the answer currently streaming, which
 * only `ChatScreen` has. It was a modal before this — a bottom sheet at every
 * width, then briefly a centred dialog — and neither was right for a
 * conversation you hold *while* reading. A rail panel is.
 */
export function OocPanel() {
  const oocPanel = useUiStore((state) => state.oocPanel);
  return oocPanel ?? <p className="explain px-[16px] py-[14px]">{strings.ooc.noScene}</p>;
}

/* ------------------------------------------------------------------ */
/* Characters — the library                                            */
/* ------------------------------------------------------------------ */

export function CharacterPane({ sceneId }: { sceneId: string | null }) {
  const characters = useCharacters();
  const scenes = useScenes();
  const create = useCreateCharacter();
  const importCharacter = useImportCharacter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [needle, setNeedle] = useState("");

  const sceneContext =
    sceneId === null
      ? null
      : ((scenes.data ?? []).find((scene) => scene.id === sceneId)?.contextSize ?? null);

  if (editingId !== null) {
    return (
      <CastEditPane
        characterId={editingId}
        onClose={() => setEditingId(null)}
        contextSize={sceneContext}
      />
    );
  }

  const all = characters.data ?? [];
  const rows = all.filter(
    (character) => needle === "" || character.name.toLowerCase().includes(needle.toLowerCase()),
  );
  const inScene =
    sceneId === null
      ? new Set<string>()
      : new Set(
          (scenes.data ?? [])
            .find((scene) => scene.id === sceneId)
            ?.cast.map((member) => member.characterId) ?? [],
        );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none gap-[6px] border-b border-rule p-[10px]">
        <input
          className="field min-h-0 flex-1 py-[7px] text-[13px]"
          placeholder={strings.characters.searchPlaceholder}
          value={needle}
          onChange={(event) => setNeedle(event.target.value)}
        />
        <button
          type="button"
          className="btn flex-none px-[10px]"
          disabled={create.isPending}
          onClick={() =>
            create.mutate({}, { onSuccess: (made) => setEditingId(made.id) })
          }
        >
          {strings.characters.create}
        </button>
        <input
          id={`character-import-${sceneId ?? "library"}`}
          type="file"
          hidden
          accept=".png,.json,.charx,application/json,image/png"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file === undefined) return;
            importCharacter.mutate(file, {
              onSuccess: (result) => setEditingId(result.character.id),
            });
          }}
        />
        <button
          type="button"
          className="btn flex-none px-[10px]"
          disabled={importCharacter.isPending}
          onClick={() => document.getElementById(`character-import-${sceneId ?? "library"}`)?.click()}
        >
          {importCharacter.isPending ? strings.characters.importing : strings.characters.import}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-[10px] py-[8px]">
        {rows.length === 0 ? (
          <p className="explain">{strings.characters.empty}</p>
        ) : null}
        {rows.filter((character) => inScene.has(character.id)).length > 0 ? (
          <>
            <p className="section-label mt-[6px] mb-[4px]">{strings.rightRail.inThisScene}</p>
            {rows
              .filter((character) => inScene.has(character.id))
              .map((character) => (
                <CharacterRow
                  key={character.id}
                  character={character}
                  badge={strings.rightRail.inScene}
                  onOpen={() => setEditingId(character.id)}
                />
              ))}
          </>
        ) : null}
        {rows.filter((character) => !inScene.has(character.id)).length > 0 ? (
          <>
            <p className="section-label mt-[10px] mb-[4px]">{strings.characters.title}</p>
            {rows
              .filter((character) => !inScene.has(character.id))
              .map((character) => (
                <CharacterRow
                  key={character.id}
                  character={character}
                  onOpen={() => setEditingId(character.id)}
                />
              ))}
          </>
        ) : null}
      </div>
    </div>
  );
}

function CharacterRow({
  character,
  badge,
  onOpen,
}: {
  character: { id: string; name: string; hasAvatar: boolean; tokens: { total: number } };
  badge?: string;
  onOpen(): void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="row flex w-full items-center gap-[10px] text-left"
    >
      {/* The card's own picture, small — a list of cards should look like cards
          (§20 phase 112). */}
      <span
        aria-hidden="true"
        className="h-[36px] w-[28px] flex-none border border-rule bg-cover bg-center"
        style={
          character.hasAvatar
            ? { backgroundImage: `url(/api/characters/${character.id}/avatar)` }
            : { background: "var(--onsen-stripe)" }
        }
      />
      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{character.name}</span>
      {badge === undefined ? null : (
        <span
          className="chrome flex-none text-[11px]"
          style={{ color: "var(--onsen-color-amber)" }}
        >
          {badge}
        </span>
      )}
      <span className="meta flex-none">{strings.characters.tokens(character.tokens.total)}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Authors — the writing partners                                      */
/* ------------------------------------------------------------------ */

export function AuthorPane({ sceneId }: { sceneId: string | null }) {
  const authors = useAuthors();
  const scenes = useScenes();
  const create = useCreateAuthor();
  const updateScene = useUpdateScene(sceneId ?? "");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [needle, setNeedle] = useState("");

  const sceneContext =
    sceneId === null
      ? null
      : ((scenes.data ?? []).find((scene) => scene.id === sceneId)?.contextSize ?? null);

  const author = (authors.data ?? []).find((candidate) => candidate.id === editingId) ?? null;
  if (author !== null) {
    return (
      <AuthorEdit author={author} onClose={() => setEditingId(null)} contextSize={sceneContext} />
    );
  }

  const rows = (authors.data ?? []).filter(
    (candidate) => needle === "" || candidate.name.toLowerCase().includes(needle.toLowerCase()),
  );
  const sceneAuthorId =
    sceneId === null
      ? null
      : ((scenes.data ?? []).find((scene) => scene.id === sceneId)?.authorId ?? null);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none gap-[6px] border-b border-rule p-[10px]">
        <input
          className="field min-h-0 flex-1 py-[7px] text-[13px]"
          placeholder={strings.characters.searchPlaceholder}
          value={needle}
          onChange={(event) => setNeedle(event.target.value)}
        />
        <button
          type="button"
          className="btn flex-none px-[10px]"
          disabled={create.isPending}
          onClick={() => create.mutate({}, { onSuccess: (made) => setEditingId(made.id) })}
        >
          {strings.authors.create}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-[10px] py-[8px]">
        {rows.length === 0 ? (
          <p className="explain">{strings.authors.empty}</p>
        ) : (
          rows.map((candidate) => (
            <div key={candidate.id} className="row flex items-baseline gap-[10px]">
              <button
                type="button"
                onClick={() => setEditingId(candidate.id)}
                className="min-w-0 flex-1 truncate text-left text-[13.5px] font-medium"
              >
                {candidate.name}
              </button>
              {candidate.id === sceneAuthorId ? (
                <span
                  className="chrome flex-none text-[11px]"
                  style={{ color: "var(--onsen-color-amber)" }}
                >
                  {strings.rightRail.inUse}
                </span>
              ) : null}
              <span className="meta flex-none">
                {strings.characters.tokens(candidate.tokens.total)}
              </span>
              {sceneId === null || candidate.id === sceneAuthorId ? null : (
                <button
                  type="button"
                  className="chrome flex-none text-[12px]"
                  style={{ color: "var(--onsen-color-blue-text)" }}
                  onClick={() => updateScene.mutate({ authorId: candidate.id })}
                >
                  {strings.authors.use}
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function AuthorEdit({
  author,
  onClose,
  contextSize,
}: {
  author: AuthorDto;
  onClose(): void;
  contextSize?: number | null;
}) {
  const update = useUpdateAuthor(author.id);
  return (
    <div className="px-[16px] py-[14px]">
      <button type="button" className="chrome mb-[10px] text-[12.5px] text-ink-muted" onClick={onClose}>
        {strings.chat.back}
      </button>

      <EditorField label={strings.authors.name}>
        <TextField value={author.name} onCommit={(name) => update.mutate({ name })} />
      </EditorField>
      <EditorField label={strings.authors.personality} tokens={author.tokens.personality}>
        <TextField
          value={author.personality ?? ""}
          rows={4}
          onCommit={(personality) => update.mutate({ personality: personality || null })}
        />
      </EditorField>
      <EditorField label={strings.authors.writingStyle} tokens={author.tokens.writingStyle}>
        <TextField
          value={author.writingStyle ?? ""}
          rows={3}
          onCommit={(writingStyle) => update.mutate({ writingStyle: writingStyle || null })}
        />
      </EditorField>
      <EditorField label={strings.authors.directingStyle} tokens={author.tokens.directingStyle}>
        <TextField
          value={author.directingStyle ?? ""}
          rows={3}
          onCommit={(directingStyle) => update.mutate({ directingStyle: directingStyle || null })}
        />
      </EditorField>
      <EditorField label={strings.authors.oocVoice} tokens={author.tokens.oocVoice} tone="blue">
        <TextField
          value={author.oocVoice ?? ""}
          rows={3}
          onCommit={(oocVoice) => update.mutate({ oocVoice: oocVoice || null })}
        />
      </EditorField>
      <EditorField label={strings.authors.boundaries} tokens={author.tokens.boundaries} tone="red">
        <TextField
          value={author.boundaries ?? ""}
          rows={3}
          onCommit={(boundaries) => update.mutate({ boundaries: boundaries || null })}
        />
      </EditorField>

      {/* A live sample in the exact treatment the aside appears in, so the voice
          is configured against something seen (§20 phase 97). */}
      <div className="mt-[16px]">
        <p className="section-label mb-[8px]">{strings.authors.sampleVoice}</p>
        <div className="pl-[18px]" style={{ borderLeft: "2px solid var(--onsen-color-blue)" }}>
          <p
            className="chrome mb-[6px] text-[12.5px]"
            style={{ color: "var(--onsen-color-blue)" }}
          >
            {author.name} · OOC
          </p>
          <div
            className="px-[11px] py-[9px]"
            style={{
              background: "var(--onsen-color-blue-bg)",
              border: "1px solid var(--onsen-color-blue-border)",
              borderRadius: "3px 12px 12px 12px",
            }}
          >
            <p
              className="chrome text-[12.5px] leading-[1.55]"
              style={{ color: "var(--onsen-color-blue-text)" }}
            >
              {author.oocVoice ?? strings.authors.sampleVoiceEmpty}
            </p>
          </div>
        </div>
      </div>

      {/* The author's cost as a share of the window (§20 phase 98). */}
      {contextSize !== null && contextSize !== undefined && contextSize > 0 ? (
        <p className="meta mt-[16px] border-t border-rule pt-[10px]">
          {strings.characters.cardContext(
            author.tokens.total,
            Math.round((author.tokens.total / contextSize) * 100),
          )}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The registry                                                        */
/* ------------------------------------------------------------------ */

export const PANEL_META: Record<DockPanel, PanelMeta> = {
  prompt: {
    Icon: Sigma,
    label: strings.leftRail.prompt,
    titleLabel: strings.leftRail.promptTitle,
    Component: PromptPanel,
  },
  preset: {
    Icon: SlidersHorizontal,
    label: strings.leftRail.preset,
    titleLabel: strings.leftRail.presetTitle,
    Component: PresetPanel,
  },
  lore: {
    Icon: BookMarked,
    label: strings.leftRail.lore,
    titleLabel: strings.leftRail.loreTitle,
    Component: LorePanel,
  },
  guides: {
    Icon: ListChecks,
    label: strings.leftRail.guides,
    titleLabel: strings.leftRail.guidesTitle,
    Component: GuidesPanel,
  },
  scene: {
    Icon: Users,
    label: strings.rightRail.inThisScene,
    titleLabel: strings.rightRail.inThisScene,
    Component: ScenePanel,
  },
  characters: {
    Icon: Contact,
    label: strings.rightRail.characters,
    titleLabel: strings.rightRail.characters,
    Component: CharacterPane,
  },
  authors: {
    Icon: Feather,
    label: strings.rightRail.authors,
    titleLabel: strings.rightRail.authors,
    Component: AuthorPane,
  },
  models: {
    // A plug: this panel is where the app is wired to something else.
    Icon: Plug,
    label: strings.models.title,
    titleLabel: strings.models.title,
    Component: ModelsPanel,
  },
  ooc: {
    // The same glyph the composer's own Off script op carries, so the op and
    // the panel it now opens are visibly the same thing.
    Icon: MessageSquareOff,
    label: strings.ooc.title,
    titleLabel: strings.ooc.title,
    Component: OocPanel,
    fills: true,
  },
};
