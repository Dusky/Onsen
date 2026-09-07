import { useEffect, useState } from "react";
import type {
  BoundedSampler,
  GuideDto,
  LoreActivationDto,
  PromptBlock,
  PromptDebugInfo,
  SamplerSettings,
} from "@shared/types.ts";
import { MODERN_SAMPLER_DEFAULTS, SAMPLER_BOUNDS, samplerProblem } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { navigate, useRoute } from "../lib/router.ts";
import {
  useLoreActivation,
  usePresets,
  usePreviewPrompt,
  useScene,
  useUpdatePreset,
} from "../lib/queries.ts";
import { useUiStore } from "../state/ui.ts";
import { LABELS, Slider } from "./PresetEditor.tsx";

/**
 * The left icon rail and its section panel (the redesign, phase 89).
 *
 * The mockup's left side is not the config sidebar the workbench built. It is a
 * 46px rail of five icons — Prompt, Preset, Lore, Guides, Settings — and, when
 * one is chosen, a panel beside it carrying that section. Prompt shows the
 * window being assembled (the budget bar, the blocks, the evictions), Preset
 * the samplers, Lore what fired, Guides what is injected. Three of the four are
 * scene-scoped, so the rail reads the route to find the scene; outside a
 * roleplay they explain themselves and wait.
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

export function LeftRail() {
  const route = useRoute();
  const { leftRailOpen, leftSection, setLeftSection, toggleLeftRail } = useUiStore();
  const sceneId = route.name === "chat" ? route.sceneId : null;

  if (!leftRailOpen) {
    return (
      <nav className="flex w-[34px] flex-none flex-col items-center border-r border-rule bg-bg-sunken py-[10px]">
        <button
          type="button"
          aria-label={strings.settings.railOpen}
          onClick={toggleLeftRail}
          className="chrome flex h-[34px] w-[30px] items-center justify-center text-[13px] text-ink-muted"
        >
          {"\u203a"}
        </button>
      </nav>
    );
  }

  return (
    <nav className="flex flex-none border-r border-rule bg-bg-sunken">
      {/* The icon rail: five glyphs, a label under each, the active one picked
          out in the interactive blue rather than the warm red the workbench
          used — the mockup's live state is amber, its interactive is blue. */}
      <div className="flex w-[46px] flex-none flex-col items-stretch border-r border-rule py-[8px]">
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
                className="chrome text-[14px] leading-none"
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
        <button
          type="button"
          aria-label={strings.leftRail.settings}
          onClick={() => navigate({ name: "settings" })}
          className="flex min-h-[44px] flex-col items-center justify-center gap-[2px] px-[4px]"
        >
          <span className="chrome text-[14px] leading-none text-ink-dim">{"\u22ef"}</span>
          <span className="chrome text-[11px] leading-none text-ink-dim">
            {strings.leftRail.settings}
          </span>
        </button>
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
            <PresetPanel />
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

function NoScene() {
  return <p className="explain mt-[14px]">{strings.leftRail.noScene}</p>;
}

/* ------------------------------------------------------------------ */
/* Prompt — the window being assembled                                 */
/* ------------------------------------------------------------------ */

function PromptPanel({ sceneId }: { sceneId: string | null }) {
  const preview = usePreviewPrompt(sceneId ?? "");
  const [debug, setDebug] = useState<PromptDebugInfo | null>(null);

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

  if (sceneId === null) return <NoScene />;
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

  return (
    <div>
      <div className="mt-[12px] flex items-baseline justify-between gap-[10px]">
        <span className="meta">
          {strings.chat.inspectorTotal(debug.totalTokens, debug.available)}
        </span>
        <button
          type="button"
          className="chrome text-[12.5px]"
          style={{ color: "var(--onsen-color-blue-text)" }}
          onClick={() => preview.mutate({}, { onSuccess: (dto) => setDebug(dto.debug) })}
        >
          {strings.leftRail.refresh}
        </button>
      </div>

      {/* The budget bar: one segment per block, the free headroom as the empty
          tail — the whole argument in a single stripe. */}
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
    </div>
  );
}

function BudgetBar({ debug }: { debug: PromptDebugInfo }) {
  const free = Math.max(debug.headroom, 0);
  const total = Math.max(debug.totalTokens + free, 1);
  return (
    <div className="mt-[10px]">
      <div className="flex h-[8px] w-full overflow-hidden" aria-hidden="true">
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
        <div style={{ width: `${(free / total) * 100}%`, background: "var(--onsen-color-rule-strong)" }} />
      </div>
      <div className="mt-[8px] flex flex-wrap gap-x-[12px] gap-y-[2px]">
        {debug.blocks.map((block, index) => (
          <span key={`${block.id}-${index}`} className="meta">
            <span
              className="mr-[5px] inline-block h-[7px] w-[7px] align-middle"
              style={{ background: blockColor(block) }}
            />
            {strings.chat.inspectorTokens(block.tokens)}
          </span>
        ))}
        <span className="meta">
          <span
            className="mr-[5px] inline-block h-[7px] w-[7px] align-middle"
            style={{ background: "var(--onsen-color-rule-strong)" }}
          />
          {strings.leftRail.free(free)}
        </span>
      </div>
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
const PANEL_SAMPLERS: BoundedSampler[] = ["temperature", "min_p", "repetition_penalty"];

function PresetPanel() {
  const presets = usePresets();
  const update = useUpdatePreset();
  const rows = presets.data ?? [];
  const [presetId, setPresetId] = useState<string | null>(null);
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
      <label className="chrome mb-[6px] block text-[12.5px] text-ink-muted">
        {strings.leftRail.presetTitle}
      </label>
      <select
        className="field mb-[16px]"
        value={preset.id}
        onChange={(event) => setPresetId(event.target.value)}
      >
        {rows.map((row) => (
          <option key={row.id} value={row.id}>
            {row.name}
          </option>
        ))}
      </select>

      <p className="section-label mb-[10px]">{strings.settings.samplers}</p>
      {PANEL_SAMPLERS.map((key) => (
        <Slider
          key={key}
          label={LABELS[key]}
          bound={SAMPLER_BOUNDS[key]}
          value={preset.samplerSettings[key]}
          fallback={MODERN_SAMPLER_DEFAULTS[key]}
          onCommit={(value) => setSampler(key, value)}
        />
      ))}

      <button
        type="button"
        className="btn mt-[6px] w-full"
        onClick={() => navigate({ name: "settings" })}
      >
        {strings.leftRail.fullEditor}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lore — what fired                                                   */
/* ------------------------------------------------------------------ */

function LorePanel({ sceneId }: { sceneId: string | null }) {
  const lore = useLoreActivation(sceneId ?? "", sceneId !== null);

  if (sceneId === null) return <NoScene />;
  const rows = lore.data ?? [];

  return (
    <div className="mt-[12px]">
      <p className="meta mb-[8px]">{strings.leftRail.loreTitle}</p>
      {rows.length === 0 ? (
        <p className="explain">{strings.leftRail.loreEmpty}</p>
      ) : (
        rows.map((entry) => (
          <LoreRow key={entry.entryId} entry={entry} />
        ))
      )}
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

  if (sceneId === null) return <NoScene />;
  const guides: GuideDto[] = scene.data?.guides ?? [];

  return (
    <div className="mt-[12px]">
      <p className="meta mb-[8px]">{strings.chat.guides}</p>
      {guides.length === 0 ? (
        <p className="explain">{strings.leftRail.guidesEmpty}</p>
      ) : (
        guides.map((guide) => (
          <div key={guide.id} className="flex items-baseline gap-[9px] border-b border-rule py-[8px]">
            <span className="min-w-0 flex-1 truncate text-[13px]">
              {guide.isPinned ? `${guide.label} · ${strings.chat.guidesPinned}` : guide.label}
            </span>
            <span className="chrome flex-none text-[12.5px] text-ink-muted">
              {strings.chat.inspectorTokens(guide.tokenCount)}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
