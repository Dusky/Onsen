import { useMemo, useState } from "react";
import {
  DEFAULT_BLOCK_ORDER,
  INJECTION_ROLES,
  MODERN_SAMPLER_DEFAULTS,
  SAMPLER_BOUNDS,
  customBlockId,
  samplerProblem,
  type BoundedSampler,
  type PresetDto,
  type PromptOrderEntry,
  type SamplerSettings,
} from "@shared/types.ts";
import { strings } from "../strings.ts";
import { Sheet } from "./Sheet.tsx";
import {
  useCreatePresetBlock,
  useDeletePreset,
  useDeletePresetBlock,
  useUpdatePreset,
  useUpdatePresetBlock,
} from "../lib/queries.ts";
import { useConfirm } from "./ConfirmSheet.tsx";

/**
 * The preset editor (SPEC §13, §16 "samplers with modern defaults").
 *
 * These values have shipped on §13's modern numbers since phase 1 and have
 * never been reachable, which is not far from not having them: a default nobody
 * can see is indistinguishable from a hardcoded constant, and the whole point
 * of §13 is that this app makes a different choice from the 2023 one and says
 * so. So the two groups that matter carry their reasoning next to them — DRY is
 * why repetition penalty ships off, and XTC is why the prose is not the same
 * every time.
 *
 * Every field commits on release rather than per keystroke: each one is a
 * server round-trip, and a temperature dragged past 4 on the way to 0.9 is
 * briefly a setting nobody wants.
 */

/** The order the sliders read in: what a model does, then the two modern tools. */
const GROUPS: { hint?: string; keys: BoundedSampler[] }[] = [
  { keys: ["temperature", "min_p", "top_p", "top_k", "repetition_penalty"] },
  {
    hint: strings.settings.dryHint,
    keys: ["dry_multiplier", "dry_base", "dry_allowed_length"],
  },
  { hint: strings.settings.xtcHint, keys: ["xtc_threshold", "xtc_probability"] },
];

const LABELS: Record<BoundedSampler, string> = {
  temperature: strings.settings.samplerTemperature,
  min_p: strings.settings.samplerMinP,
  top_p: strings.settings.samplerTopP,
  top_k: strings.settings.samplerTopK,
  repetition_penalty: strings.settings.samplerRepetitionPenalty,
  dry_multiplier: strings.settings.samplerDryMultiplier,
  dry_base: strings.settings.samplerDryBase,
  dry_allowed_length: strings.settings.samplerDryAllowedLength,
  xtc_threshold: strings.settings.samplerXtcThreshold,
  xtc_probability: strings.settings.samplerXtcProbability,
};

/**
 * The prompt manager (SPEC §3, §16 §Density, §20 phase 56).
 *
 * Every block the prompt is assembled from, in the order it is assembled, with
 * the ones this preset owns editable in place. `presets.prompt_order` has held
 * this since migration 0001 and nothing wrote it; the pure builder has honoured
 * `ctx.preset.blockOrder` since phase 3 and nothing set it. This is the screen
 * that joins them.
 *
 * Reorder is two buttons rather than drag: there is no drag-reorder anywhere in
 * this client to match, HTML5 drag is poor under a thumb, and a library is a
 * dependency for something an arrow does.
 *
 * Built-in blocks show no token cost, deliberately. What one costs depends on
 * the scene it is built for — the Inspector is where a real prompt's per-block
 * costs are read, and a number invented here would be worse than the blank.
 */
function PromptManager({ preset }: { preset: PresetDto }) {
  const update = useUpdatePreset();
  const createBlock = useCreatePresetBlock();
  const updateBlock = useUpdatePresetBlock();
  const removeBlock = useDeletePresetBlock();
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmNode, confirm] = useConfirm();

  const blocks = new Map(preset.blocks.map((block) => [customBlockId(block.id), block]));

  /*
   * What to show: the saved order, or the default with this preset's blocks
   * where the builder would put them. Both are rendered the same way, so the
   * list never looks different from the prompt it describes.
   */
  const order: PromptOrderEntry[] = useMemo(() => {
    if (preset.blockOrder !== null) {
      const known = new Set(preset.blockOrder.map((entry) => entry.id));
      // A block created while an order was saved is appended rather than
      // hidden: a block nothing points at is invisible, which is the defect
      // this phase exists to remove.
      const missing = preset.blocks
        .filter((block) => !known.has(customBlockId(block.id)))
        .map((block) => ({ id: customBlockId(block.id), enabled: true }));
      return [...preset.blockOrder, ...missing];
    }
    const out: PromptOrderEntry[] = [];
    for (const id of DEFAULT_BLOCK_ORDER) {
      if (id === "history") {
        for (const block of preset.blocks) out.push({ id: customBlockId(block.id), enabled: true });
      }
      out.push({ id, enabled: true });
    }
    return out;
  }, [preset.blockOrder, preset.blocks]);

  function save(next: PromptOrderEntry[]) {
    update.mutate({ id: preset.id, blockOrder: next });
  }

  function move(index: number, by: number) {
    const next = [...order];
    const to = index + by;
    if (to < 0 || to >= next.length) return;
    const [moved] = next.splice(index, 1);
    next.splice(to, 0, moved!);
    save(next);
  }

  return (
    <div className="mb-[18px]">
      <p className="section-label mb-[6px]">{strings.settings.promptOrder}</p>

      {order.map((entry, index) => {
        const own = blocks.get(entry.id);
        const name =
          own?.label ?? strings.settings.blockNames[entry.id] ?? entry.id;
        return (
          <div key={entry.id}>
            <div className="row flex items-baseline gap-[8px]">
              <button
                type="button"
                aria-label={`${name}: ${entry.enabled ? strings.settings.blockOn : strings.settings.blockOff}`}
                aria-pressed={entry.enabled}
                onClick={() =>
                  save(order.map((e, i) => (i === index ? { ...e, enabled: !e.enabled } : e)))
                }
                className="flex h-[22px] w-[16px] flex-none items-center"
              >
                {/* A dot, not the word: the app's on/off pair was drawn for one
                    toggle in a form, and twenty-five of them down a list is a
                    column of shouting. The row already dims when it is off, so
                    the word was saying it twice. Red is still live (§16). */}
                <span
                  className="block h-[7px] w-[7px] rounded-full"
                  style={{
                    background: entry.enabled ? "var(--onsen-color-red)" : "transparent",
                    border: entry.enabled ? "0" : "1px solid var(--onsen-color-rule-strong)",
                  }}
                />
              </button>

              <button
                type="button"
                disabled={own === undefined}
                onClick={() => setOpenId(openId === entry.id ? null : entry.id)}
                className="min-w-0 flex-1 truncate text-left text-[14px] disabled:cursor-default"
                style={{ opacity: entry.enabled ? 1 : 0.5 }}
              >
                {name}
              </button>

              {own === undefined ? null : (
                <span className="meta flex-none tabular-nums">
                  {strings.settings.blockTokens(own.tokenCount)}
                </span>
              )}
              <button
                type="button"
                aria-label={`${strings.settings.blockUp} ${name}`}
                onClick={() => move(index, -1)}
                className="chrome h-[26px] w-[22px] flex-none text-ink-dim hover:text-ink-label"
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`${strings.settings.blockDown} ${name}`}
                onClick={() => move(index, 1)}
                className="chrome h-[26px] w-[22px] flex-none text-ink-dim hover:text-ink-label"
              >
                ↓
              </button>
            </div>

            {own === undefined || openId !== entry.id ? null : (
              <div className="mb-[10px] border-l-2 border-rule-strong pt-[8px] pb-[4px] pl-[12px]">
                <p className="section-label mb-[6px]">{strings.settings.blockLabel}</p>
                <input
                  className="field mb-[10px]"
                  aria-label={strings.settings.blockLabel}
                  defaultValue={own.label}
                  onBlur={(event) => {
                    const label = event.target.value.trim();
                    if (label !== "" && label !== own.label) {
                      updateBlock.mutate({ presetId: preset.id, blockId: own.id, label });
                    }
                  }}
                />

                <p className="section-label mb-[6px]">{strings.settings.blockRole}</p>
                <div className="mb-[10px] flex gap-[6px]">
                  {INJECTION_ROLES.map((role) => (
                    <button
                      key={role}
                      type="button"
                      className={`btn flex-1 ${own.role === role ? "btn-primary" : ""}`}
                      onClick={() =>
                        updateBlock.mutate({ presetId: preset.id, blockId: own.id, role })
                      }
                    >
                      {strings.lore[
                        role === "system" ? "roleSystem" : role === "user" ? "roleUser" : "roleAssistant"
                      ]}
                    </button>
                  ))}
                </div>

                <p className="section-label mb-[6px]">{strings.settings.blockContent}</p>
                <textarea
                  className="field mb-[10px] min-h-[120px] resize-y"
                  aria-label={strings.settings.blockContent}
                  defaultValue={own.content}
                  placeholder={strings.settings.blockContentPlaceholder}
                  onBlur={(event) => {
                    if (event.target.value !== own.content) {
                      updateBlock.mutate({
                        presetId: preset.id,
                        blockId: own.id,
                        content: event.target.value,
                      });
                    }
                  }}
                />

                <button
                  type="button"
                  className="chrome text-[10.5px]"
                  style={{ color: "var(--onsen-color-red)" }}
                  onClick={() =>
                    confirm(
                      strings.settings.blockDeleteConfirm,
                      () => {
                        setOpenId(null);
                        removeBlock.mutate({ presetId: preset.id, blockId: own.id });
                      },
                      { confirmLabel: strings.common.delete },
                    )
                  }
                >
                  {strings.common.delete}
                </button>
              </div>
            )}
          </div>
        );
      })}

      <button
        type="button"
        className="btn mt-[12px] w-full"
        disabled={createBlock.isPending}
        onClick={() =>
          createBlock.mutate(preset.id, {
            onSuccess: (next) => {
              const made = next.blocks[next.blocks.length - 1];
              if (made !== undefined) setOpenId(customBlockId(made.id));
            },
          })
        }
      >
        {strings.settings.blockAdd}
      </button>

      {preset.blockOrder === null ? null : (
        <button
          type="button"
          className="btn mt-[8px] w-full"
          onClick={() => update.mutate({ id: preset.id, blockOrder: null })}
        >
          {strings.settings.promptOrderReset}
        </button>
      )}
      {confirmNode}
    </div>
  );
}

export function PresetEditor({ preset, onClose }: { preset: PresetDto; onClose(): void }) {
  const update = useUpdatePreset();
  const remove = useDeletePreset();
  const [confirmNode, confirm] = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const samplers = preset.samplerSettings;

  function setSampler(key: BoundedSampler, value: number | undefined) {
    const next: SamplerSettings = { ...samplers };
    if (value === undefined) delete next[key];
    else next[key] = value;
    // Checked with the same function the route uses, so the form can never
    // send something the server will refuse.
    const problem = samplerProblem(next);
    setError(problem);
    if (problem === null) update.mutate({ id: preset.id, samplerSettings: next });
  }

  return (
    <Sheet title={preset.name} onClose={onClose}>
      <div className="pt-[8px] pb-[14px]">

        <p className="section-label mb-[10px]">{strings.settings.samplers}</p>
        {GROUPS.map((group, at) => (
          <div key={at} className="mb-[14px]">
            {group.keys.map((key) => (
              <Slider
                key={key}
                label={LABELS[key]}
                bound={SAMPLER_BOUNDS[key]}
                value={samplers[key]}
                fallback={MODERN_SAMPLER_DEFAULTS[key]}
                onCommit={(value) => setSampler(key, value)}
              />
            ))}
            {group.hint === undefined ? null : (
              <p className="explain mt-[8px]">{group.hint}</p>
            )}
          </div>
        ))}
        {error === null ? null : (
          <p role="alert" className="chrome mb-[10px] text-[11px] text-red-text">
            {error}
          </p>
        )}
        <button
          type="button"
          className="btn mb-[22px] w-full"
          onClick={() => {
            setError(null);
            update.mutate({ id: preset.id, samplerSettings: { ...MODERN_SAMPLER_DEFAULTS } });
          }}
        >
          {strings.settings.samplersReset}
        </button>

        <p className="section-label mb-[8px]">{strings.settings.contextSize}</p>
        <div className="mb-[8px] flex gap-[10px]">
          <Whole
            label={strings.settings.contextSize}
            unit={strings.settings.contextSizeUnit}
            value={preset.contextSize}
            min={512}
            max={2_000_000}
            onCommit={(value) => update.mutate({ id: preset.id, contextSize: value })}
          />
          <Whole
            label={strings.settings.maxResponseTokens}
            unit={strings.settings.maxResponseTokensUnit}
            value={preset.maxResponseTokens}
            min={16}
            max={32_768}
            onCommit={(value) => update.mutate({ id: preset.id, maxResponseTokens: value })}
          />
        </div>

        <p className="section-label mb-[8px]">{strings.settings.prefill}</p>
        <textarea
          rows={2}
          className="field mb-[8px] resize-none py-[10px]"
          placeholder={strings.settings.prefillPlaceholder}
          defaultValue={preset.prefill ?? ""}
          onBlur={(event) => {
            const value = event.target.value.trim();
            if (value === (preset.prefill ?? "")) return;
            update.mutate({ id: preset.id, prefill: value === "" ? null : value });
          }}
        />
        <p className="explain mb-[22px]">
          {strings.settings.prefillHint}
        </p>

        <p className="section-label mb-[8px]">{strings.settings.reasoningTitle}</p>
        <button
          type="button"
          className={`btn mb-[8px] w-full ${preset.reasoning.parseInline ? "btn-primary" : ""}`}
          onClick={() =>
            update.mutate({
              id: preset.id,
              reasoning: { parseInline: !preset.reasoning.parseInline },
            })
          }
        >
          {strings.settings.reasoningParseInline}
        </button>
        <p className="explain mb-[16px]">
          {strings.settings.reasoningParseInlineHint}
        </p>

        <div className="mb-[8px]">
          <Whole
            label={strings.settings.reasoningReinject}
            unit={strings.settings.reasoningReinjectUnit}
            value={preset.reasoning.reinjectLast}
            min={0}
            max={20}
            onCommit={(value) =>
              update.mutate({ id: preset.id, reasoning: { reinjectLast: value } })
            }
          />
        </div>
        <p className="explain mb-[16px]">
          {strings.settings.reasoningReinjectHint}
        </p>

        {/* The wrapper only means anything once something is being wrapped. */}
        {preset.reasoning.reinjectLast > 0 ? (
          <>
            <p className="section-label mb-[6px]">{strings.settings.reasoningPrefix}</p>
            <input
              className="field mb-[10px]"
              defaultValue={preset.reasoning.prefix}
              onBlur={(event) => {
                if (event.target.value === preset.reasoning.prefix) return;
                update.mutate({ id: preset.id, reasoning: { prefix: event.target.value } });
              }}
            />
            <p className="section-label mb-[6px]">{strings.settings.reasoningSuffix}</p>
            <input
              className="field mb-[10px]"
              defaultValue={preset.reasoning.suffix}
              onBlur={(event) => {
                if (event.target.value === preset.reasoning.suffix) return;
                update.mutate({ id: preset.id, reasoning: { suffix: event.target.value } });
              }}
            />
          </>
        ) : null}

        {/* §18 requires both, and the endpoint has served both since phase 28
            with nothing calling it. A download rather than a copy: a preset is
            a file people move between installs. */}
        <PromptManager preset={preset} />

        <p className="section-label mt-[22px] mb-[8px]">{strings.settings.exportPresetLabel}</p>
        <button
          type="button"
          className="btn mb-[8px] w-full"
          onClick={() => void download(preset, "onsen")}
        >
          {strings.settings.exportPresetOwn}
        </button>
        <button
          type="button"
          className="btn w-full"
          onClick={() => void download(preset, "sillytavern")}
        >
          {strings.settings.exportPresetSt}
        </button>

        {/* §20 phase 54. `is_default` decides which preset runs when a scene
            and its profile both name none, and it was written once at setup:
            an imported preset could be edited and exported and never used. */}
        {preset.isDefault ? null : (
          <button
            type="button"
            className="btn mt-[22px] w-full"
            onClick={() => update.mutate({ id: preset.id, isDefault: true })}
          >
            {strings.settings.presetMakeDefault}
          </button>
        )}

        <button
          type="button"
          className="btn mt-[8px] w-full"
          disabled={preset.isDefault}
          onClick={() =>
            confirm(
              strings.settings.presetDeleteConfirm,
              () => remove.mutate(preset.id, { onSuccess: onClose }),
              { confirmLabel: strings.common.delete },
            )
          }
        >
          {preset.isDefault
            ? strings.settings.presetDefaultUndeletable
            : strings.common.delete}
        </button>
      </div>
      {confirmNode}
    </Sheet>
  );
}

/**
 * Fetch a preset and hand it to the browser as a file.
 *
 * Through fetch rather than a plain link because the endpoint is behind the
 * session cookie and returns JSON: a link would open it in a tab.
 */
async function download(preset: PresetDto, format: "onsen" | "sillytavern"): Promise<void> {
  const response = await fetch(`/api/connections/presets/${preset.id}/export?format=${format}`);
  if (!response.ok) return;
  const text = JSON.stringify(await response.json(), null, 2);
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  const suffix = format === "sillytavern" ? "-sillytavern" : "";
  link.download = `${preset.name.replace(/[^\w -]+/g, "").trim() || "preset"}${suffix}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * One sampler. A slider because these are felt rather than calculated, with the
 * number beside it because "0.85" is what gets pasted into a forum post.
 */
function Slider({
  label,
  bound,
  value,
  fallback,
  onCommit,
}: {
  label: string;
  bound: { min: number; max: number; step: number };
  value: number | undefined;
  fallback: number | undefined;
  onCommit(value: number | undefined): void;
}) {
  const current = value ?? fallback;
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? current;

  return (
    <div className="mb-[11px]">
      <div className="mb-[5px] flex items-baseline justify-between gap-[10px]">
        <span className="chrome text-[11px] text-ink-muted">
          {label}
        </span>
        <span className="chrome text-[11px] text-ink-label">
          {shown === undefined ? strings.settings.samplerOff : shown}
        </span>
      </div>
      <input
        type="range"
        min={bound.min}
        max={bound.max}
        step={bound.step}
        value={shown ?? bound.min}
        // Dragged live for the feel of it, committed on release: every commit
        // is a request, and a slider that fired one per pixel would be a
        // hundred writes for one decision.
        onChange={(event) => setDraft(Number(event.target.value))}
        // The draft is kept after committing rather than cleared. Clearing it
        // makes the next arrow-key press step from the server's value, which
        // has not come back yet — so a held arrow key moves one step and then
        // stalls. The sheet unmounts on close, which is when it resets.
        onPointerUp={() => {
          if (draft !== null && draft !== current) onCommit(draft);
        }}
        onKeyUp={() => {
          if (draft !== null && draft !== current) onCommit(draft);
        }}
        className="slider"
        aria-label={label}
      />
    </div>
  );
}

/** A bounded whole number, committed on blur. */
function Whole({
  label,
  unit,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  onCommit(value: number): void;
}) {
  return (
    <label className="min-w-0 flex-1">
      <span className="section-label mb-[6px] block">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        key={value}
        defaultValue={value}
        className="field"
        onBlur={(event) => {
          const next = Number.parseInt(event.target.value, 10);
          if (!Number.isInteger(next) || next < min || next > max) {
            event.target.value = String(value);
            return;
          }
          if (next !== value) onCommit(next);
        }}
      />
      <span className="chrome mt-[5px] block text-[10.5px] text-ink-dim">
        {unit}
      </span>
    </label>
  );
}
