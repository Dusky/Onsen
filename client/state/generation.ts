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

/** What the turn director settled on, once it has (SPEC §6). */
export interface DirectorDecision {
  characterId: string | null;
  name: string;
  reason: string;
  source: "user" | "director";
  scope: "spotlight" | "beat";
}

export interface ActiveGeneration {
  generationId: string;
  sceneId: string;
  /** Scene title, so the cross-screen strip can name where it is happening. */
  sceneTitle: string;
  /**
   * Who is speaking, for the streaming row. Null until the director has said —
   * with the classifier that is a model call, so for a moment the honest answer
   * is that nobody knows yet.
   */
  speaker: string | null;
  /** The director's decision and its reason, once it arrives. */
  director: DirectorDecision | null;
  /**
   * Set when this generation replaces one part of a beat rather than adding a
   * message (SPEC §7). The text belongs inside that message, so the log renders
   * it in place instead of as a new turn arriving at the bottom.
   */
  recast?: { messageId: string; ordinal: number };
  /** Everything received so far. */
  text: string;
  /**
   * The model's own reasoning for this turn (SPEC §13), kept apart from the
   * prose all the way through. Replayed whole on a reconnect rather than by
   * offset, so this is replaced rather than spliced.
   */
  reasoning: string;
  /** Characters received; what a reconnect resumes from. */
  offset: number;
  status: "connecting" | "streaming" | "done" | "cancelled" | "error";
  error: string | null;
}

interface GenerationStore {
  active: ActiveGeneration | null;
  /** Why the last attempt to *start* a generation failed, before anything
   * streamed — a rejected POST, not a stream that died. The chat screen shows
   * it as a strip rather than leaving it to the console. */
  startError: { message: string; code: string } | null;
  begin(
    generation: Omit<
      ActiveGeneration,
      "text" | "offset" | "status" | "error" | "director" | "reasoning"
    >,
  ): void;
  /** The turn director's answer, which arrives on the stream. */
  direct(generationId: string, decision: DirectorDecision): void;
  /** Append a chunk, ignoring anything already received (§5 replay is idempotent). */
  appendAt(generationId: string, offset: number, text: string): void;
  /**
   * Reasoning, which arrives as deltas live and as the whole block on a
   * reconnect. Appending a replayed block would double it, so a delta that the
   * buffer already ends with is a replay and replaces rather than extends.
   */
  appendReasoning(generationId: string, text: string): void;
  settle(generationId: string, status: ActiveGeneration["status"], error?: string | null): void;
  failStart(error: { message: string; code: string }): void;
  clearStartError(): void;
  clear(): void;
}

export const useGenerationStore = create<GenerationStore>((set) => ({
  active: null,
  startError: null,

  failStart(error: { message: string; code: string }) {
    set({ startError: error });
  },

  clearStartError() {
    set({ startError: null });
  },

  begin(generation) {
    set({
      startError: null,
      active: {
        ...generation,
        director: null,
        text: "",
        reasoning: "",
        offset: 0,
        status: "connecting",
        error: null,
      },
    });
  },

  direct(generationId, decision) {
    set((state) => {
      const active = state.active;
      if (active === null || active.generationId !== generationId) return state;
      // The decision also names the speaker, which until now was a guess or
      // nothing at all.
      return { active: { ...active, director: decision, speaker: decision.name } };
    });
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

  appendReasoning(generationId, text) {
    set((state) => {
      const active = state.active;
      if (active === null || active.generationId !== generationId) return state;
      // A reconnect replays everything at once. If what arrived already starts
      // with what is held, it is that replay and not a delta.
      const next = text.startsWith(active.reasoning) ? text : active.reasoning + text;
      return { active: { ...active, reasoning: next } };
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
    set({ active: null, startError: null });
  },
}));
