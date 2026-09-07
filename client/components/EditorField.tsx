import type { ReactNode } from "react";
import { strings } from "../strings.ts";

/**
 * A labelled editor field (SPEC §16, §20 phase 81).
 *
 * The label row carries the field's token cost at its right end, and an
 * optional tone for the two fields whose colour means something — the author's
 * OOC voice (blue) and its boundaries (red). The character and author editors
 * each grew their own copy of this; there is now one, so the two cannot drift
 * into different editors.
 */
export function EditorField({
  label,
  tokens,
  hint,
  tone,
  children,
}: {
  label: string;
  tokens?: number;
  hint?: string;
  tone?: "blue" | "red";
  children: ReactNode;
}) {
  return (
    <div className="mb-[18px]">
      <div className="mb-[8px] flex items-baseline justify-between gap-[10px]">
        <span
          className="section-label"
          style={tone === undefined ? undefined : { color: `var(--onsen-color-${tone})` }}
        >
          {label}
        </span>
        {tokens === undefined ? null : (
          <span className="token-count">{strings.characters.tokens(tokens)}</span>
        )}
      </div>
      {children}
      {hint === undefined ? null : <p className="explain mt-[7px]">{hint}</p>}
    </div>
  );
}
