import { useState } from "react";
import { strings } from "../strings.ts";
import {
  useBackgrounds,
  useDeleteBackground,
  useGenerateBackground,
  useSetDefaultBackground,
  useUpdateBackgroundOpacity,
} from "../lib/queries.ts";

/**
 * The backdrop behind everything (SPEC §12, §20 phase 108).
 *
 * A library of generated pictures, one of which is the default — shown
 * everywhere a scene has no background of its own. The opacity is the reader's;
 * the chrome goes translucent while a picture shows.
 */
export function BackgroundsSection() {
  const backgrounds = useBackgrounds();
  const generate = useGenerateBackground();
  const setDefault = useSetDefaultBackground();
  const setOpacity = useUpdateBackgroundOpacity();
  const remove = useDeleteBackground();
  const [prompt, setPrompt] = useState("");

  const list = backgrounds.data?.backgrounds ?? [];
  const defaultId = backgrounds.data?.defaultId ?? null;
  const opacity = backgrounds.data?.opacity ?? 0.55;

  const previewUrl =
    defaultId !== null ? `/api/backgrounds/${defaultId}/image` : "/default-background.jpg";

  return (
    <>
      <p className="group-heading mb-[12px]">{strings.settings.backgrounds}</p>
      <p className="explain mb-[14px]">{strings.settings.backgroundsHint}</p>

      <div className="mb-[16px] flex h-[180px] items-center justify-center overflow-hidden border border-rule">
        <img src={previewUrl} alt="" className="h-full w-full object-cover" />
      </div>

      <label className="mb-[16px] block">
        <span className="section-label mb-[6px] flex items-baseline justify-between">
          {strings.settings.backgroundOpacity}
          <span className="meta tabular-nums">{Math.round(opacity * 100)}%</span>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={opacity}
          className="w-full"
          onChange={(event) => setOpacity.mutate(Number(event.target.value))}
        />
      </label>

      <form
        className="mb-[8px] flex gap-[6px]"
        onSubmit={(event) => {
          event.preventDefault();
          generate.mutate(prompt.trim() === "" ? {} : { prompt: prompt.trim() });
          setPrompt("");
        }}
      >
        <input
          className="field min-h-0 flex-1 py-[8px] text-[13px]"
          placeholder={strings.settings.backgroundPrompt}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <button type="submit" className="btn flex-none px-[12px]" disabled={generate.isPending}>
          {generate.isPending ? strings.settings.backgroundWorking : strings.settings.backgroundGenerate}
        </button>
      </form>
      {generate.error !== null ? (
        <p className="explain explain-alert mb-[10px]">{generate.error.message}</p>
      ) : null}

      {list.length === 0 ? (
        <p className="explain">{strings.settings.backgroundNone}</p>
      ) : (
        <div className="grid grid-cols-2 gap-[10px]">
          {list.map((background) => (
            <div key={background.id} className="border border-rule">
              <img
                src={`/api/backgrounds/${background.id}/image`}
                alt=""
                className="h-[90px] w-full object-cover"
              />
              <div className="flex items-center gap-[6px] p-[6px]">
                {background.isDefault ? (
                  <span className="chrome flex-1 text-[11px] text-ink-muted">
                    {strings.settings.presetIsDefault}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="chrome flex-1 text-left text-[11px]"
                    style={{ color: "var(--onsen-color-blue-text)" }}
                    onClick={() => setDefault.mutate(background.id)}
                  >
                    {strings.settings.backgroundSetDefault}
                  </button>
                )}
                {background.isDefault ? null : (
                  <button
                    type="button"
                    className="chrome text-[11px]"
                    style={{ color: "var(--onsen-color-red)" }}
                    onClick={() => remove.mutate(background.id)}
                  >
                    {strings.settings.backgroundDelete}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
