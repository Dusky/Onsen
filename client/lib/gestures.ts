import {
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

/**
 * Horizontal swipes and long-presses inside a vertically scrolling list.
 *
 * The design handoff's requirement, in its own words: direction locking must
 * feel certain, not fussy. Lock to an axis early — about ten pixels of travel —
 * and commit; do not re-evaluate mid-gesture. Once horizontal is locked,
 * suppress vertical scrolling for that pointer entirely.
 *
 * Written against pointer events rather than touch events so a trackpad and a
 * stylus behave the same as a thumb, and so `setPointerCapture` can keep the
 * gesture attached to the element the finger started on.
 */

/** Travel before an axis is chosen. Small enough to feel immediate. */
const LOCK_THRESHOLD_PX = 10;
/** Travel before a horizontal swipe counts as a swipe rather than a tap. */
const COMMIT_THRESHOLD_PX = 56;
/** How long a press has to be held to be a long-press. */
const LONG_PRESS_MS = 480;
/** How far a finger may drift and still be a long-press. */
const LONG_PRESS_SLOP_PX = 10;

export interface SwipeHandlers {
  onSwipeLeft?: (() => void) | undefined;
  onSwipeRight?: (() => void) | undefined;
  onLongPress?: (() => void) | undefined;
}

interface GestureState {
  pointerId: number;
  startX: number;
  startY: number;
  axis: "undecided" | "horizontal" | "vertical";
  longPressTimer: ReturnType<typeof setTimeout> | null;
  longPressFired: boolean;
}

export interface SwipeBindings {
  onPointerDown(event: ReactPointerEvent): void;
  onPointerMove(event: ReactPointerEvent): void;
  onPointerUp(event: ReactPointerEvent): void;
  onPointerCancel(event: ReactPointerEvent): void;
  onContextMenu(event: ReactMouseEvent): void;
  style: { touchAction: "pan-y" };
}

export function useSwipe(handlers: SwipeHandlers): SwipeBindings {
  const state = useRef<GestureState | null>(null);

  const clearLongPress = () => {
    const current = state.current;
    if (current?.longPressTimer != null) {
      clearTimeout(current.longPressTimer);
      current.longPressTimer = null;
    }
  };

  const end = () => {
    clearLongPress();
    state.current = null;
  };

  return {
    // pan-y tells the browser this element may scroll vertically but never
    // horizontally, so a horizontal drag is ours without a preventDefault race.
    style: { touchAction: "pan-y" },

    onPointerDown(event) {
      // Ignore a second finger: a pinch is not a swipe.
      if (state.current !== null) return;
      const timer =
        handlers.onLongPress === undefined
          ? null
          : setTimeout(() => {
              const current = state.current;
              if (current === null || current.axis === "horizontal") return;
              current.longPressFired = true;
              handlers.onLongPress?.();
            }, LONG_PRESS_MS);

      state.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        axis: "undecided",
        longPressTimer: timer,
        longPressFired: false,
      };
    },

    onPointerMove(event) {
      const current = state.current;
      if (current === null || current.pointerId !== event.pointerId) return;

      const dx = event.clientX - current.startX;
      const dy = event.clientY - current.startY;

      // Any real movement rules out a long-press.
      if (Math.abs(dx) > LONG_PRESS_SLOP_PX || Math.abs(dy) > LONG_PRESS_SLOP_PX) {
        clearLongPress();
      }

      if (current.axis === "undecided") {
        const travel = Math.max(Math.abs(dx), Math.abs(dy));
        if (travel < LOCK_THRESHOLD_PX) return;
        // Decide once and commit. Re-evaluating mid-gesture is what makes a
        // swipe feel like it is arguing with the scroll container.
        current.axis = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
        if (current.axis === "horizontal") {
          (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
        }
      }
    },

    onPointerUp(event) {
      const current = state.current;
      if (current === null || current.pointerId !== event.pointerId) return;

      const dx = event.clientX - current.startX;
      if (current.axis === "horizontal" && Math.abs(dx) >= COMMIT_THRESHOLD_PX) {
        // Opposite directions by design: left rerolls, right opens the
        // carousel of alternate versions.
        if (dx < 0) handlers.onSwipeLeft?.();
        else handlers.onSwipeRight?.();
      }
      end();
    },

    onPointerCancel() {
      end();
    },

    onContextMenu(event: ReactMouseEvent) {
      // A long-press on touch also raises the platform context menu; the action
      // sheet is the app's answer, so suppress the browser's.
      if (state.current?.longPressFired === true || handlers.onLongPress !== undefined) {
        event.preventDefault();
      }
    },
  };
}
