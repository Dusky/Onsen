import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A row that scrolls sideways and says so.
 *
 * Written for the phone's Settings category row, where ten categories sit in
 * 390px: four are visible and six are off the right-hand edge with nothing
 * hinting they exist. A reader who does not think to swipe a row that looks
 * complete simply cannot reach Automation or Connections out.
 *
 * The affordance is a fade at whichever edge still has something past it —
 * measured, so it is never a fade over nothing, and gone entirely once the row
 * fits. A fade rather than arrows because arrows are controls, and this is not
 * a control: it is the row admitting it has been cut off. It costs no width,
 * which is the whole problem being solved.
 *
 * `mask-image` rather than a gradient overlay, so it works on any ground —
 * the row sits on `bg-raised` here and on `bg` elsewhere, and an overlay would
 * have to know which.
 */
export function Scroller({
  children,
  className = "",
  /** Re-measure when this changes — the row's contents are not observable. */
  watch,
}: {
  children: ReactNode;
  className?: string;
  watch?: unknown;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const node = box.current;
    if (node === null) return;
    const measure = () => {
      const past = node.scrollWidth - node.clientWidth;
      // A pixel of slack: fractional layout widths otherwise leave a fade
      // showing on a row that has nothing past it.
      setEdges({ left: node.scrollLeft > 1, right: node.scrollLeft < past - 1 });
    };
    measure();
    node.addEventListener("scroll", measure, { passive: true });
    const watcher = new ResizeObserver(measure);
    watcher.observe(node);
    return () => {
      node.removeEventListener("scroll", measure);
      watcher.disconnect();
    };
  }, [watch]);

  const fade = "transparent 0, #000 22px";
  const mask =
    edges.left && edges.right
      ? `linear-gradient(to right, ${fade}, #000 calc(100% - 22px), transparent 100%)`
      : edges.right
        ? "linear-gradient(to right, #000 calc(100% - 22px), transparent 100%)"
        : edges.left
          ? `linear-gradient(to right, ${fade})`
          : undefined;

  return (
    <div
      ref={box}
      className={`overflow-x-auto ${className}`}
      style={mask === undefined ? undefined : { maskImage: mask, WebkitMaskImage: mask }}
    >
      {children}
    </div>
  );
}
