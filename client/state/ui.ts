import { create } from "zustand";

/**
 * UI chrome state (SPEC §16, §20 phase 85).
 *
 * In memory only, like the generation store — no browser storage anywhere in
 * this app. The two rails' open/closed state is chrome, not data, so it lives
 * here rather than on the server.
 */

interface UiState {
  leftRailOpen: boolean;
  rightRailOpen: boolean;
  toggleLeftRail(): void;
  toggleRightRail(): void;
}

export const useUiStore = create<UiState>((set) => ({
  leftRailOpen: true,
  rightRailOpen: true,
  toggleLeftRail: () => set((state) => ({ leftRailOpen: !state.leftRailOpen })),
  toggleRightRail: () => set((state) => ({ rightRailOpen: !state.rightRailOpen })),
}));
