/**
 * Errors take the red pencil. A hairline red-bordered strip, not a modal — the
 * system has no shadows and nothing that interrupts.
 */
export function Notice({ children }: { children: string }) {
  return (
    <p
      role="alert"
      className="chrome mb-[16px] border border-red-border bg-red-bg px-[11px] py-[9px] text-[11.5px] leading-[1.5] text-red-text"
    >
      {children}
    </p>
  );
}
