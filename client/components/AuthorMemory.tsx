import { useEffect, useState } from "react";
import { strings } from "../strings.ts";
import { navigate } from "../lib/router.ts";
import { useConfirm } from "./ConfirmSheet.tsx";
import {
  useAuthorMemory,
  useRememberThis,
  useSetAuthorMemoryBudget,
  useWipeAuthorMemory,
} from "../lib/queries.ts";

/**
 * What an author remembers across roleplays (SPEC §11).
 *
 * Two pieces, in the two places their questions belong. `AuthorNotes` lives on
 * the author's card, because "what does this partner know about me" is a
 * question about the partner. `RememberThis` lives beside a roleplay, because
 * that is the thing there is something to remember about — §11 asks for it "at
 * scene end or on request", and the request needs a scene.
 *
 * Both lean on the design claim rather than hiding it: these notes are an
 * ordinary lorebook the author owns, and the way to edit one is the lorebook
 * editor, which is why there is a link to it instead of a second editor here.
 */

/* ------------------------------------------------------------------ */
/* On the author's card                                                */
/* ------------------------------------------------------------------ */

export function AuthorNotes({ authorId, authorName }: { authorId: string; authorName: string }) {
  const memory = useAuthorMemory(authorId);
  const setBudget = useSetAuthorMemoryBudget(authorId);
  const wipe = useWipeAuthorMemory(authorId);
  const [confirmNode, confirm] = useConfirm();

  const entries = memory.data?.entries ?? [];
  const bookId = memory.data?.bookId ?? null;

  return (
    // Closed at the bottom by a rule, because the button under it is "delete
    // author" — two red buttons in a row, one of which forgets some notes and
    // one of which deletes the partner, need to look like different decisions.
    <div className="mb-[22px] border-b border-rule pb-[20px]">
      <p className="section-label mb-[8px]">{strings.authors.memoryNotes}</p>

      {entries.length === 0 ? (
        <p className="explain mb-[14px]">
          {strings.authors.memoryEmpty}
        </p>
      ) : (
        entries.map((entry) => (
          <div key={entry.id} className="border-b border-rule py-[11px]">
            <p className="text-[15px] font-medium">{entry.title}</p>
            <p className="mt-[3px] text-[length:var(--onsen-text-prose-excerpt)] leading-[1.5] text-ink-prose-muted">
              {entry.content}
            </p>
            {/* §11's provenance, as a sentence: a badge saying AUTHOR would be
                one more thing to decode on a screen that already has several. */}
            <p className="meta mt-[5px]">
              {[
                entry.writtenByAuthor
                  ? strings.authors.memoryByAuthor(authorName)
                  : strings.authors.memoryByYou,
                entry.writtenInScene === null
                  ? null
                  : strings.authors.memoryInScene(entry.writtenInScene),
              ]
                .filter((part): part is string => part !== null)
                .join(" · ")}
            </p>
          </div>
        ))
      )}

      <div className="mt-[14px] mb-[8px] flex items-baseline justify-between gap-[10px]">
        <span className="section-label">{strings.authors.memoryBudget}</span>
      </div>
      <BudgetField
        value={memory.data?.tokenBudget ?? 0}
        disabled={bookId === null}
        onCommit={(next) => setBudget.mutate(next)}
      />
      <p className="explain mt-[7px] mb-[14px]">
        {strings.authors.memoryBudgetHint}
      </p>

      {bookId === null ? null : (
        <>
          <button
            type="button"
            className="btn w-full"
            onClick={() => navigate({ name: "lorebook", bookId })}
          >
            {strings.authors.memoryOpenBook}
          </button>
          <p className="explain mt-[7px] mb-[14px]">
            {strings.authors.memoryOpenBookHint}
          </p>
        </>
      )}

      {entries.length === 0 ? null : (
        <button
          type="button"
          className="btn w-full"
          style={{
            color: "var(--onsen-color-red)",
            borderColor: "var(--onsen-color-red-border)",
          }}
          disabled={wipe.isPending}
          onClick={() =>
            confirm(strings.authors.memoryWipeConfirm(authorName), () => wipe.mutate(undefined), {
              confirmLabel: strings.authors.memoryWipe,
            })
          }
        >
          {strings.authors.memoryWipe}
        </button>
      )}
      {confirmNode}
    </div>
  );
}

function BudgetField({
  value,
  disabled,
  onCommit,
}: {
  value: number;
  disabled: boolean;
  onCommit(next: number): void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  return (
    <input
      type="number"
      min="0"
      step="1"
      className="field"
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = Number(draft);
        if (Number.isFinite(next) && next >= 0 && next !== value) onCommit(Math.trunc(next));
        else setDraft(String(value));
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Beside a roleplay                                                   */
/* ------------------------------------------------------------------ */

/**
 * "Remember this" (§11).
 *
 * Shown for any roleplay with an author, on or off — a button that only exists
 * once the feature is already on is a feature nobody finds. When it is off the
 * block says so and where the switch is, which is one line rather than a second
 * copy of the switch in a place that does not own it.
 */
export function RememberThis({
  sceneId,
  authorId,
  authorName,
}: {
  sceneId: string;
  authorId: string;
  authorName: string;
}) {
  const memory = useAuthorMemory(authorId);
  const remember = useRememberThis(authorId);
  const [said, setSaid] = useState<string | null>(null);

  const enabled = memory.data?.enabled ?? false;

  return (
    <div className="mb-[22px]">
      <p className="section-label mb-[8px]">{strings.sceneSetup.remember}</p>
      {enabled ? (
        <>
          <button
            type="button"
            className="btn w-full"
            disabled={remember.isPending}
            onClick={() =>
              remember.mutate(sceneId, {
                onSuccess: (result) =>
                  setSaid(
                    result.note === null
                      ? strings.sceneSetup.rememberNothing
                      : strings.sceneSetup.rememberDone(result.note.title),
                  ),
              })
            }
          >
            {remember.isPending
              ? strings.sceneSetup.rememberThisWorking
              : strings.sceneSetup.rememberThis}
          </button>
          <p className="explain mt-[7px]">
            {said ?? strings.sceneSetup.rememberHint(authorName)}
          </p>
        </>
      ) : (
        <p className="explain">
          {strings.sceneSetup.rememberOff(authorName)}
        </p>
      )}
    </div>
  );
}
