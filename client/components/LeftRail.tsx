import { useRoute } from "../lib/router.ts";
import { useDock } from "../lib/queries.ts";
import { useUiStore } from "../state/ui.ts";
import { strings } from "../strings.ts";
import { PANEL_META } from "./DockPanels.tsx";

/**
 * The left rail (the redesign, phase 89; made a dockable side rather than a
 * fixed one by phase 173's rail dock rework).
 *
 * This file used to own four hardcoded panels — Prompt, Preset, Lore,
 * Guides — and their icon strip. It now owns none of that: `useDock()` names
 * which of the eight panels (`shared/types.ts`'s `DockPanel`) live here, in
 * what order, and how wide the panel is, and `PANEL_META` (`DockPanels.tsx`)
 * supplies each one's icon, label and body. What is left here is the rail's
 * own chrome — the collapsed icon strip, the open panel's header and close
 * chevron — parameterised by whichever list `useDock().left` currently is,
 * including empty (a reader who moved every panel away sees no rail at all,
 * rather than a hollow column).
 *
 * Desktop only. On a phone these bodies stay where they were — the prompt
 * inspector is still a sheet, the preset editor a screen.
 */
export function LeftRail() {
  const route = useRoute();
  const dock = useDock();
  const leftRailOpen = useUiStore((state) => state.leftRailOpen);
  const toggleLeftRail = useUiStore((state) => state.toggleLeftRail);
  const storedActive = useUiStore((state) => state.leftActive);
  const setLeftActive = useUiStore((state) => state.setLeftActive);
  const sceneId = route.name === "chat" ? route.sceneId : null;

  const panels = dock.left;
  // Nothing here to show — a reader moved every panel to the other side or
  // hid them all. A hollow 54px column would be worse than no rail.
  if (panels.length === 0) return null;
  // The remembered selection may be a panel that used to live here and has
  // since moved or been hidden; fall back to whatever this side still has.
  const active = panels.includes(storedActive) ? storedActive : panels[0]!;

  if (!leftRailOpen) {
    // Collapsed is a glyph rail, not a dead sliver: each section is one tap
    // away, and tapping expands onto it (§149). Same 54px width as the open
    // branch's icon column, with the same labels under the glyphs — this used
    // to be a 44px sliver, which slid every glyph 10px sideways the instant
    // the panel opened (design review fix 3).
    return (
      <nav className="flex w-[54px] flex-none flex-col items-stretch border-r border-rule bg-bg-sunken py-[8px]">
        {panels.map((id) => {
          const meta = PANEL_META[id];
          const Icon = meta.Icon;
          const isActive = active === id;
          return (
            <button
              key={id}
              type="button"
              title={meta.label}
              aria-label={meta.label}
              aria-current={isActive ? "true" : undefined}
              onClick={() => {
                setLeftActive(id);
                toggleLeftRail();
              }}
              className="flex min-h-[40px] flex-col items-center justify-center gap-[2px] px-[4px]"
              style={{
                background: isActive ? "var(--onsen-color-bg-inset)" : "transparent",
                boxShadow: isActive ? "inset 2px 0 0 var(--onsen-color-blue)" : "none",
              }}
            >
              <Icon
                size={18}
                strokeWidth={1.75}
                style={{ color: isActive ? "var(--onsen-color-blue-text)" : "var(--onsen-color-text-dim)" }}
              />
              <span
                className="chrome text-[11px] leading-none"
                style={{ color: isActive ? "var(--onsen-color-text)" : "var(--onsen-color-text-dim)" }}
              >
                {meta.label}
              </span>
            </button>
          );
        })}
        <div className="flex-1" />
      </nav>
    );
  }

  const meta = PANEL_META[active];
  const Active = meta.Component;

  return (
    <nav className="flex flex-none border-r border-rule bg-bg-sunken">
      {/* The icon rail: one glyph per docked panel, a label under each, the
          active one picked out in the interactive blue rather than the warm
          red the workbench used. Settings used to sit at the foot of this
          column; it moved to the header (design review fix 4) — it is a
          destination, not a section, and could never show an active state
          here. */}
      <div className="flex w-[54px] flex-none flex-col items-stretch border-r border-rule py-[8px]">
        {panels.map((id) => {
          const meta = PANEL_META[id];
          const Icon = meta.Icon;
          const isActive = active === id;
          return (
            <button
              key={id}
              type="button"
              aria-current={isActive ? "true" : undefined}
              onClick={() => setLeftActive(id)}
              className="flex min-h-[44px] flex-col items-center justify-center gap-[2px] px-[4px]"
              style={{
                background: isActive ? "var(--onsen-color-bg-inset)" : "transparent",
                boxShadow: isActive ? "inset 2px 0 0 var(--onsen-color-blue)" : "none",
              }}
            >
              <Icon
                size={20}
                strokeWidth={1.75}
                style={{ color: isActive ? "var(--onsen-color-blue-text)" : "var(--onsen-color-text-dim)" }}
              />
              <span
                className="chrome text-[11px] leading-none"
                style={{ color: isActive ? "var(--onsen-color-text)" : "var(--onsen-color-text-dim)" }}
              >
                {meta.label}
              </span>
            </button>
          );
        })}
        <div className="flex-1" />
      </div>

      {/* The section panel, at whatever width the dock editor last left it
          (§20 phase 173) — 326px is only the shipped default now, not a
          constant. */}
      <div className="flex flex-none flex-col" style={{ width: `${dock.leftWidth}px` }}>
        <div className="hairline flex flex-none items-center justify-between px-[14px] py-[9px]">
          <p className="section-label">{PANEL_META[active].titleLabel}</p>
          <button
            type="button"
            aria-label={strings.settings.railClose}
            onClick={toggleLeftRail}
            className="chrome flex h-[28px] w-[28px] items-center justify-center text-[13px] text-ink-muted"
          >
            {"‹"}
          </button>
        </div>
        {/* A panel that manages its own height gets the space, no scroll
            container and no gutter: `ooc`'s composer is pinned under a
            scrolling log, and a rail-level scroll would carry it off the
            bottom edge. */}
        <div
          className={
            meta.fills ? "min-h-0 flex-1" : "min-h-0 flex-1 overflow-y-auto px-[14px] pb-[16px]"
          }
        >
          <Active sceneId={sceneId} />
        </div>
      </div>
    </nav>
  );
}
