import { useRef } from "react";
import { strings } from "../strings.ts";
import { useModalFocus } from "../lib/modal.ts";

/**
 * A full-size picture over a dimmed page (§20 phase 187).
 *
 * The portrait in a turn's masthead is a 40px thumbnail; this is its full
 * size, the same file the masthead draws from, shown as large as the viewport
 * allows. Click anywhere to close — the picture is the point, and the close
 * button is the keyboard and screen-reader way in.
 */
export function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDivElement | null>(null);
  useModalFocus(dialog, onClose);

  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      tabIndex={-1}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0, 0, 0, 0.86)" }}
    >
      <button
        type="button"
        aria-label={strings.common.close}
        onClick={onClose}
        className="chrome absolute top-[14px] right-[14px] flex h-[44px] w-[44px] items-center justify-center text-[24px] text-ink-dim hover:text-ink-label"
      >
        {"\u00d7"}
      </button>
      <img
        src={src}
        alt={alt}
        // The picture does not close the lightbox on click — only the backdrop
        // and the button do — so a reader can still zoom the browser without
        // dismissing the thing they are looking at.
        onClick={(event) => event.stopPropagation()}
        className="max-h-full max-w-full object-contain"
      />
    </div>
  );
}
