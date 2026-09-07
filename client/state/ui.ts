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
  /** The chat's scene-scoped panes, set while a scene is open. */
  sceneInspector: ReactNode | null;
  toggleLeftRail(): void;
  toggleRightRail(): void;
  setLeftSection(section: UiState["leftSection"]): void;
  setSceneInspector(node: ReactNode | null): void;
}

export const useUiStore = create<UiState>((set) => ({
  leftRailOpen: true,
  rightRailOpen: true,
  leftSection: "prompt",
  sceneInspector: null,
  toggleLeftRail: () => set((state) => ({ leftRailOpen: !state.leftRailOpen })),
  toggleRightRail: () => set((state) => ({ rightRailOpen: !state.rightRailOpen })),
  setLeftSection: (section) => set({ leftSection: section }),
  setSceneInspector: (node) => set({ sceneInspector: node }),
}));
