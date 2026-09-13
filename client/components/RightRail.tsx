import { useEffect, useRef } from "react";
import { useShellRoute } from "../lib/router.ts";
import { useDock } from "../lib/queries.ts";
import { useUiStore } from "../state/ui.ts";
import { strings } from "../strings.ts";
import { PANEL_META } from "./DockPanels.tsx";

/**
 * The right rail (the redesign phase 90, polished phase 97; made a dockable
 * side rather than a fixed one by phase 173's rail dock rework).
 *
 * This file used to own three hardcoded tabs — In this scene, Characters,
 * Authors — and their icons. It now owns none of that: `useDock()` names
 * which of the eight panels live here, in what order, and how wide the panel
 * is, and `PANEL_META` (`DockPanels.tsx`) supplies each one's icon, label and
 * body. What is left here is the rail's own chrome — the collapsed icon
 * strip, the open panel's tab row and close chevron — parameterised by
 * whichever list `useDock().right` currently is, including empty.
 */
export function RightRail() {
  const { base } = useShellRoute();
  const dock = useDock();
  const rightRailOpen = useUiStore((state) => state.rightRailOpen);
  const toggleRightRail = useUiStore((state) => state.toggleRightRail);
  const storedActive = useUiStore((state) => state.rightActive);
  const setRightActive = useUiStore((state) => state.setRightActive);
  /*
   * The *base* route's scene, not the current route's (§20 phase 180).
   *
   * Every non-base screen is an overlay over a still-mounted base since phase
   * 171, so a roleplay stays open behind Settings — but this read was
   * `route.name === "chat"`, which meant opening Settings told every docked
   * panel there was no roleplay. The Models panel's "This roleplay" went
   * blank, the prompt panel stopped previewing, and all of it came back on
   * close. The rails sit outside the overlay; they should see what is behind
   * it.
   */
  const sceneId = base.name === "chat" ? base.sceneId : null;
  const activeTab = useRef<HTMLButtonElement | null>(null);

  /*
   * Keep the selected tab in view when something else selects it.
   *
   * The tab row scrolls sideways now, and a panel can be selected without
   * being clicked — the composer's Off script op does exactly that, and at a
   * narrow rail width the tab it selects can be off the right edge. The
   * reader would press a button and see nothing move.
   *
   * `block: "nearest"` so this never scrolls the page itself, only the row.
   */
  useEffect(() => {
    activeTab.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [storedActive]);

  const panels = dock.right;
  // A reader moved every panel to the left, or hid them all — no hollow
  // column, the same rule the left rail follows.
  if (panels.length === 0) return null;
  const active = panels.includes(storedActive) ? storedActive : panels[0]!;

  if (!rightRailOpen) {
    // Collapsed is an icon rail, not a dead sliver (§149).
    return (
      <aside className="flex w-[44px] flex-none flex-col items-stretch border-l border-rule bg-bg-sunken py-[8px]">
        {panels.map((id) => {
          const meta = PANEL_META[id];
          const Icon = meta.Icon;
          const on = active === id;
          return (
            <button
              key={id}
              type="button"
              title={meta.label}
              aria-label={meta.label}
              aria-current={on ? "true" : undefined}
              onClick={() => {
                setRightActive(id);
                toggleRightRail();
              }}
              className="flex min-h-[40px] items-center justify-center"
            >
              <Icon
                size={17}
                strokeWidth={1.75}
                style={{ color: on ? "var(--onsen-color-blue-text)" : "var(--onsen-color-text-dim)" }}
              />
            </button>
          );
        })}
      </aside>
    );
  }

  const meta = PANEL_META[active];
  const Active = meta.Component;

  return (
    <aside className="flex flex-none flex-col border-l border-rule bg-bg-sunken" style={{ width: `${dock.rightWidth}px` }}>
      <div className="hairline flex flex-none items-center justify-between pr-[8px]">
        {/* The tab row scrolls sideways rather than wrapping or clipping. Three
            tabs fit the shipped width; a fourth arrived with Off script in
            phase 177, and the dock editor has allowed all eight on one side
            since phase 173 — so this had to hold more than it was drawn for
            either way. `shrink-0` on the tabs is what makes it scroll instead
            of squeezing every label to nothing. */}
        <div className="flex min-w-0 items-stretch overflow-x-auto">
          {panels.map((id) => (
            <button
              key={id}
              type="button"
              ref={active === id ? activeTab : null}
              onClick={() => setRightActive(id)}
              aria-current={active === id ? "true" : undefined}
              className="chrome flex min-h-[44px] shrink-0 items-center px-[12px] text-ui whitespace-nowrap"
              style={{
                color: active === id ? "var(--onsen-color-text)" : "var(--onsen-color-text-dim)",
                borderBottom: `2px solid ${active === id ? "var(--onsen-color-blue)" : "transparent"}`,
              }}
            >
              {PANEL_META[id].label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label={strings.settings.railClose}
          onClick={toggleRightRail}
          className="chrome flex h-[28px] w-[28px] flex-none items-center justify-center text-[13px] text-ink-muted"
        >
          {"›"}
        </button>
      </div>

      {/* A panel that manages its own height gets the space and no scroll
          container: `ooc`'s composer is pinned under a scrolling log, and a
          rail-level scroll would carry the composer off the bottom edge. */}
      <div className={meta.fills ? "min-h-0 flex-1" : "min-h-0 flex-1 overflow-y-auto"}>
        <Active sceneId={sceneId} />
      </div>
    </aside>
  );
}
