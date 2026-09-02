import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

/**
 * The virtualized message log (DESIGN §415, phase 31 completion).
 *
 * Only engaged past a message-count threshold — below it, the plain render
 * keeps the exact behaviour the reader has been using. Above it, the messages
 * become absolutely-positioned rows measured with a ResizeObserver, and the
 * live tail (the turn being written, the stop strip) stays outside the
 * virtualized area, in normal flow, so a streamed turn growing mid-sentence
 * does not fight the virtualizer.
 *
 * Scrolling to the bottom is *not* this component's job — the screen's own
 * effect sets `scrollTop = scrollHeight` on new content, exactly as it always
 * has, and the virtualizer only has to keep `scrollHeight` honest.
 */

export function VirtualizedLog({
  scrollRef,
  count,
  renderRow,
  tail,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  count: number;
  renderRow(index: number): ReactNode;
  tail: ReactNode;
}) {
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 180,
    overscan: 8,
  });

  // A new message lands at the bottom, and the reader should be taken to it —
  // the same unconditional follow the plain path has always had. scrollToIndex
  // is the virtualizer's own anchor, so a row measured taller than the estimate
  // settles onto the real bottom instead of leaving a gap.
  const lastCount = useRef(count);
  useEffect(() => {
    if (count !== lastCount.current) {
      lastCount.current = count;
      if (count > 0) virtualizer.scrollToIndex(count - 1, { align: "end" });
    }
  }, [count, virtualizer]);

  return (
    <div className="mx-auto w-full max-w-[var(--onsen-prose-measure)]">
      <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
        {virtualizer.getVirtualItems().map((item) => (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${item.start}px)`,
              // The plain path separates turns with a 26px flex gap; a
              // positioned row has no gap, so the row carries it below itself.
              paddingBottom: "26px",
            }}
          >
            {renderRow(item.index)}
          </div>
        ))}
      </div>
      {/* The live tail, in normal flow so it can grow without a re-measure. */}
      {tail}
    </div>
  );
}
