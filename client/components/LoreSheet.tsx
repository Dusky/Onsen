import type { LoreActivationDto, LorebookDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { navigate } from "../lib/router.ts";
import { Sheet } from "./Sheet.tsx";

/**
 * Which lorebooks reach this roleplay, and what they would do right now
 * (SPEC §10, §16's activation test tool).
 *
 * Attaching and testing are one sheet on purpose. The question a user actually
 * has is never "is this book attached" — it is "why did that entry not fire",
 * and the two most common answers are that the book reaches nothing and that
 * the key did not match. Those live one above the other here.
 *
 * The trace comes from the same activation the generation runs, so what this
 * lists is what the prompt would get, not a second opinion about it.
 */
/**
 * Which books reach a scene: global, bound to it, or carried by someone
 * actually in it — the same four-way union `booksForScene` takes on the
 * server. A book bound to another roleplay's character reaches nothing here,
 * and listing it as attached would be the exact lie this sheet exists to
 * prevent, so the row and the sheet ask one function rather than two.
 */
export function booksReaching(
  books: LorebookDto[],
  scene: { sceneId: string; personaId: string | null; castIds: string[] },
): LorebookDto[] {
  return books.filter((book) =>
    book.bindings.some(
      (binding) =>
        binding.scope === "global" ||
        (binding.scope === "scene" && binding.targetId === scene.sceneId) ||
        (binding.scope === "character" &&
          binding.targetId !== null &&
          scene.castIds.includes(binding.targetId)) ||
        (binding.scope === "persona" && binding.targetId === scene.personaId),
    ),
  );
}

export function LoreSheet({
  sceneId,
  personaId,
  castIds,
  books,
  activation,
  onAttach,
  onDetach,
  onClose,
}: {
  sceneId: string;
  personaId: string | null;
  castIds: string[];
  books: LorebookDto[];
  activation: LoreActivationDto[] | undefined;
  onAttach(bookId: string): void;
  onDetach(bookId: string, bindingId: string): void;
  onClose(): void;
}) {
  const reaching = booksReaching(books, { sceneId, personaId, castIds });
  const rest = books.filter((book) => !reaching.includes(book));
  const fired = (activation ?? []).filter((row) => row.skipped === null);

  return (
    <Sheet
      title={strings.lore.sheetTitle}
      meta={strings.lore.sceneRowCount(reaching.length, fired.length)}
      onClose={onClose}
    >
      <p className="section-label mb-[6px]">{strings.lore.sheetAttached}</p>
      {reaching.length === 0 ? (
        <p className="chrome mb-[12px] text-[10px] tracking-[0.12em] text-ink-dim uppercase">
          {strings.lore.sceneRowNone}
        </p>
      ) : null}
      {reaching.map((book) => {
        // Only a binding to this scene is this sheet's to remove: a global book
        // or one a character carries is attached somewhere else, and detaching
        // it from here would change every other roleplay too.
        const own = book.bindings.find((binding) => binding.scope === "scene" && binding.targetId === sceneId);
        return (
          <div key={book.id} className="flex items-baseline gap-[10px] border-b border-rule py-[11px]">
            <button
              type="button"
              onClick={() => navigate({ name: "lorebook", bookId: book.id })}
              className="min-w-0 flex-1 text-left"
            >
              <span className="block truncate text-[14px]">{book.name}</span>
              <span className="chrome mt-[3px] block truncate text-[9px] tracking-[0.08em] text-ink-dim uppercase">
                {strings.lore.entries(book.entryCount)}
                {book.managed
                  ? ` · ${strings.lore.managedNote}`
                  : own === undefined
                    ? ` · ${strings.lore.globalNote}`
                    : ""}
              </span>
            </button>
            {own === undefined || book.managed ? null : (
              <button
                type="button"
                onClick={() => onDetach(book.id, own.id)}
                className="chrome flex-none text-[9px] tracking-[0.12em] uppercase"
                style={{ color: "var(--onsen-color-red)" }}
              >
                {strings.lore.detach}
              </button>
            )}
          </div>
        );
      })}

      {rest.length === 0 ? null : (
        <>
          <p className="section-label mt-[16px] mb-[6px]">{strings.lore.sheetAvailable}</p>
          {rest.map((book) => (
            <div key={book.id} className="flex items-baseline gap-[10px] border-b border-rule py-[11px]">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px]">{book.name}</span>
                <span className="chrome mt-[3px] block text-[9px] tracking-[0.08em] text-ink-dim uppercase">
                  {strings.lore.entries(book.entryCount)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => onAttach(book.id)}
                className="chrome flex-none text-[9px] tracking-[0.12em] text-ink-label uppercase"
              >
                {strings.lore.attach}
              </button>
            </div>
          ))}
        </>
      )}

      {/* The activation test (§16). Entries that fired first, then the misses
          with the rule that stopped each one — the miss is the useful half. */}
      <p className="section-label mt-[16px] mb-[6px]">{strings.lore.testTitle}</p>
      {activation !== undefined && activation.length === 0 ? (
        <p className="chrome mb-[10px] text-[10px] tracking-[0.12em] text-ink-dim uppercase">
          {strings.lore.testEmpty}
        </p>
      ) : null}
      {[...(activation ?? [])]
        .sort((a, b) => Number(a.skipped !== null) - Number(b.skipped !== null))
        .map((row) => (
          <div key={row.entryId} className="flex items-baseline gap-[10px] border-b border-rule py-[9px]">
            <span
              className="chrome w-[26px] flex-none text-[9px] tracking-[0.1em] uppercase"
              style={{
                color:
                  row.skipped === null ? "var(--onsen-color-red)" : "var(--onsen-color-text-dim)",
              }}
            >
              {row.skipped === null ? strings.lore.testFired : strings.lore.testSkipped}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px]">
                {row.title === "" ? strings.lore.untitled : row.title}
              </span>
              <span className="chrome mt-[3px] block truncate text-[9px] tracking-[0.08em] text-ink-dim uppercase">
                {row.skipped !== null
                  ? strings.lore.testReason(row.skipped)
                  : row.constant
                    ? strings.lore.testConstant
                    : row.sticky
                      ? strings.lore.testSticky
                      : row.matchedKey === null
                        ? strings.lore.testRound(row.round)
                        : strings.lore.testMatched(row.matchedKey)}
              </span>
            </span>
          </div>
        ))}

      <button type="button" className="btn btn-primary mt-[14px] w-full" onClick={onClose}>
        {strings.lore.done}
      </button>
    </Sheet>
  );
}
