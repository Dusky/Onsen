import { PanelLeft, PanelRight } from "lucide-react";
import { strings } from "../strings.ts";
import { navigate, useShellRoute } from "../lib/router.ts";
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
 * turn count, prose size, the base (dark or light), the two panel toggles,
 * and Settings. The model that answers moved down beside the composer (phase
 * 101). Desktop only; the phone keeps the navigation top bar.
 *
 * The header used to also carry a row of library destinations — Characters,
 * Authors, Lorebooks, Backgrounds, Roleplays — duplicating entry points the
 * rails already have (design review fix 5). Characters and Authors are the
 * right rail's own tabs, better than a screen because they sit beside the
 * scene being edited against; Lore is the left rail's Lore section; Roleplays
 * is what the wordmark button already opens. Backgrounds had no rail home and
 * moved into Settings, since it is configured once rather than worked in.
 * The `/characters`, `/authors`, `/lorebooks` and `/backgrounds` routes still
 * work for deep links and the phone layout — this only removed the desktop
 * top-bar entry points to them.
 *
 * Settings moved the other way, in: it used to sit at the foot of the left
 * rail's icon column, looking like a fifth section though it could never
 * show an active state and was the only one to navigate off the page
 * (design review fix 4). It lives here now, set off with a hairline and the
 * muted treatment rather than the rail's own button shape.
 */

/** The prose step the A−/A+ buttons take, matching the settings slider's. */
const PROSE_STEP = 0.05;

/** The two flat builtin themes the Dark/Light toggle switches between. */
const BASE_THEMES = { dark: "Midnight", light: "Bone" } as const;

export function Header() {
  // The *base* route, not the current one (§20 phase 180). Settings and every
  // other non-base screen is an overlay over a still-mounted base since phase
  // 171 — so the roleplay is still open behind them, and the header used to
  // stop showing it the moment one opened, leaving no way back to the thing
  // you were reading.
  const { base, overlay } = useShellRoute();
  const generation = useGeneration();
  const scenes = useScenes();
  const reading = useReading();
  const save = useSetPreferences();
  const themes = useThemes();
  const activate = useActivateTheme();
  const { toggleLeftRail, toggleRightRail } = useUiStore();

  const sceneId = base.name === "chat" ? base.sceneId : null;
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
      {/* Two buttons, not one. The wordmark opens the roleplay list; the
          scene chip goes back to the roleplay itself — which is what it looked
          like it did and did not (§20 phase 180). Both were one button to the
          list, so the only thing in the header naming the open roleplay was
          the one thing that navigated away from it. */}
      <button
        type="button"
        onClick={() => navigate({ name: "scenes" })}
        aria-label={strings.header.sceneMenu}
        className="chrome flex flex-none items-center gap-[7px] pl-[12px] pr-[8px] text-[12px] font-medium"
        style={{ color: "var(--onsen-color-text)" }}
      >
        <Logo className="h-[18px] w-auto" />
        <span>onsen</span>
      </button>
      {scene === null ? null : (
        <button
          type="button"
          onClick={() => navigate(base)}
          aria-label={strings.header.backToScene(
            scene.title === "" ? strings.scenes.untitled : scene.title,
          )}
          className="chrome flex min-w-0 flex-none items-center gap-[7px] pr-[12px] text-[12px]"
        >
          {/* A left chevron while an overlay is up, because then this is a way
              back rather than a label. The dot is the separator otherwise. */}
          <span aria-hidden="true" style={{ color: "var(--onsen-color-text-dim)" }}>
            {overlay === null ? "\u00b7" : "\u2039"}
          </span>
          <span
            className="truncate font-medium"
            style={{
              color: sceneWriting
                ? "var(--onsen-color-amber)"
                : overlay === null
                  ? "var(--onsen-color-text)"
                  : "var(--onsen-color-blue-text)",
            }}
          >
            {scene.title === "" ? strings.scenes.untitled : scene.title}
          </span>
          <span className="text-[11px]" style={{ color: "var(--onsen-color-text-dim)" }}>
            {strings.header.turns(scene.turnCount)}
          </span>
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

      {/*
        The two panel toggles (§20 phase 190).

        These were the Unicode half-blocks ▎ and ▕ — "mirroring the rail
        glyphs", which they did, but every neighbour in this bar is a word
        ("Dark", "Light", "Settings") or a letter ("A", "A"), so two block
        drawing characters read as a font-rendering fault rather than as
        controls. They were labelled and tooltipped the whole time; they just
        looked broken. Real icons, in the size and weight the rails already
        use (`LeftRail.tsx`).
      */}
      <div className="flex items-center gap-[2px] border-l border-rule px-[10px]">
        <button
          type="button"
          title={strings.header.leftPanel}
          aria-label={strings.header.leftPanel}
          onClick={toggleLeftRail}
          className="chrome flex h-[24px] w-[24px] items-center justify-center"
        >
          <PanelLeft
            size={16}
            strokeWidth={1.75}
            style={{ color: "var(--onsen-color-text-muted)" }}
          />
        </button>
        <button
          type="button"
          title={strings.header.rightPanel}
          aria-label={strings.header.rightPanel}
          onClick={toggleRightRail}
          className="chrome flex h-[24px] w-[24px] items-center justify-center"
        >
          <PanelRight
            size={16}
            strokeWidth={1.75}
            style={{ color: "var(--onsen-color-text-muted)" }}
          />
        </button>
      </div>

      {/* Settings: a destination, not a section, so it does not share the
          panel toggles' shape or the wordmark's weight \u2014 a hairline and the
          muted treatment mark it as leaving the page (design review fix 4). */}
      <button
        type="button"
        onClick={() => navigate({ name: "settings" })}
        aria-label={strings.nav.settings}
        className="chrome flex items-center border-l border-rule px-[12px] text-[12px] text-ink-muted"
      >
        {strings.nav.settings}
      </button>
    </header>
  );
}
