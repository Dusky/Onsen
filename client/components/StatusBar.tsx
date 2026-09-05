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
  contextSize,
  generating,
  onOpenContext,
}: {
  profileName: string | null;
  tokens: number | null;
  /**
   * The window the tokens are being spent out of (§20 phase 50).
   *
   * A raw count says how much was spent and not out of what, and Instrument's
   * deck is built on the idea that a figure without its denominator is not a
   * readout. Null where the scene has no preset, and the bare count stands.
   */
  contextSize: number | null;
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

      {tokens === null ? null : contextSize === null || contextSize <= 0 ? (
        <span className="chrome text-[10.5px] tracking-[0.12em] text-ink-dim uppercase">
          {strings.chat.barTokens(tokens)}
        </span>
      ) : (
        // The fill takes the memory hue rather than the red pencil: this is a
        // gauge, and red here would read as an alarm at 8% full.
        <span className="flex min-w-0 items-center gap-[7px]">
          <span className="chrome text-[10.5px] tracking-[0.14em] text-ink-dim uppercase">
            {strings.chat.ctxLabel}
          </span>
          <span
            className="hidden h-[3px] w-[64px] flex-none sm:inline-block"
            style={{ background: "var(--onsen-color-rule)" }}
          >
            <span
              className="block h-[3px]"
              style={{
                width: `${Math.min(100, Math.round((tokens / contextSize) * 100))}%`,
                background:
                  tokens / contextSize > 0.9
                    ? "var(--onsen-color-red)"
                    : "var(--onsen-color-green)",
              }}
            />
          </span>
          <span className="chrome text-[10.5px] tracking-[0.06em] text-ink-dim tabular-nums">
            {strings.chat.ctxOf(tokens, contextSize)}
          </span>
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
