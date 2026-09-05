import { strings } from "../strings.ts";

/**
 * The ops grid (design handoff, composer stack row 5).
 *
 * A 3 × 2 grid of 52px cells, each a mono glyph over a mono caption.
 * **Lettered keys, like proofreading marks — deliberately not emoji.** The
 * design is specific about this and it is the right call: a proofreader's mark
 * is learned once and then read at a glance, where an emoji has to be decoded
 * every time and means something different to everyone.
 *
 * When the grid is open the cast strip and the director's reason collapse away
 * and are replaced by a single line summarising the cue, so the whole composer
 * stack stays manageable above an open keyboard at 390px.
 */

export interface Op {
  key: string;
  /** The glyph. One character, so the cell reads as a key on a keyboard. */
  glyph: string;
  label: string;
  /**
   * Off for a reason nobody needs told — an empty composer, nothing to reroll.
   * The cell dims and that is the whole explanation.
   */
  disabled?: boolean | undefined;
  /**
   * Off for a reason that would otherwise be a mystery, which is printed under
   * the grid. An op that is dark with no explanation reads as a bug.
   */
  unavailable?: string | undefined;
  /**
   * The blue pencil, for the one op in the grid that is not about the story but
   * about the author's own notes (SPEC §8). Everything else is neutral chrome.
   */
  tone?: "blue" | undefined;
  onPress(): void;
}

/** The blue cell's three colours, so the glyph, caption and border agree. */
const BLUE = {
  border: "var(--onsen-color-blue-border-strong)",
  glyph: "var(--onsen-color-blue)",
  label: "var(--onsen-color-blue-text-muted)",
};

/**
 * The ops, flattened into one horizontal row (design `4a`).
 *
 * "The ops grid flattens into one horizontal row of bordered mono chips, always
 * visible — no OPS key needed." That is the whole difference: on a phone the
 * grid hides behind a key because the composer has to fit above a keyboard, and
 * with room there is nothing to hide it from. The keyboard hints sit at the
 * right end, where they read as a reminder rather than an instruction.
 */
export function OpsRow({ ops, hint }: { ops: Op[]; hint?: string | undefined }) {
  return (
    <div className="flex flex-wrap items-center gap-[6px]">
      {ops.map((op) => {
        const disabled =
          op.disabled === true || (op.unavailable !== undefined && op.unavailable !== "");
        const blue = op.tone === "blue" ? BLUE : undefined;
        const why =
          op.unavailable === undefined || op.unavailable === "" ? undefined : op.unavailable;
        return (
          <button
            key={op.key}
            type="button"
            onClick={op.onPress}
            disabled={disabled}
            title={why}
            className="chrome flex items-center gap-[6px] border border-border-quiet px-[9px] py-[6px] text-[10px] disabled:opacity-40"
            style={blue === undefined ? undefined : { borderColor: blue.border }}
          >
            <span
              className="text-[11.5px] leading-none text-ink-label"
              style={blue === undefined ? undefined : { color: blue.glyph }}
            >
              {op.glyph}
            </span>
            <span
              className="leading-none text-ink-muted"
              style={blue === undefined ? undefined : { color: blue.label }}
            >
              {op.label}
            </span>
          </button>
        );
      })}
      {hint === undefined ? null : (
        <span className="chrome ml-auto text-[10px] text-ink-dim">
          {hint}
        </span>
      )}
    </div>
  );
}

export function OpsGrid({ ops, cue }: { ops: Op[]; cue?: string | undefined }) {
  const blocked = ops.find((op) => op.unavailable !== undefined && op.unavailable !== "");
  return (
    <div className="pb-[2px]">
      {/* The cast strip collapses to make room for the grid, so who is cued has
          to be said in one line instead (design handoff). */}
      {cue === undefined ? null : (
        <p className="chrome mb-[9px] text-[10.5px] text-ink-dim">{cue}</p>
      )}

      <div className="grid grid-cols-3 gap-[6px]">
        {ops.map((op) => {
          const disabled =
            op.disabled === true || (op.unavailable !== undefined && op.unavailable !== "");
          const blue = op.tone === "blue" ? BLUE : undefined;
          return (
            <button
              key={op.key}
              type="button"
              onClick={op.onPress}
              disabled={disabled}
              aria-label={op.label}
              className="chrome flex h-[52px] flex-col items-center justify-center gap-[3px] border border-border-quiet disabled:opacity-40"
              style={blue === undefined ? undefined : { borderColor: blue.border }}
            >
              <span
                className="text-[13px] leading-none text-ink-label"
                style={blue === undefined ? undefined : { color: blue.glyph }}
              >
                {op.glyph}
              </span>
              <span
                className="text-[9px] leading-none text-ink-muted"
                style={blue === undefined ? undefined : { color: blue.label }}
              >
                {op.label}
              </span>
            </button>
          );
        })}
      </div>
      {/* An op that is present but cannot run says why, once, rather than
          sitting greyed out with no explanation. */}
      {blocked === undefined ? null : (
        <p className="meta mt-[8px] leading-[1.5]">
          {blocked.unavailable}
        </p>
      )}
    </div>
  );
}

/**
 * A one-field prompt for the ops that need an instruction.
 *
 * Deliberately not a bottom sheet: nudge and steer are things you type *at* the
 * scene while looking at it, and a sheet that covers the log makes you write
 * direction for a scene you can no longer see.
 */
export function OpPrompt({
  title,
  hint,
  placeholder,
  initial = "",
  submitLabel,
  onSubmit,
  onCancel,
  onClear,
}: {
  title: string;
  hint?: string | undefined;
  placeholder: string;
  initial?: string;
  submitLabel: string;
  onSubmit(value: string): void;
  onCancel(): void;
  /** Offered when there is something set to clear — steer, and only steer. */
  onClear?: (() => void) | undefined;
}) {
  return (
    <form
      className="pb-[2px]"
      onSubmit={(event) => {
        event.preventDefault();
        const field = event.currentTarget.elements.namedItem("value");
        onSubmit(field instanceof HTMLTextAreaElement ? field.value : "");
      }}
    >
      <p className="section-label mb-[6px]">{title}</p>
      <textarea
        name="value"
        rows={2}
        autoFocus
        defaultValue={initial}
        placeholder={placeholder}
        className="field min-h-[62px] resize-none py-[10px]"
      />
      <p className="explain mt-[6px]">{hint}</p>
      <div className="mt-[9px] flex gap-[6px]">
        <button type="submit" className="btn btn-primary flex-1">
          {submitLabel}
        </button>
        {onClear === undefined ? null : (
          <button type="button" className="btn" onClick={onClear}>
            {strings.chat.opSteerClear}
          </button>
        )}
        <button type="button" className="btn" onClick={onCancel}>
          {strings.common.cancel}
        </button>
      </div>
    </form>
  );
}
