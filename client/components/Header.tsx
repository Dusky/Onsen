import { strings } from "../strings.ts";
import { navigate, useRoute } from "../lib/router.ts";
import { useGeneration } from "../lib/generation.ts";
import { Logo } from "./Logo.tsx";
import {
  useActivateTheme,
  useReading,
  useScenes,
  useSetPreferences,
  useThemes,
} from "../lib/queries.ts";
import { useUiStore } from "../state/ui.ts";
import { READING_BOUNDS } from "@shared/types.ts";

/**
 * The desktop header (the redesign, §20 phase 91).
 *
 * The mockup's top bar is not the navigation strip the workbench put there —
 * those destinations moved into the two rails. It is the scene's identity and
 * the reading surface's controls: a mono wordmark, the open scene's title and
 * turn count, prose size, the base (dark or light) and the two panel toggles.
 * The model that answers moved down beside the composer (phase 101). Desktop
 * only; the phone keeps the navigation top bar.
 */

/** The prose step the A−/A+ buttons take, matching the settings slider's. */
const PROSE_STEP = 0.05;

/** The two flat builtin themes the Dark/Light toggle switches between. */
const BASE_THEMES = { dark: "Midnight", light: "Bone" } as const;

export function Header() {
  const route = useRoute();
  const generation = useGeneration();
  const scenes = useScenes();
  const reading = useReading();
  const save = useSetPreferences();
  const themes = useThemes();
  const activate = useActivateTheme();
  const { toggleLeftRail, toggleRightRail } = useUiStore();

  const sceneId = route.name === "chat" ? route.sceneId : null;
  const scene = (scenes.data ?? []).find((candidate) => candidate.id === sceneId) ?? null;

  // The scene's title runs amber while it is writing — the same live state the
  // cast cards carry, so the header and the rail agree on what "now" is.
  const writing =
    generation.active !== null &&
    (generation.active.status === "connecting" || generation.active.status === "streaming")
      ? generation.active
      : null;
  const sceneWriting = writing !== null && writing.sceneId === sceneId;

  const activeBase = (themes.data?.themes ?? []).find(
    (theme) => theme.id === themes.data?.activeId,
  )?.base;

  function setScale(delta: number) {
    const [min, max] = READING_BOUNDS.scale;
    const next = Math.min(max, Math.max(min, Number((reading.scale + delta).toFixed(2))));
    save.mutate({ reading: { ...reading, scale: next } });
  }

  function setBase(base: "dark" | "light") {
    const list = themes.data?.themes ?? [];
    const named = list.find((theme) => theme.name === BASE_THEMES[base]);
    const target = named ?? list.find((theme) => theme.base === base);
    if (target !== undefined && target.id !== themes.data?.activeId) activate.mutate(target.id);
  }

  return (
    <header
      className="flex flex-none items-stretch border-b border-rule bg-bg-sunken"
      style={{ minHeight: "38px" }}
    >
      {/* The wordmark, now the mono the mockup sets it in rather than the serif. */}
      <button
        type="button"
        onClick={() => navigate({ name: "scenes" })}
        className="chrome flex flex-none items-center gap-[7px] px-[12px] text-[12px] font-medium"
        style={{ color: "var(--onsen-color-text)" }}
      >
        <Logo className="h-[18px] w-auto" />
        <span>onsen</span>
      </button>

      {/* The open scene, with its turn count. Outside a roleplay this is absent —
          the bar is the shell's, and the scene is the one thing it cannot always
          name. */}
      {scene === null ? null : (
        <button
          type="button"
          onClick={() => navigate({ name: "scenes" })}
          aria-label={strings.header.sceneMenu}
          className="chrome flex items-center gap-[8px] border-l border-rule px-[12px] text-[12.5px]"
          style={{ color: sceneWriting ? "var(--onsen-color-amber)" : "var(--onsen-color-text)" }}
        >
          <span className="font-medium">{scene.title === "" ? strings.scenes.untitled : scene.title}</span>
          <span
            className="text-[11px]"
            style={{ color: "var(--onsen-color-text-dim)" }}
          >
            {strings.header.turns(scene.messageCount)}
          </span>
          <span aria-hidden="true" style={{ color: "var(--onsen-color-text-dim)" }}>{"\u25be"}</span>
        </button>
      )}

      <div className="min-w-0 flex-1" />

      {/* Prose size: two A's, the mockup's control in the reading surface's own
          serif. */}
      <div className="flex items-center gap-[4px] border-l border-rule px-[10px]">
        <span className="text-[11px]" style={{ color: "var(--onsen-color-text-dim)" }}>
          {strings.header.text}
        </span>
        <button
          type="button"
          title={strings.header.proseSmaller}
          aria-label={strings.header.proseSmaller}
          onClick={() => setScale(-PROSE_STEP)}
          className="flex h-[24px] w-[24px] items-center justify-center border border-rule-strong text-[11px]"
          style={{ fontFamily: "var(--onsen-font-prose)", color: "var(--onsen-color-text-muted)" }}
        >
          A
        </button>
        <button
          type="button"
          title={strings.header.proseLarger}
          aria-label={strings.header.proseLarger}
          onClick={() => setScale(PROSE_STEP)}
          className="flex h-[24px] w-[24px] items-center justify-center border border-rule-strong text-[15px]"
          style={{ fontFamily: "var(--onsen-font-prose)", color: "var(--onsen-color-text-muted)" }}
        >
          A
        </button>
      </div>

      {/* Dark / Light: the base switch, mapped onto the two flat builtin themes. */}
      <div className="flex items-center border-l border-rule px-[10px]">
        {(["dark", "light"] as const).map((base) => {
          const active = activeBase === base;
          return (
            <button
              key={base}
              type="button"
              onClick={() => setBase(base)}
              aria-pressed={active}
              className="chrome h-[24px] px-[9px] text-[11px] border border-rule-strong"
              style={{
                background: active ? "var(--onsen-color-bg-inset)" : "transparent",
                color: active ? "var(--onsen-color-text)" : "var(--onsen-color-text-muted)",
                marginLeft: base === "light" ? "-1px" : undefined,
              }}
            >
              {base === "dark" ? strings.header.dark : strings.header.light}
            </button>
          );
        })}
      </div>

      {/* The two panel toggles, mirroring the rail glyphs. */}
      <div className="flex items-center gap-[2px] border-l border-rule px-[10px]">
        <button
          type="button"
          title={strings.header.leftPanel}
          aria-label={strings.header.leftPanel}
          onClick={toggleLeftRail}
          className="chrome flex h-[24px] w-[24px] items-center justify-center text-[12px]"
          style={{ color: "var(--onsen-color-text-muted)" }}
        >
          {"\u258e"}
        </button>
        <button
          type="button"
          title={strings.header.rightPanel}
          aria-label={strings.header.rightPanel}
          onClick={toggleRightRail}
          className="chrome flex h-[24px] w-[24px] items-center justify-center text-[12px]"
          style={{ color: "var(--onsen-color-text-muted)" }}
        >
          {"\u2595"}
        </button>
      </div>
    </header>
  );
}
