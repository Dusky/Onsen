import { strings } from "../strings.ts";

/**
 * What is true right now, in one line (SPEC §20 phase 43).
 *
 * Collects the chips that used to float on individual screens: which model is
 * answering, how much of the window the next prompt will take, whether anything
 * is being written. An editor's status bar, for the same reason editors have
 * one — it is the answer to "what is going on" without spending a panel on it.
 *
 * On a phone it is also the inspector's handle: the panel it opens is the same
 * panel the desktop shows beside the log, laid down rather than stood up. That
 * is deliberate but it is doing two jobs, so the right side reads as a control
 * rather than as more status.
 */
export function StatusBar({
  profileName,
  tokens,
  generating,
  onOpenContext,
}: {
  profileName: string | null;
  tokens: number | null;
  generating: boolean;
  /** Absent on desktop, where the inspector is already on screen. */
  onOpenContext?: (() => void) | undefined;
}) {
  return (
    <div
      className="flex flex-none items-center gap-[14px] border-t border-rule px-[14px]"
      style={{ background: "var(--onsen-color-bg-sunken)", minHeight: "26px" }}
    >
      <span
        className="chrome flex items-center gap-[6px] text-[10px] tracking-[0.12em] uppercase"
        style={{ color: profileName === null ? "var(--onsen-color-red)" : "var(--onsen-color-text-dim)" }}
      >
        <span
          className="inline-block h-[5px] w-[5px] flex-none"
          style={{
            background:
              profileName === null ? "var(--onsen-color-red)" : "var(--onsen-color-green)",
          }}
        />
        {profileName ?? strings.chat.barNoModel}
      </span>

      {tokens === null ? null : (
        <span className="chrome text-[10px] tracking-[0.12em] text-ink-dim uppercase">
          {strings.chat.barTokens(tokens)}
        </span>
      )}

      <span className="flex-grow" />

      {/* Keyboard hints only where there is a keyboard to hint at. */}
      {onOpenContext === undefined ? (
        <>
          <span className="chrome text-[10px] tracking-[0.12em] text-ink-dim uppercase">
            {strings.chat.barSelect}
          </span>
          <span className="chrome text-[10px] tracking-[0.12em] text-ink-dim uppercase">
            {strings.chat.barCommands}
          </span>
        </>
      ) : (
        // 44px, because on a phone this is the only way to the inspector.
        <button
          type="button"
          onClick={onOpenContext}
          className="chrome -mr-[6px] flex min-h-[44px] items-center gap-[5px] px-[6px] text-[10px] tracking-[0.12em] uppercase"
          style={{ color: "var(--onsen-color-text-label)" }}
        >
          {strings.chat.barContext}
          <span aria-hidden="true">&and;</span>
        </button>
      )}

      <span
        className="chrome text-[10px] tracking-[0.12em] uppercase"
        style={{
          color: generating ? "var(--onsen-color-red)" : "var(--onsen-color-text-dim)",
        }}
      >
        {generating ? strings.chat.barWriting : strings.chat.barIdle}
      </span>
    </div>
  );
}
