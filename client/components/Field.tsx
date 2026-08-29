import type { ReactNode } from "react";
import { useId } from "react";

interface FieldProps {
  label: string;
  hint?: string;
  /** Right-aligned on the label row — where the design puts token costs. */
  aux?: ReactNode;
  children: (id: string) => ReactNode;
}

/**
 * A labelled field. The label row is the app speaking (mono, tracked, upper),
 * the control below is the user's material (Spectral) — the two-voices rule.
 */
export function Field({ label, hint, aux, children }: FieldProps) {
  const id = useId();
  return (
    <div className="mb-[18px]">
      <div className="mb-[8px] flex items-baseline justify-between gap-[10px]">
        <label htmlFor={id} className="section-label">
          {label}
        </label>
        {aux ? <span className="chrome text-[8.5px] text-ink-dim">{aux}</span> : null}
      </div>
      {children(id)}
      {hint ? (
        <p className="chrome mt-[7px] text-[9.5px] leading-[1.5] text-ink-dim">{hint}</p>
      ) : null}
    </div>
  );
}
