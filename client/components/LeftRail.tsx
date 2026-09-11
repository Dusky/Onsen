import { useEffect, useRef, useState } from "react";
import type {
  BoundedSampler,
  GuideDto,
  GuideKind,
  LoreActivationDto,
  PromptBlock,
  PromptDebugInfo,
  SamplerSettings,
} from "@shared/types.ts";
import { MODERN_SAMPLER_DEFAULTS, SAMPLER_BOUNDS, GUIDE_KINDS, samplerProblem } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { useRoute } from "../lib/router.ts";
import {
  useAddBan,
  useAnalyseBans,
  useBans,
  useConnectionProfiles,
  useCreatePreset,
  useDeletePreset,
  useEditGuide,
  useFlushGuides,
  useImportPreset,
  useLoreActivation,
  usePresets,
  usePreviewPrompt,
  useRebuildGuides,
  useScene,
  useTasks,
  useUpdateBan,
  useUpdatePreset,
  useUpdateScene,
  useUpdateTask,
} from "../lib/queries.ts";
import { useUiStore } from "../state/ui.ts";
import { GROUPS, LABELS, Slider, PromptManager, download } from "./PresetEditor.tsx";
import { GuidesBody } from "./GuidesPanel.tsx";
import { TextField } from "./TextField.tsx";
import { LorePane } from "./LorePane.tsx";
import { useConfirm } from "./ConfirmSheet.tsx";

/**
 * The left icon rail and its section panel (the redesign, phase 89).
 *
 * The mockup's left side is not the config sidebar the workbench built. It is a
 * 54px rail of four icons — Prompt, Preset, Lore, Guides — and, when one is
 * chosen, a panel beside it carrying that section. Prompt shows the window
 * being assembled (the budget bar, the blocks, the evictions), Preset the
 * samplers, Lore what fired, Guides what is injected. Three of the four are
 * scene-scoped, so the rail reads the route to find the scene; outside a
 * roleplay they explain themselves and wait.
 *
 * Settings is not a fifth icon here — it is a destination, not a section, and
 * lives in the header instead (design review fix 4). The collapsed and open
 * branches share one icon-strip width, 54px, so opening the panel does not
 * also slide the glyphs sideways (design review fix 3).
 *
 * Desktop only. On a phone these bodies stay where they were — the prompt
 * inspector is still a sheet, the preset editor a screen.
 */

type LeftSection = "prompt" | "preset" | "lore" | "guides";

const ICONS: { id: LeftSection; glyph: string; label: string }[] = [
  { id: "prompt", glyph: "\u03a3", label: strings.leftRail.prompt },
  { id: "preset", glyph: "\u2307", label: strings.leftRail.preset },
  { id: "lore", glyph: "\u25c7", label: strings.leftRail.lore },
  { id: "guides", glyph: "\u2261", label: strings.leftRail.guides },
];

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

export function LeftRail() {
  const route = useRoute();
  const { leftRailOpen, leftSection, setLeftSection, toggleLeftRail } = useUiStore();
  const sceneId = route.name === "chat" ? route.sceneId : null;

  if (!leftRailOpen) {
    // Collapsed is a glyph rail, not a dead sliver: each section is one tap
    // away, and tapping expands onto it (§149). Same 54px width as the open
    // branch's icon column, with the same labels under the glyphs — this used
    // to be a 44px sliver, which slid every glyph 10px sideways the instant
    // the panel opened (design review fix 3).
    return (
      <nav className="flex w-[54px] flex-none flex-col items-stretch border-r border-rule bg-bg-sunken py-[8px]">
        {ICONS.map((icon) => {
          const active = leftSection === icon.id;
          return (
            <button
              key={icon.id}
              type="button"
              title={icon.label}
              aria-label={icon.label}
              aria-current={active ? "true" : undefined}
              onClick={() => {
                setLeftSection(icon.id);
                toggleLeftRail();
              }}
              className="flex min-h-[40px] flex-col items-center justify-center gap-[2px] px-[4px]"
              style={{
                background: active ? "var(--onsen-color-bg-inset)" : "transparent",
                boxShadow: active ? "inset 2px 0 0 var(--onsen-color-blue)" : "none",
              }}
            >
              <span
                className="chrome text-[18px] leading-none"
                style={{ color: active ? "var(--onsen-color-blue-text)" : "var(--onsen-color-text-dim)" }}
              >
                {icon.glyph}
              </span>
              <span
                className="chrome text-[11px] leading-none"
                style={{ color: active ? "var(--onsen-color-text)" : "var(--onsen-color-text-dim)" }}
              >
                {icon.label}
              </span>
            </button>
          );
        })}
        <div className="flex-1" />
      </nav>
    );
  }

  return (
    <nav className="flex flex-none border-r border-rule bg-bg-sunken">
      {/* The icon rail: four glyphs, a label under each, the active one picked
          out in the interactive blue rather than the warm red the workbench
          used — the mockup's live state is amber, its interactive is blue.
          Settings used to sit at the foot of this column; it moved to the
          header (design review fix 4) — it is a destination, not a section,
          and could never show an active state here. */}
      <div className="flex w-[54px] flex-none flex-col items-stretch border-r border-rule py-[8px]">
        {ICONS.map((icon) => {
          const active = leftSection === icon.id;
          return (
            <button
              key={icon.id}
              type="button"
              aria-current={active ? "true" : undefined}
              onClick={() => setLeftSection(icon.id)}
              className="flex min-h-[44px] flex-col items-center justify-center gap-[2px] px-[4px]"
              style={{
                background: active ? "var(--onsen-color-bg-inset)" : "transparent",
                boxShadow: active ? "inset 2px 0 0 var(--onsen-color-blue)" : "none",
              }}
            >
              <span
                className="chrome text-[20px] leading-none"
                style={{ color: active ? "var(--onsen-color-blue-text)" : "var(--onsen-color-text-dim)" }}
              >
                {icon.glyph}
              </span>
              <span
                className="chrome text-[11px] leading-none"
                style={{ color: active ? "var(--onsen-color-text)" : "var(--onsen-color-text-dim)" }}
              >
                {icon.label}
              </span>
            </button>
          );
        })}
        <div className="flex-1" />
      </div>

      {/* The section panel. */}
      <div className="flex w-[326px] flex-none flex-col">
        <div className="hairline flex flex-none items-center justify-between px-[14px] py-[9px]">
          <p className="section-label">{TITLES[leftSection]}</p>
          <button
            type="button"
            aria-label={strings.settings.railClose}
            onClick={toggleLeftRail}
            className="chrome flex h-[28px] w-[28px] items-center justify-center text-[13px] text-ink-muted"
          >
            {"\u2039"}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-[14px] pb-[16px]">
          {leftSection === "prompt" ? (
            <PromptPanel sceneId={sceneId} />
          ) : leftSection === "preset" ? (
            <PresetPanel sceneId={sceneId} />
          ) : leftSection === "lore" ? (
            <LorePanel sceneId={sceneId} />
          ) : (
            <GuidesPanel sceneId={sceneId} />
          )}
        </div>
      </div>
    </nav>
  );
}

const TITLES: Record<LeftSection, string> = {
  prompt: strings.leftRail.promptTitle,
  preset: strings.leftRail.presetTitle,
  lore: strings.leftRail.loreTitle,
  guides: strings.leftRail.guidesTitle,
};

/* ------------------------------------------------------------------ */
/* Prompt — the window being assembled                                 */
/* ------------------------------------------------------------------ */

function PromptPanel({ sceneId }: { sceneId: string | null }) {
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
function PresetPanel({ sceneId }: { sceneId: string | null }) {
  const presets = usePresets();
  const profiles = useConnectionProfiles();
  const update = useUpdatePreset();
  const create = useCreatePreset();
  const remove = useDeletePreset();
  const importPreset = useImportPreset();
  const fileInput = useRef<HTMLInputElement>(null);
  const [confirmNode, confirm] = useConfirm();
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

  function setSampler(key: BoundedSampler, value: number | undefined) {
    const next: SamplerSettings = { ...preset!.samplerSettings };
    if (value === undefined) delete next[key];
    else next[key] = value;
    if (samplerProblem(next) === null) update.mutate({ id: preset!.id, samplerSettings: next });
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
      <div className="mt-[6px] flex gap-[6px]">
        <button
          type="button"
          className="btn flex-1 px-[8px]"
          onClick={() => void download(preset, "onsen")}
        >
          {strings.settings.exportPresetOwn}
        </button>
        <button
          type="button"
          className="btn flex-1 px-[8px]"
          onClick={() => void download(preset, "sillytavern")}
        >
          {strings.settings.exportPresetSt}
        </button>
      </div>
      {preset.isDefault ? null : (
        <div className="mt-[6px] flex gap-[6px]">
          <button
            type="button"
            className="btn flex-1 px-[8px]"
            onClick={() => update.mutate({ id: preset.id, isDefault: true })}
          >
            {strings.settings.presetMakeDefault}
          </button>
          <button
            type="button"
            className="btn flex-1 px-[8px]"
            style={{ color: "var(--onsen-color-red)", borderColor: "var(--onsen-color-red-border)" }}
            onClick={() =>
              confirm(strings.settings.presetDeleteConfirm, () => {
                setPresetId(null);
                remove.mutate(preset.id);
              })
            }
          >
            {strings.common.delete}
          </button>
        </div>
      )}
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

      {/* Every sampler, grouped with its hint — the rail is the editor, not a
          teaser that hides the rest behind a button. */}
      <p className="section-label mb-[10px]">{strings.settings.samplers}</p>
      {GROUPS.map((group, at) => (
        <div key={at} className="mb-[14px]">
          {group.keys.map((key) => (
            <Slider
              key={key}
              label={LABELS[key]}
              bound={SAMPLER_BOUNDS[key]}
              value={preset.samplerSettings[key]}
              fallback={MODERN_SAMPLER_DEFAULTS[key]}
              onCommit={(value) => setSampler(key, value)}
            />
          ))}
          {group.hint === undefined ? null : <p className="explain mt-[8px]">{group.hint}</p>}
        </div>
      ))}

      {/* The ban list is per scene, so it sits here only while a roleplay is
          open (§13.6). */}
      {sceneId === null ? null : <BanList sceneId={sceneId} />}
      {confirmNode}
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
            {"\u00d7"}
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

function LorePanel({ sceneId }: { sceneId: string | null }) {
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

function GuidesPanel({ sceneId }: { sceneId: string | null }) {
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
