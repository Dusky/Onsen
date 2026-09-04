import { useEffect, useMemo, useRef, useState } from "react";
import { strings } from "../strings.ts";
import { GROUP_ORDER, matchCommands, type Command, type CommandGroup } from "../lib/commands.ts";

/**
 * Every command, two keystrokes away (SPEC §20 phase 43).
 *
 * Replaces both the nineteen-row message sheet and the ops grid. Those were two
 * hand-written lists of the same actions; this is one list, rendered from the
 * registry, so a command added in one place cannot go missing from the other.
 *
 * Scoped rather than global: the header says which turn is selected, and a
 * command that cannot run right now is not offered at all. A palette that lists
 * "Reroll" with nothing to reroll is lying about what pressing return will do.
 */
export function CommandPalette({
  hasScene,
  selectedSpeaker,
  onRun,
  onClose,
}: {
  hasScene: boolean;
  /** Null when no turn is selected — which hides every turn-scoped command. */
  selectedSpeaker: string | null;
  onRun(id: string): void;
  onClose(): void;
}) {
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const matches = useMemo(
    () => matchCommands(query, { hasScene, hasTurn: selectedSpeaker !== null }),
    [query, hasScene, selectedSpeaker],
  );

  // A new query invalidates where the cursor was.
  useEffect(() => setAt(0), [query]);

  // Keep the cursor in view: the list is longer than the box on a phone.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>("[data-at='true']")?.scrollIntoView({
      block: "nearest",
    });
  }, [at]);

  const run = (command: Command) => {
    if (command.unavailable !== undefined) return;
    onRun(command.id);
    onClose();
  };

  const grouped = GROUP_ORDER.map((group) => ({
    group,
    items: matches.filter((command) => command.group === group),
  })).filter((section) => section.items.length > 0);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center px-[16px] pt-[64px]"
      style={{ background: "rgba(12, 10, 8, 0.62)" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={strings.chat.paletteOpen}
        className="flex max-h-[70vh] w-full max-w-[620px] flex-col border"
        style={{ background: "var(--onsen-color-bg-raised)", borderColor: "var(--onsen-color-rule-strong)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="hairline flex flex-none items-center gap-[11px] px-[16px] py-[13px]">
          <span className="chrome text-[13px] text-ink-dim">&rsaquo;</span>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={strings.chat.palettePlaceholder}
            aria-label={strings.chat.palettePlaceholder}
            className="chrome min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-dim"
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setAt((n) => Math.min(matches.length - 1, n + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setAt((n) => Math.max(0, n - 1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                const command = matches[at];
                if (command !== undefined) run(command);
              } else if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
          />
          {/* What the turn commands will act on. Without this the palette is
              ambiguous the moment more than one turn is on screen. */}
          {selectedSpeaker === null ? null : (
            <span
              className="chrome flex-none text-[8.5px] tracking-[0.12em] uppercase"
              style={{ color: "var(--onsen-color-red)" }}
            >
              {strings.chat.paletteScope(selectedSpeaker)}
            </span>
          )}
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
          {matches.length === 0 ? (
            <p className="chrome px-[16px] py-[18px] text-[10px] text-ink-dim">
              {strings.chat.paletteEmpty}
            </p>
          ) : (
            grouped.map((section) => (
              <div key={section.group}>
                <p className="section-label px-[16px] pt-[11px] pb-[5px]">
                  {strings.chat.paletteGroups[section.group as CommandGroup] ?? section.group}
                </p>
                {section.items.map((command) => {
                  const index = matches.indexOf(command);
                  const here = index === at;
                  const blocked = command.unavailable !== undefined;
                  return (
                    <button
                      key={command.id}
                      type="button"
                      data-at={here}
                      onMouseEnter={() => setAt(index)}
                      onClick={() => run(command)}
                      // 44px minimum: these are the primary touch targets on a
                      // phone now that the sheet is gone, and the design system
                      // sets that floor for exactly this reason.
                      className="flex min-h-[44px] w-full items-center gap-[12px] px-[16px] py-[9px] text-left"
                      style={{
                        background: here ? "var(--onsen-color-red-bg)" : "transparent",
                        borderLeft: `2px solid ${here ? "var(--onsen-color-red)" : "transparent"}`,
                        opacity: blocked ? 0.5 : 1,
                      }}
                    >
                      <span
                        className="chrome min-w-0 flex-1 truncate text-[12.5px]"
                        style={{ color: here ? "var(--onsen-color-text)" : "var(--onsen-color-text-label)" }}
                      >
                        {command.title}
                      </span>
                      {/* The reason, where there is one — §7's rule that an
                          unavailable action still says why. */}
                      <span className="chrome flex-none text-[9.5px] text-ink-dim">
                        {blocked ? command.unavailable : (command.hint ?? "")}
                      </span>
                      {command.key === undefined || blocked ? null : (
                        <span className="chrome flex-none border border-border-quiet px-[5px] text-[8.5px] text-ink-dim uppercase">
                          {command.key}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex flex-none items-center gap-[16px] border-t border-rule px-[16px] py-[9px]">
          <span className="chrome text-[8.5px] tracking-[0.12em] text-ink-dim uppercase">
            {strings.chat.paletteHintMove}
          </span>
          <span className="chrome text-[8.5px] tracking-[0.12em] text-ink-dim uppercase">
            {strings.chat.paletteHintRun}
          </span>
          <span className="chrome text-[8.5px] tracking-[0.12em] text-ink-dim uppercase">
            {strings.chat.paletteHintClose}
          </span>
        </div>
      </div>
    </div>
  );
}
