import { useEffect, useState } from "react";
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
import { navigate, useRoute } from "../lib/router.ts";
import {
  useAddBan,
  useAnalyseBans,
  useBans,
  useEditGuide,
  useFlushGuides,
  useLoreActivation,
  usePresets,
  usePreviewPrompt,
  useRebuildGuides,
  useScene,
  useTasks,
  useUpdateBan,
  useUpdatePreset,
  useUpdateScene,
} from "../lib/queries.ts";
import { useUiStore } from "../state/ui.ts";
import { LABELS, Slider, PromptManager } from "./PresetEditor.tsx";
import { GuidesBody } from "./GuidesPanel.tsx";
import { LorePane } from "./LorePane.tsx";

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
        <button
          type="button"
          aria-label={strings.leftRail.settings}
          onClick={() => navigate({ name: "settings" })}
          className="flex min-h-[44px] flex-col items-center justify-center gap-[2px] px-[4px]"
        >
          <span className="chrome text-[20px] leading-none text-ink-dim">{"\u22ef"}</span>
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

function NoScene() {
  return <p className="explain mt-[14px]">{strings.leftRail.noScene}</p>;
}

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

  return (
    <div>
      <div className="mt-[12px] flex items-baseline justify-between gap-[10px]">
        <span className="meta">
          {strings.chat.inspectorTotal(debug.totalTokens, debug.available)}
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
  const pct = Math.round((free / total) * 100);
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
            {block.label}
          </span>
        ))}
        <span className="meta">
          <span
            className="mr-[5px] inline-block h-[7px] w-[7px] align-middle"
            style={{ background: "var(--onsen-color-rule-strong)" }}
          />
          {strings.leftRail.free(free)} · {pct}%
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
const PANEL_SAMPLERS: BoundedSampler[] = ["temperature", "min_p", "repetition_penalty"];

function PresetPanel({ sceneId }: { sceneId: string | null }) {
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

  if (sceneId === null) return <NoScene />;
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
