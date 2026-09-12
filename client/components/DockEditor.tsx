import { useState } from "react";
import { DOCK_DEFAULTS, DOCK_WIDTH_BOUNDS } from "@shared/types.ts";
import type { DockDto, DockPanel } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { useDock, useSetPreferences } from "../lib/queries.ts";
import { useIsDesktop } from "../lib/breakpoint.ts";
import { Sheet } from "./Sheet.tsx";
import { Segmented } from "./Segmented.tsx";
import { PANEL_META } from "./DockPanels.tsx";

/**
 * The rail dock editor (§20 phase 173): move a panel to the other rail, hide
 * it, or reorder it within whichever side it is on.
 *
 * This is a matrix of toggles, deliberately, in a codebase whose own §16
 * otherwise reads "a matrix of toggles in place of a default is the
 * incumbent's answer." What keeps it from being the thing that rule is
 * written against: it is an opt-in editor a reader reaches for once, not a
 * screen full of switches everyone sees by default, and the default
 * arrangement — `DOCK_DEFAULTS` — is exactly what every rail already showed
 * before this editor existed and stays exactly that until someone opens it.
 * The same shape `LAYOUT_PRESETS` already uses: a name is a mode, the
 * switches under it stay editable for whoever wants them.
 *
 * No drag-and-drop, on the same grounds `PresetEditor.tsx`'s `PromptManager`
 * already gives for its own reordering: there is no drag-reorder anywhere in
 * this client, HTML5 drag is poor under a thumb, and a library is a
 * dependency. Moving a panel is a 3-way choice (`Segmented`); reordering
 * within a side is the ↑/↓ pair `PromptManager` already established.
 */

type Side = "left" | "right" | "hidden";

function sideOf(dock: DockDto, panel: DockPanel): Side {
  if (dock.left.includes(panel)) return "left";
  if (dock.right.includes(panel)) return "right";
  return "hidden";
}

/** Desktop only — the rails this edits do not exist on a phone. */
export function DockSection() {
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  if (!isDesktop) return null;
  return (
    <>
      <p className="section-label mb-[6px]">{strings.settings.dock}</p>
      {/* No explainer under it: the button says what it opens, the editor
          says the rest, and every move it makes is reversible — which is the
          bar §20's voice pass set for prose earning its place. */}
      <button type="button" className="btn mb-[14px] w-full" onClick={() => setOpen(true)}>
        {strings.settings.dockOpen}
      </button>
      {open ? <DockEditorSheet onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function DockEditorSheet({ onClose }: { onClose(): void }) {
  const dock = useDock();
  const save = useSetPreferences();
  const set = (patch: Partial<DockDto>) => save.mutate({ dock: patch });

  function setSide(panel: DockPanel, next: Side) {
    const left = dock.left.filter((id) => id !== panel);
    const right = dock.right.filter((id) => id !== panel);
    const hidden = dock.hidden.filter((id) => id !== panel);
    if (next === "left") left.push(panel);
    if (next === "right") right.push(panel);
    // Hiding is written down rather than left as an absence (§20 phase 177):
    // an absence cannot tell a panel the reader hid from one that shipped
    // after they last opened this editor.
    if (next === "hidden") hidden.push(panel);
    set({ left, right, hidden });
  }

  function move(side: "left" | "right", panel: DockPanel, by: number) {
    const list = [...dock[side]];
    const index = list.indexOf(panel);
    const to = index + by;
    if (index < 0 || to < 0 || to >= list.length) return;
    const [moved] = list.splice(index, 1);
    list.splice(to, 0, moved!);
    set({ [side]: list } as Partial<DockDto>);
  }

  const sections: { side: Side; label: string }[] = [
    { side: "left", label: strings.settings.dockSideLeft },
    { side: "right", label: strings.settings.dockSideRight },
    { side: "hidden", label: strings.settings.dockSideHidden },
  ];

  return (
    <Sheet title={strings.settings.dockTitle} onClose={onClose}>
      <div className="pt-[6px] pb-[14px]">
        {sections.map(({ side, label }) => {
          const panels = dock[side];
          return (
            <div key={side} className="mb-[18px]">
              <p className="section-label mb-[6px]">{label}</p>
              {panels.length === 0 ? (
                <p className="explain mb-[8px]">{strings.settings.dockHiddenEmpty}</p>
              ) : null}
              {panels.map((id) => {
                const meta = PANEL_META[id];
                const Icon = meta.Icon;
                return (
                  <div key={id} className="border-b border-rule py-[10px]">
                    <div className="mb-[8px] flex items-center gap-[8px]">
                      <Icon size={16} strokeWidth={1.75} style={{ color: "var(--onsen-color-text-dim)" }} />
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
                        {meta.label}
                      </span>
                      {side === "hidden" ? null : (
                        <>
                          <button
                            type="button"
                            aria-label={`${strings.settings.blockUp} ${meta.label}`}
                            onClick={() => move(side, id, -1)}
                            className="chrome h-[26px] w-[22px] flex-none text-ink-dim hover:text-ink-label"
                          >
                            {"↑"}
                          </button>
                          <button
                            type="button"
                            aria-label={`${strings.settings.blockDown} ${meta.label}`}
                            onClick={() => move(side, id, 1)}
                            className="chrome h-[26px] w-[22px] flex-none text-ink-dim hover:text-ink-label"
                          >
                            {"↓"}
                          </button>
                        </>
                      )}
                    </div>
                    <Segmented
                      label=""
                      value={side}
                      options={[
                        { value: "left" as const, label: strings.settings.dockSideLeft },
                        { value: "right" as const, label: strings.settings.dockSideRight },
                        { value: "hidden" as const, label: strings.settings.dockSideHidden },
                      ]}
                      onPick={(next) => setSide(id, next)}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* Width, bounded the way `READING_BOUNDS` bounds the reading
            sliders: narrow enough a panel never becomes useless, wide enough
            it never eats the log below its own measure. */}
        {(["leftWidth", "rightWidth"] as const).map((key) => {
          const [min, max] = DOCK_WIDTH_BOUNDS;
          const label = key === "leftWidth" ? strings.settings.dockLeftWidth : strings.settings.dockRightWidth;
          return (
            <label key={key} className="row block">
              <span className="flex items-baseline justify-between gap-[10px]">
                <span className="section-label">{label}</span>
                <span className="meta tabular-nums">{dock[key]}px</span>
              </span>
              <input
                type="range"
                min={min}
                max={max}
                step={2}
                value={dock[key]}
                aria-label={label}
                className="mt-[6px] w-full"
                onChange={(event) => set({ [key]: Number(event.target.value) } as Partial<DockDto>)}
              />
            </label>
          );
        })}

        <button type="button" className="btn mt-[14px] w-full" onClick={() => set(DOCK_DEFAULTS)}>
          {strings.settings.dockReset}
        </button>
      </div>
    </Sheet>
  );
}
