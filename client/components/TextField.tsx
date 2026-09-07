import { useEffect, useState } from "react";

/**
 * A text field that commits on blur and keeps its own draft while focused.
 *
 * Commit-on-blur is the editor's rule: a save button per field would be a wall
 * of buttons, and the prompt-side cost a field carries changes the moment the
 * text does. The draft is local so a save landing from elsewhere (a refetch, a
 * pass) adopts without stamping on what is being typed.
 */
export function TextField({
  value,
  onCommit,
  rows = 1,
  placeholder,
}: {
  value: string;
  onCommit(next: string): void;
  rows?: number;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return rows > 1 ? (
    <textarea
      className="field resize-y"
      style={{ minHeight: `${rows * 26 + 20}px` }}
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
    />
  ) : (
    <input
      className="field"
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
    />
  );
}
