import { useState } from "react";
import {
  MODERN_SAMPLER_DEFAULTS,
  SAMPLER_BOUNDS,
  samplerProblem,
  type BoundedSampler,
  type PresetDto,
  type SamplerSettings,
} from "@shared/types.ts";
import { strings } from "../strings.ts";
import { Sheet } from "./Sheet.tsx";
import { useUpdatePreset } from "../lib/queries.ts";

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

export function PresetEditor({ preset, onClose }: { preset: PresetDto; onClose(): void }) {
  const update = useUpdatePreset();
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
        <p className="chrome mb-[16px] text-[9.5px] leading-[1.5] text-ink-dim">
          {strings.settings.generationHint}
        </p>

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
              <p className="chrome mt-[8px] text-[9px] leading-[1.5] text-ink-dim">{group.hint}</p>
            )}
          </div>
        ))}
        {error === null ? null : (
          <p role="alert" className="chrome mb-[10px] text-[9.5px] text-red-text">
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
        <p className="chrome mb-[22px] text-[9px] leading-[1.5] text-ink-dim">
          {strings.settings.budgetHint}
        </p>

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
        <p className="chrome mb-[22px] text-[9px] leading-[1.5] text-ink-dim">
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
        <p className="chrome mb-[16px] text-[9px] leading-[1.5] text-ink-dim">
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
        <p className="chrome mb-[16px] text-[9px] leading-[1.5] text-ink-dim">
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
        <p className="chrome mt-[7px] text-[9px] leading-[1.5] text-ink-dim">
          {strings.settings.exportPresetHint}
        </p>
      </div>
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
        <span className="chrome text-[9.5px] tracking-[0.08em] text-ink-muted uppercase">
          {label}
        </span>
        <span className="chrome text-[9.5px] tracking-[0.06em] text-ink-label">
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
      <span className="chrome mt-[5px] block text-[9px] tracking-[0.10em] text-ink-dim uppercase">
        {unit}
      </span>
    </label>
  );
}
