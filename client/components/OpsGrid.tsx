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
  onPress(): void;
}

export function OpsGrid({ ops, cue }: { ops: Op[]; cue?: string | undefined }) {
  const blocked = ops.find((op) => op.unavailable !== undefined && op.unavailable !== "");
  return (
    <div className="pb-[2px]">
      {/* The cast strip collapses to make room for the grid, so who is cued has
          to be said in one line instead (design handoff). */}
      {cue === undefined ? null : (
        <p className="chrome mb-[9px] text-[9px] tracking-[0.12em] text-ink-dim uppercase">{cue}</p>
      )}

      <div className="grid grid-cols-3 gap-[6px]">
        {ops.map((op) => {
          const disabled =
            op.disabled === true || (op.unavailable !== undefined && op.unavailable !== "");
          return (
            <button
              key={op.key}
              type="button"
              onClick={op.onPress}
              disabled={disabled}
              aria-label={op.label}
              className="chrome flex h-[52px] flex-col items-center justify-center gap-[3px] border border-border-quiet disabled:opacity-40"
            >
              <span className="text-[13px] leading-none text-ink-label">{op.glyph}</span>
              <span className="text-[7.5px] leading-none tracking-[0.10em] text-ink-muted uppercase">
                {op.label}
              </span>
            </button>
          );
        })}
      </div>
      {/* An op that is present but cannot run says why, once, rather than
          sitting greyed out with no explanation. */}
      {blocked === undefined ? null : (
        <p className="chrome mt-[8px] text-[9px] leading-[1.5] tracking-[0.06em] text-ink-dim uppercase">
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
  hint: string;
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
      <p className="chrome mt-[6px] text-[9px] leading-[1.5] text-ink-dim">{hint}</p>
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
