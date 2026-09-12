import { create } from "zustand";
import type { ReactNode } from "react";

/**
 * UI chrome state (SPEC §16, §20 phases 85–87).
 *
 * In memory only, like the generation store — no browser storage anywhere in
 * this app. The two rails' open/closed state is chrome, not data. The scene
 * inspector is a slot: the chat screen fills it with the scene-scoped panes
 * (Context / Cast / You), so the rail itself can live at the shell level on
 * every page while the scene content stays where the scene is.
 */

interface UiState {
  leftRailOpen: boolean;
  rightRailOpen: boolean;
  /** Which section the left rail's panel shows (§20 phase 89). */
  leftSection: "prompt" | "preset" | "lore" | "guides";
  /** Which tab the right rail's panel shows (§20 phase 90). */
  rightTab: "scene" | "characters" | "authors";
  /** The chat's scene-scoped panes, set while a scene is open. */
  sceneInspector: ReactNode | null;
  /**
   * Vanish mode (§20 phase 170): both rails and the header/top bar gone,
   * down to bare log. A reading posture, not a preference — it resets on
   * reload the same way the rails' own open/closed state already does,
   * rather than becoming the one thing in this store that persists.
   */
  vanished: boolean;
  toggleLeftRail(): void;
  toggleRightRail(): void;
  /** Set directly rather than toggled — the auto-collapse bands (breakpoint.ts,
   * design review fix 6) force a rail open or shut when the window crosses a
   * width boundary, rather than flipping whatever it currently is. */
  setLeftRailOpen(open: boolean): void;
  setRightRailOpen(open: boolean): void;
  setLeftSection(section: UiState["leftSection"]): void;
  setRightTab(tab: UiState["rightTab"]): void;
  setSceneInspector(node: ReactNode | null): void;
  toggleVanished(): void;
}

export const useUiStore = create<UiState>((set) => ({
  leftRailOpen: true,
  rightRailOpen: true,
  leftSection: "prompt",
  rightTab: "scene",
  sceneInspector: null,
  vanished: false,
  toggleLeftRail: () => set((state) => ({ leftRailOpen: !state.leftRailOpen })),
  toggleRightRail: () => set((state) => ({ rightRailOpen: !state.rightRailOpen })),
  setLeftRailOpen: (open) => set({ leftRailOpen: open }),
  setRightRailOpen: (open) => set({ rightRailOpen: open }),
  setLeftSection: (section) => set({ leftSection: section }),
  setRightTab: (tab) => set({ rightTab: tab }),
  setSceneInspector: (node) => set({ sceneInspector: node }),
  toggleVanished: () => set((state) => ({ vanished: !state.vanished })),
}));
