/**
 * A labelled row of mutually exclusive choices.
 *
 * Lifted out of `SettingsScreen.tsx`'s `LayoutSection`, which declared it
 * inline, when the reader controls became its second caller (§20 phase 166):
 * a component redeclared on every render of its parent is a new type every
 * render, so React unmounts and remounts the whole row rather than updating
 * it — and two copies of it would be two things to keep looking the same.
 * Moved to its own module when the rail dock editor became a third caller
 * (§20 phase 173): `DockEditor.tsx` needs it too, and it cannot import it
 * from `SettingsScreen.tsx` without that file importing `DockEditor.tsx`
 * right back.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onPick,
  hint,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onPick(next: T): void;
  hint?: string;
}) {
  return (
    <div className="mb-[14px]">
      {/* An empty label is a deliberate second row under one heading (the
          per-side avatar switch), not a missing string — and an empty
          heading with a margin is just a gap. */}
      {label === "" ? null : <p className="section-label mb-[6px]">{label}</p>}
      {/* Wraps, because three and four-way rows exist now and a squeezed
          button is a button under the tap floor. */}
      <div className="flex flex-wrap gap-[6px]">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={option.value === value}
            onClick={() => onPick(option.value)}
            className={`btn flex-1 basis-[110px] ${option.value === value ? "btn-primary" : ""}`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {hint === undefined ? null : <p className="explain mt-[6px]">{hint}</p>}
    </div>
  );
}
