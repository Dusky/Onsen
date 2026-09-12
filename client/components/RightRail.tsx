import { useRoute } from "../lib/router.ts";
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
 * which of the seven panels live here, in what order, and how wide the panel
 * is, and `PANEL_META` (`DockPanels.tsx`) supplies each one's icon, label and
 * body. What is left here is the rail's own chrome — the collapsed icon
 * strip, the open panel's tab row and close chevron — parameterised by
 * whichever list `useDock().right` currently is, including empty.
 */
export function RightRail() {
  const route = useRoute();
  const dock = useDock();
  const rightRailOpen = useUiStore((state) => state.rightRailOpen);
  const toggleRightRail = useUiStore((state) => state.toggleRightRail);
  const storedActive = useUiStore((state) => state.rightActive);
  const setRightActive = useUiStore((state) => state.setRightActive);
  const sceneId = route.name === "chat" ? route.sceneId : null;

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

  const Active = PANEL_META[active].Component;

  return (
    <aside className="flex flex-none flex-col border-l border-rule bg-bg-sunken" style={{ width: `${dock.rightWidth}px` }}>
      <div className="hairline flex flex-none items-center justify-between pr-[8px]">
        <div className="flex min-w-0 items-stretch">
          {panels.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setRightActive(id)}
              aria-current={active === id ? "true" : undefined}
              className="chrome flex min-h-[44px] items-center px-[12px] text-[12.5px]"
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Active sceneId={sceneId} />
      </div>
    </aside>
  );
}
