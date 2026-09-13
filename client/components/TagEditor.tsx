import { useState, type ReactNode } from "react";

/**
 * Tag chips, one component for every surface that files things (SPEC §9, §12).
 *
 * The libraries used to edit tags three ways: chips in the character editor,
 * chips in the roleplay organise sheet, and a comma-separated string in the
 * backdrop editor. This is the chip editor all three share — add with Enter or
 * by leaving the field, remove with a tap on the ×.
 *
 * Case is the caller's to decide. The roleplay and backdrop libraries preserve
 * what is typed; the character library passes a lowercase normaliser, which is
 * what its editor has always done.
 */

export function TagEditor({
  tags,
  onChange,
  placeholder,
  normalize,
  extra,
}: {
  tags: string[];
  onChange(tags: string[]): void;
  placeholder: string;
  /** Applied to a tag on add, before de-duplication. */
  normalize?: (tag: string) => string;
  /** Rendered beside the add field — the character editor's "suggest tags". */
  extra?: ReactNode;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    let next = draft.trim();
    setDraft("");
    if (normalize !== undefined) next = normalize(next);
    if (next === "" || tags.includes(next)) return;
    onChange([...tags, next]);
  }

  return (
    <>
      <div className="mb-[8px] flex flex-wrap gap-[6px]">
        {tags.map((existing) => (
          <button
            key={existing}
            type="button"
            onClick={() => onChange(tags.filter((tag) => tag !== existing))}
            className="chrome border px-[10px] py-[6px] text-ui"
            style={{
              borderColor: "var(--onsen-color-border-quiet)",
              color: "var(--onsen-color-text-muted)",
            }}
          >
            {existing} ×
          </button>
        ))}
      </div>
      <div className="mb-[8px] flex gap-[6px]">
        <input
          className="field flex-1"
          value={draft}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          onBlur={add}
        />
        {extra}
      </div>
    </>
  );
}
