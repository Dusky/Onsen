import { useEffect } from "react";
import type { NoticePosition } from "@shared/types.ts";
import { NOTICE_MS, useNoticeStore } from "../state/notices.ts";
import { strings } from "../strings.ts";

/**
 * The one place the app says what it has to say (§20 phase 167).
 *
 * Mounted once, at the shell, above every screen. Two live regions rather than
 * one, because the two tones are genuinely different announcements: a
 * completed task is `role="status"` with `aria-live="polite"` and waits for the
 * reader's next pause, while a failure is `role="alert"` and interrupts. One
 * region switching its politeness would not work — a live region's politeness
 * is read when the region is created, not when its contents change.
 *
 * Both regions are always in the DOM and always empty-or-not rather than
 * mounted on demand, for the same reason: a region that appears at the moment
 * it has something to say is a region assistive technology has not been
 * watching, and the first notice is silently lost.
 *
 * It does not trap focus and takes none. A notice is the app reporting, not
 * asking; the dismiss button is reachable by Tab in document order and nothing
 * is stolen from whatever the reader was doing.
 */

/**
 * Where each position sits.
 *
 * Fixed to the viewport rather than to a screen's layout, because the shell is
 * the only thing mounted on every route and the notices belong to the app
 * rather than to any one page. `top` centres in the top half only — the
 * bottom-centre the incumbent offers would sit on the composer, which is the
 * one place in this app that must never be covered.
 *
 * The 52px clears the app's own chrome on both layouts — the desktop header
 * and the phone's top bar are each around 44px. At 12px a notice sat on the
 * wordmark and the text-size controls, and since a failure has no deadline it
 * sat there until it was dismissed. Found by looking at it.
 */
const PLACES: Record<NoticePosition, string> = {
  top: "top-[52px] left-1/2 -translate-x-1/2 items-center",
  topRight: "top-[52px] right-[12px] items-end",
  bottomRight: "bottom-[12px] right-[12px] items-end",
};

export function NoticeRegion({ position }: { position: NoticePosition }) {
  const notices = useNoticeStore((state) => state.notices);
  const dismiss = useNoticeStore((state) => state.dismiss);
  const sweep = useNoticeStore((state) => state.sweep);

  /*
   * One timer for the whole queue, armed only while something can expire.
   *
   * A timeout per notice would mean a timer per component render and a
   * cancellation path per notice; the queue is at most four long, so a single
   * sweep at the nearest deadline is both simpler and exactly as accurate.
   */
  const nextDeadline = notices.reduce<number | null>(
    (soonest, notice) =>
      notice.until === null ? soonest : soonest === null ? notice.until : Math.min(soonest, notice.until),
    null,
  );
  useEffect(() => {
    if (nextDeadline === null) return;
    const timer = setTimeout(() => sweep(Date.now()), Math.max(16, nextDeadline - Date.now()));
    return () => clearTimeout(timer);
  }, [nextDeadline, sweep]);

  const done = notices.filter((notice) => notice.tone === "done");
  const failed = notices.filter((notice) => notice.tone === "failed");

  return (
    <div
      // `pointer-events-none` on the stack and back on for each notice, so an
      // empty region is not an invisible sheet over the app — which is exactly
      // what a fixed full-width container would otherwise be.
      className={`pointer-events-none fixed z-50 flex max-w-[min(420px,calc(100vw-24px))] flex-col gap-[8px] ${PLACES[position]}`}
    >
      {/* Both regions stay mounted and stay empty when there is nothing to
          say. The politeness is fixed per region, which is why there are two. */}
      <div role="status" aria-live="polite" className="contents">
        {done.map((notice) => (
          <Strip key={notice.id} text={notice.text} onDismiss={() => dismiss(notice.id)} />
        ))}
      </div>
      <div role="alert" aria-live="assertive" className="contents">
        {failed.map((notice) => (
          <Strip key={notice.id} text={notice.text} failed onDismiss={() => dismiss(notice.id)} />
        ))}
      </div>
    </div>
  );
}

/**
 * One notice. A hairline strip, the way `Notice.tsx` draws an error — no
 * shadow, no modal, nothing that interrupts (SPEC §16).
 *
 * The whole strip is the dismiss button. A 44px × 44px `×` beside four words
 * would be wider than the words, and there is nothing else a notice can be
 * clicked for.
 */
function Strip({
  text,
  failed,
  onDismiss,
}: {
  text: string;
  failed?: boolean;
  onDismiss(): void;
}) {
  return (
    <button
      type="button"
      onClick={onDismiss}
      aria-label={`${text} — ${strings.notices.dismiss}`}
      className={`tap pointer-events-auto chrome border px-[11px] py-[9px] text-left text-[13.5px] leading-[1.5] ${
        failed === true
          ? "border-red-border bg-red-bg text-red-text"
          : "border-rule bg-bg-raised text-ink-label"
      }`}
      style={{ borderRadius: "var(--onsen-radius)" }}
    >
      {text}
    </button>
  );
}
