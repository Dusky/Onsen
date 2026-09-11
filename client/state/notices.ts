import { create } from "zustand";

/**
 * What the app has to say, said once (§20 phase 167).
 *
 * Until this, nothing in the client had an `aria-live` region or a
 * `role="status"` — not one, anywhere. Every async outcome surfaced as inline
 * text in whichever component happened to own the request, which works for a
 * rejected field and fails completely for everything else: a background task
 * that finished, an export that was written, a pack that installed. Those have
 * no field to sit under, so several of them said nothing at all, and none of
 * them were ever announced to a screen reader.
 *
 * So this is one primitive, not a per-caller variant — the lesson `Scroller`
 * and `useModalFocus` both came out of. Anything transient posts here; a
 * genuinely inline error (this field is wrong, this pattern will not compile)
 * stays where it is, next to the thing it is about.
 *
 * In memory only, like every other store in this app.
 */

/** What a notice is, which decides how loudly it is announced. */
export type NoticeTone =
  /** Something finished. Announced politely, at the reader's next pause. */
  | "done"
  /** Something failed. Announced immediately, and takes the red pencil. */
  | "failed";

export interface Notice {
  id: number;
  tone: NoticeTone;
  text: string;
  /**
   * When it stops being shown. A failure has no deadline: an error that
   * removed itself before it was read is an error that never happened, and
   * "why did that not work" is precisely the question a reader comes back to.
   */
  until: number | null;
}

/** How long a success stays up. Long enough to read twice. */
export const NOTICE_MS = 5_000;

interface NoticeState {
  notices: Notice[];
  post(tone: NoticeTone, text: string): void;
  dismiss(id: number): void;
  /** Drop whatever has expired. Driven by the region, which owns the timer. */
  sweep(now: number): void;
}

let nextId = 1;

export const useNoticeStore = create<NoticeState>((set) => ({
  notices: [],
  post: (tone, text) =>
    set((state) => {
      const trimmed = text.trim();
      if (trimmed === "") return state;
      /*
       * The same thing said twice is said once.
       *
       * Two identical notices are a retry, a double-click, or two components
       * reporting one failure — never two facts. Refreshing the deadline
       * rather than stacking them keeps a screen reader from reading the same
       * sentence twice, which is the failure mode an unfiltered live region
       * is famous for.
       */
      const existing = state.notices.find(
        (notice) => notice.text === trimmed && notice.tone === tone,
      );
      if (existing !== undefined) {
        return {
          notices: state.notices.map((notice) =>
            notice.id === existing.id
              ? { ...notice, until: tone === "failed" ? null : Date.now() + NOTICE_MS }
              : notice,
          ),
        };
      }
      return {
        notices: [
          ...state.notices,
          {
            id: nextId++,
            tone,
            text: trimmed,
            until: tone === "failed" ? null : Date.now() + NOTICE_MS,
          },
        ].slice(-4),
      };
    }),
  dismiss: (id) => set((state) => ({ notices: state.notices.filter((n) => n.id !== id) })),
  sweep: (now) =>
    set((state) => {
      const kept = state.notices.filter((notice) => notice.until === null || notice.until > now);
      return kept.length === state.notices.length ? state : { notices: kept };
    }),
}));

/**
 * Posting from outside React — a mutation's `onError`, a fetch in a lib.
 *
 * The store's own setter, reached without a hook, the way `client/lib/api.ts`
 * and the generation store already reach theirs. It is the same store: a
 * notice posted from a callback and one posted from a component are one queue.
 */
export function notify(tone: NoticeTone, text: string): void {
  useNoticeStore.getState().post(tone, text);
}
