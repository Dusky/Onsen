import type { ReactNode } from "react";

/**
 * A screen with nothing on it yet (SPEC §16, §20 phase 51).
 *
 * The design handoff's open question 5 is "empty states beyond 'no messages
 * yet' aren't drawn", and what got built in their place was one 11.5px
 * uppercase mono line, repeated on four screens, floating above nothing —
 * while the button that would fix it sat in a footer at the other end of the
 * page. The copy was fine. Set as the smallest, coldest thing on screen and
 * separated from its own action, it read as a shrug.
 *
 * So: an empty screen says what the thing is *for*, in the voice the app uses
 * for explaining itself, and carries the action that ends the emptiness. It is
 * the one moment the app has to teach, and the only moment it is guaranteed to
 * have the reader's whole attention — there is nothing else on the page.
 */
export function EmptyState({
  title,
  body,
  actions,
  aside,
}: {
  /** What is missing, as a statement. Not "empty" — nobody calls it that. */
  title: string;
  /** What it would be for. One or two sentences, never a label. */
  body: string;
  /** The first is primary. Omitted where the screen genuinely has no action. */
  actions?: { label: string; onClick(): void; disabled?: boolean }[];
  /** Anything else the screen wants under the actions. */
  aside?: ReactNode;
}) {
  return (
    <div className="surface my-[18px] px-[20px] py-[22px]">
      <p className="text-[19px] leading-[1.35] font-medium tracking-[-0.01em]">{title}</p>
      <p className="explain mt-[8px] max-w-[46ch]">{body}</p>
      {actions === undefined || actions.length === 0 ? null : (
        <div className="mt-[16px] flex flex-wrap gap-[8px]">
          {actions.map((action, index) => (
            <button
              key={action.label}
              type="button"
              // Equal widths, so two actions read as two choices rather than as
              // one button and an afterthought. They sit side by side where
              // there is room and stack to the same width where there is not.
              className={`btn min-w-[150px] flex-1 ${index === 0 ? "btn-primary" : ""}`}
              disabled={action.disabled === true}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
      {aside === undefined ? null : <div className="mt-[14px]">{aside}</div>}
    </div>
  );
}
