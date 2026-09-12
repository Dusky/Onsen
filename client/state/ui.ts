import { create } from "zustand";
import type { ReactNode } from "react";
import type { DockPanel } from "@shared/types.ts";

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
  /**
   * Which panel each side's own panel currently shows (§20 phase 89, widened
   * to any of the seven dockable panels by phase 173's rail dock rework).
   * Not necessarily one this side actually hosts right now — a panel moved to
   * the other side, or hidden, leaves its old side remembering an id it no
   * longer has; `RailDock` clamps to the first panel it does have whenever
   * the remembered one is not among them.
   */
  leftActive: DockPanel;
  rightActive: DockPanel;
  /** The chat's scene-scoped panes, set while a scene is open. */
  sceneInspector: ReactNode | null;
  /**
   * The off-script exchange, set while a scene is open (§20 phase 177).
   *
   * A second slot rather than a component, for `sceneInspector`'s own reason:
   * the channel needs the scene's live messages and the streaming answer, and
   * the rail lives at the shell level on every page. On a phone it stays the
   * bottom sheet and this is null.
   */
  oocPanel: ReactNode | null;
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
  setLeftActive(panel: DockPanel): void;
  setRightActive(panel: DockPanel): void;
  setSceneInspector(node: ReactNode | null): void;
  setOocPanel(node: ReactNode | null): void;
  toggleVanished(): void;
}

export const useUiStore = create<UiState>((set) => ({
  leftRailOpen: true,
  rightRailOpen: true,
  leftActive: "prompt",
  rightActive: "scene",
  sceneInspector: null,
  oocPanel: null,
  vanished: false,
  toggleLeftRail: () => set((state) => ({ leftRailOpen: !state.leftRailOpen })),
  toggleRightRail: () => set((state) => ({ rightRailOpen: !state.rightRailOpen })),
  setLeftRailOpen: (open) => set({ leftRailOpen: open }),
  setRightRailOpen: (open) => set({ rightRailOpen: open }),
  setLeftActive: (panel) => set({ leftActive: panel }),
  setRightActive: (panel) => set({ rightActive: panel }),
  setSceneInspector: (node) => set({ sceneInspector: node }),
  setOocPanel: (node) => set({ oocPanel: node }),
  toggleVanished: () => set((state) => ({ vanished: !state.vanished })),
}));
