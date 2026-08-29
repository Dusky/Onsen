import { create } from "zustand";

/**
 * Generation state, deliberately global rather than per-screen.
 *
 * The design handoff is explicit about this: the "still writing" strip has to
 * appear on any screen that is not the generating scene's own chat, so the
 * state cannot live inside the chat screen. It is also why the buffer lives
 * here — a user who navigates away and back must see the text that arrived
 * while they were gone, and the server is streaming it whether anyone is
 * watching or not.
 *
 * In memory only. No localStorage anywhere in this app (HANDOFF 8).
 */

export interface ActiveGeneration {
  generationId: string;
  sceneId: string;
  /** Scene title, so the cross-screen strip can name where it is happening. */
  sceneTitle: string;
  /** Who is speaking, for the streaming row. */
  speaker: string;
  /**
   * Set when this generation replaces one part of a beat rather than adding a
   * message (SPEC §7). The text belongs inside that message, so the log renders
   * it in place instead of as a new turn arriving at the bottom.
   */
  recast?: { messageId: string; ordinal: number };
  /** Everything received so far. */
  text: string;
  /** Characters received; what a reconnect resumes from. */
  offset: number;
  status: "connecting" | "streaming" | "done" | "cancelled" | "error";
  error: string | null;
}

interface GenerationStore {
  active: ActiveGeneration | null;
  begin(generation: Omit<ActiveGeneration, "text" | "offset" | "status" | "error">): void;
  /** Append a chunk, ignoring anything already received (§5 replay is idempotent). */
  appendAt(generationId: string, offset: number, text: string): void;
  settle(generationId: string, status: ActiveGeneration["status"], error?: string | null): void;
  clear(): void;
}

export const useGenerationStore = create<GenerationStore>((set) => ({
  active: null,

  begin(generation) {
    set({ active: { ...generation, text: "", offset: 0, status: "connecting", error: null } });
  },

  appendAt(generationId, offset, text) {
    set((state) => {
      const active = state.active;
      if (active === null || active.generationId !== generationId) return state;
      // A replayed chunk can overlap what is already held — reconnecting asks
      // from an offset the server may round differently. Splicing by offset
      // makes the update idempotent rather than duplicating text.
      const next = active.text.slice(0, offset) + text;
      return { active: { ...active, text: next, offset: next.length, status: "streaming" } };
    });
  },

  settle(generationId, status, error = null) {
    set((state) => {
      const active = state.active;
      if (active === null || active.generationId !== generationId) return state;
      return { active: { ...active, status, error } };
    });
  },

  clear() {
    set({ active: null });
  },
}));
