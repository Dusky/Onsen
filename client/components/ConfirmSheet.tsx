import { useCallback, useState, type ReactNode } from "react";
import { strings } from "../strings.ts";
import { Sheet } from "./Sheet.tsx";
import { blueOutline } from "./blue.ts";

/**
 * Asking "are you sure" without leaving the app's own chrome.
 *
 * `window.confirm` was doing this everywhere and it is the same wart the
 * native prompts were: on a phone it is a system dialog dropped on top of a
 * designed surface, and in two places it fired from *inside* an open sheet,
 * stacking two visual systems in one interaction. Inside a blue panel it is
 * worse still — a system dialog is exactly what the blue pencil exists to be
 * told apart from.
 *
 * A React sheet cannot be synchronous the way `confirm` is, so the shape is a
 * hook rather than a component: it hands back the node to render and a function
 * to call. Each call site goes from
 *
 *     if (!window.confirm(message)) return;
 *     doIt();
 *
 * to
 *
 *     confirm(message, () => doIt());
 *
 * which keeps the question and its consequence in one expression, as the
 * original did.
 */

interface ConfirmOptions {
  /** The verb, on the confirming button. Defaults to a generic yes. */
  confirmLabel?: string;
  /**
   * Which pencil the sheet is in. Blue for the author's own machinery — the
   * guides and memory panels — so the question matches the panel that asked it.
   */
  tone?: "default" | "blue";
}

interface Pending extends ConfirmOptions {
  message: string;
  run(): void;
}

export function useConfirm(): [ReactNode, (message: string, run: () => void, options?: ConfirmOptions) => void] {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback(
    (message: string, run: () => void, options: ConfirmOptions = {}) => {
      setPending({ message, run, ...options });
    },
    [],
  );

  const node =
    pending === null ? null : (
      <Sheet
        title={strings.common.areYouSure}
        tone={pending.tone ?? "default"}
        onClose={() => setPending(null)}
      >
        {/* Mono, not Spectral. The question is the app speaking about the
            user's material, not the material itself, and the design's one hard
            typographic rule is that the app never sets its own chrome in the
            serif. Sized to read as a sentence rather than as a label. */}
        <p
          className="chrome py-[12px] text-[12px] leading-[1.6]"
          style={{
            color:
              pending.tone === "blue"
                ? "var(--onsen-color-blue-text)"
                : "var(--onsen-color-text-label)",
          }}
        >
          {pending.message}
        </p>
        <div className="flex gap-[8px] pt-[4px] pb-[6px]">
          {/* Solid red in both tones. The design's rule for a blue panel is
              that a destructive action wears red and is the only thing in it
              that does. */}
          <button
            type="button"
            className="btn btn-primary flex-1"
            onClick={() => {
              const run = pending.run;
              setPending(null);
              run();
            }}
          >
            {pending.confirmLabel ?? strings.common.confirm}
          </button>
          <button
            type="button"
            className="btn flex-1"
            style={pending.tone === "blue" ? blueOutline : undefined}
            onClick={() => setPending(null)}
          >
            {strings.common.cancel}
          </button>
        </div>
      </Sheet>
    );

  return [node, confirm];
}
