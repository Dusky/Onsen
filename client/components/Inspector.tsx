import type { ReactNode } from "react";
import { strings } from "../strings.ts";

/**
 * The right-hand pane (SPEC §20 phase 43).
 *
 * The Workbench direction's third pane. What used to be a cast rail plus two
 * sheets you opened and dismissed is one pane with tabs: the context is on
 * screen while you read rather than something you go and fetch, which is the
 * whole argument for spending the width on it.
 *
 * It renders nodes rather than taking each tab's props, because threading
 * fifteen props through a shell that only decides which of two children is
 * visible would make this file the place they all have to be kept correct.
 *
 * Desktop only. On a phone the same bodies are still sheets — a pane there
 * would cost the log a third of its width to show what a tap already reaches.
 */

export type InspectorTab = "context" | "cast";

export function Inspector({
  tab,
  onTab,
  context,
  cast,
}: {
  tab: InspectorTab;
  onTab(tab: InspectorTab): void;
  context: ReactNode;
  cast: ReactNode;
}) {
  return (
    <aside
      aria-label={strings.chat.inspectorPane}
      className="flex w-[364px] flex-none flex-col border-l border-rule bg-bg-sunken"
    >
      <div className="hairline flex flex-none items-stretch">
        {(
          [
            ["context", strings.chat.inspectorTabContext],
            ["cast", strings.chat.inspectorTabCast],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => onTab(id)}
            aria-current={tab === id ? "true" : undefined}
            className="chrome flex min-h-[44px] items-center px-[14px] text-[9px] tracking-[0.12em] uppercase"
            style={{
              color: tab === id ? "var(--onsen-color-text)" : "var(--onsen-color-text-dim)",
              borderBottom: `2px solid ${tab === id ? "var(--onsen-color-red)" : "transparent"}`,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* The bodies were drawn inside a 620px sheet, which supplied both the
          padding and a place to shrink. A pane has to supply both itself, or
          the content runs past the edge — which is exactly what it did. */}
      <div
        className={`flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto ${
          tab === "context" ? "px-[16px] pb-[16px]" : ""
        }`}
      >
        {tab === "context" ? context : cast}
      </div>
    </aside>
  );
}
