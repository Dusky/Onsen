import { useEffect, useState } from "react";
import type { MessageDto } from "@shared/types.ts";
import { COMMANDS } from "../../lib/commands.ts";

/**
 * The keyboard surface of the chat screen (SPEC §20 phase 43, §149): ⌘K, j/k
 * log walking, Escape, and the single-key accelerators, plus the palette's open
 * state and its `/`-seeded query. Extracted whole; `runCommand` stays on the
 * screen, because it is the dispatch hub every surface funnels through.
 */
export function useCommandKeys(opts: {
  messages: MessageDto[];
  selectedId: string | null;
  setSelectedId(id: string | null): void;
  runCommand(id: string, turn: MessageDto | null): void;
}): {
  paletteOpen: boolean;
  setPaletteOpen(open: boolean): void;
  paletteSeed: string;
  setPaletteSeed(seed: string): void;
} {
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Text after the `/` when the composer opened the palette (§20 phase 130).
  const [paletteSeed, setPaletteSeed] = useState("");

  /**
   * ⌘K anywhere in a roleplay.
   *
   * Ignored while a field has focus so it cannot eat a keystroke someone meant
   * for the composer, and registered once for the screen rather than per turn.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Never steal a keystroke meant for a field, and never fight a modifier
      // combination the browser or the OS owns.
      const inField = document.activeElement?.matches("input, textarea, [contenteditable]");
      if (inField === true) return;

      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      // j/k walk the log, the way every reader-shaped tool does. Down is
      // towards the newest turn, because that is the direction a scene runs.
      if (event.key === "j" || event.key === "k") {
        const ids = opts.messages.map((message) => message.id);
        if (ids.length === 0) return;
        event.preventDefault();
        const at = opts.selectedId === null ? -1 : ids.indexOf(opts.selectedId);
        const next =
          event.key === "j"
            ? Math.min(ids.length - 1, at + 1)
            : Math.max(0, at === -1 ? ids.length - 1 : at - 1);
        opts.setSelectedId(ids[next] ?? null);
        document
          .querySelector(`[data-message-id="${ids[next]}"]`)
          ?.scrollIntoView({ block: "nearest" });
        return;
      }

      if (event.key === "Escape") {
        opts.setSelectedId(null);
        return;
      }

      // Single-key accelerators, only with a turn selected — which is what
      // makes them safe: there is nothing to act on until the reader picks one.
      if (opts.selectedId === null) return;
      const command = COMMANDS.find(
        (candidate) => candidate.key === event.key && candidate.unavailable === undefined,
      );
      if (command === undefined) return;
      const turn = opts.messages.find((message) => message.id === opts.selectedId);
      if (turn === undefined) return;
      event.preventDefault();
      opts.runCommand(command.id, turn);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Re-registered when the log or the selection moves, so a stale closure
    // never walks an old list.
  }, [opts.messages, opts.selectedId, opts.runCommand]);

  return { paletteOpen, setPaletteOpen, paletteSeed, setPaletteSeed };
}
