import { strings } from "../strings.ts";
import { Sheet } from "./Sheet.tsx";

/**
 * A full-size portrait in a sheet (§20 phase 187).
 *
 * The portrait in a turn's masthead is a 40px thumbnail; this is its full
 * size, the same file the masthead draws from, shown as large as the sheet
 * allows. It is the app's ordinary modal — `Sheet` owns the phone and desktop
 * shapes, the backdrop and the Escape — because a picture is no reason to
 * invent a second overlay.
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
  return (
    <Sheet title={alt} onClose={onClose}>
      <div className="flex items-center justify-center pt-[8px] pb-[14px]">
        <img
          src={src}
          alt={alt}
          className="block max-w-full"
          style={{
            maxHeight: "70dvh",
            width: "auto",
            height: "auto",
            border: "1px solid var(--onsen-color-rule)",
            background: "var(--onsen-color-bg-raised)",
          }}
        />
      </div>
    </Sheet>
  );
}
