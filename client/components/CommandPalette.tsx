import { useEffect, useMemo, useRef, useState } from "react";
import { strings } from "../strings.ts";
import { GROUP_ORDER, matchCommands, type Command, type CommandGroup } from "../lib/commands.ts";
import { useModalFocus } from "../lib/modal.ts";

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
  initialQuery = "",
  onRun,
  onClose,
}: {
  hasScene: boolean;
  /** Null when no turn is selected — which hides every turn-scoped command. */
  selectedSpeaker: string | null;
  /** Text after the `/` when the composer opened this (§20 phase 130). */
  initialQuery?: string;
  onRun(id: string): void;
  onClose(): void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [at, setAt] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const dialog = useRef<HTMLDivElement | null>(null);

  // The same modal keyboard contract `Sheet` gets. Before this the palette's
  // Escape was on the search input, and Tab walked out of the palette into the
  // log behind it — every command row is a real button, so there was a long
  // way to walk.
  useModalFocus(dialog, onClose);

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
      // `items-start` for the same reason `SheetShell` needs it: a row flex
      // stretches its children on the cross axis, so the panel's `max-h-[70vh]`
      // was acting as a fixed height — filtered down to one command, the
      // palette still measured 665px of a 950px window, almost all of it
      // empty. It hugs its rows now.
      className="fixed inset-0 z-50 flex items-start justify-center px-[16px] pt-[64px]"
      style={{ background: "rgba(12, 10, 8, 0.62)" }}
      onClick={onClose}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={strings.chat.paletteOpen}
        // Focusable only by script, so the palette can hold focus itself —
        // and so the arrow keys below work wherever focus is inside it.
        tabIndex={-1}
        className="flex max-h-[70vh] w-full max-w-[620px] flex-col border"
        style={{ background: "var(--onsen-color-bg-raised)", borderColor: "var(--onsen-color-rule-strong)" }}
        onClick={(event) => event.stopPropagation()}
        // On the dialog rather than the search box (which is where all of this
        // used to be): Tab moves focus to a command row, and the arrows have
        // to keep working when it does.
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setAt((n) => Math.min(matches.length - 1, n + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setAt((n) => Math.max(0, n - 1));
          } else if (event.key === "Enter") {
            // A focused command row runs itself on Enter; anywhere else in the
            // palette, Enter runs whatever the cursor is on.
            if (event.target instanceof HTMLButtonElement) return;
            event.preventDefault();
            const command = matches[at];
            if (command !== undefined) run(command);
          }
        }}
      >
        <div className="hairline flex flex-none items-center gap-[11px] px-[16px] py-[13px]">
          <span className="chrome text-[13px] text-ink-dim">&rsaquo;</span>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={strings.chat.palettePlaceholder}
            aria-label={strings.chat.palettePlaceholder}
            // The suppressed outline is gone: this box was the app's only
            // override of the global `:focus-visible` ring, and it replaced it
            // with nothing. The field now says where typing goes the same way
            // every other field in the app does.
            className="chrome min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder:text-ink-dim"
          />
          {/* What the turn commands will act on. Without this the palette is
              ambiguous the moment more than one turn is on screen. Blue,
              matching the selected turn's own gutter in the log (design
              review fix 1, follow-up sweep) — a selection, not a live state. */}
          {selectedSpeaker === null ? null : (
            <span
              className="chrome flex-none text-[12px]"
              style={{ color: "var(--onsen-color-blue)" }}
            >
              {strings.chat.paletteScope(selectedSpeaker)}
            </span>
          )}
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
          {matches.length === 0 ? (
            <p className="chrome px-[16px] py-[18px] text-[13.5px] text-ink-dim">
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
                      // The keyboard's own position is a selection, the same
                      // role the focus ring and the selected-turn gutter
                      // draw in blue (design review fix 1, follow-up sweep).
                      style={{
                        background: here ? "var(--onsen-color-blue-bg)" : "transparent",
                        borderLeft: `2px solid ${here ? "var(--onsen-color-blue)" : "transparent"}`,
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
                      <span className="chrome flex-none text-[13px] text-ink-dim">
                        {blocked ? command.unavailable : (command.hint ?? "")}
                      </span>
                      {command.key === undefined || blocked ? null : (
                        <span className="chrome flex-none border border-border-quiet px-[5px] text-[12px] text-ink-dim">
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
          <span className="chrome text-[12px] text-ink-dim">
            {strings.chat.paletteHintMove}
          </span>
          <span className="chrome text-[12px] text-ink-dim">
            {strings.chat.paletteHintRun}
          </span>
          <span className="chrome text-[12px] text-ink-dim">
            {strings.chat.paletteHintClose}
          </span>
        </div>
      </div>
    </div>
  );
}
