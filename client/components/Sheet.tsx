import { useEffect, type ReactNode } from "react";

/**
 * A bottom sheet over the dimmed scene.
 *
 * One of the three places the design allows a rounded corner (`16px 16px 0 0`);
 * everything else in the system is square. There is no shadow — the scene
 * dimming behind it is what separates the layers.
 */
export function Sheet({
  title,
  meta,
  tone = "default",
  onClose,
  children,
}: {
  title: string;
  /** Right-aligned on the header row. A cost, usually. */
  meta?: string | undefined;
  /**
   * Which pencil the sheet is in. `blue` is the author talking about their own
   * machinery — the guides panel, and nothing else so far — and it takes the
   * design's 2px blue top border rather than the usual hairline.
   */
  tone?: "default" | "blue";
  onClose(): void;
  children: ReactNode;
}) {
  const blue = tone === "blue";

  // Escape closes it, and the sheet takes focus so a keyboard user is not left
  // tabbing through the log underneath.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/70"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // Capped and centred on a wide screen. A bottom sheet is a phone shape;
        // stretched across 1440px it stops reading as a sheet and starts
        // reading as the page having been replaced.
        className="relative mx-auto w-full max-w-[var(--onsen-prose-measure)]"
        style={{
          borderRadius: "16px 16px 0 0",
          borderTop: blue
            ? "2px solid var(--onsen-color-blue)"
            : "1px solid var(--onsen-color-rule-strong)",
          background: blue ? "var(--onsen-color-blue-bg-sheet)" : "var(--onsen-color-bg-raised)",
          paddingBottom: "calc(14px + env(safe-area-inset-bottom))",
        }}
      >
        <div
          className="flex items-baseline justify-between px-[22px] pt-[16px] pb-[12px]"
          style={{ borderBottom: `1px solid var(--onsen-color-${blue ? "blue-border" : "rule"})` }}
        >
          <p
            className="section-label"
            style={blue ? { color: "var(--onsen-color-blue-text)" } : undefined}
          >
            {title}
          </p>
          {meta === undefined ? null : (
            <p
              className="chrome text-[10.5px]"
              style={{ color: `var(--onsen-color-${blue ? "blue-text-muted" : "text-dim"})` }}
            >
              {meta}
            </p>
          )}
        </div>
        <div className="max-h-[70dvh] overflow-y-auto px-[22px] py-[10px]">{children}</div>
      </div>
    </div>
  );
}

/** A row in an action sheet. Destructive rows take the red pencil. */
export function SheetAction({
  label,
  onClick,
  destructive = false,
  disabled = false,
}: {
  label: string;
  onClick(): void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="chrome flex w-full items-center border-b border-rule py-[15px] text-left text-[11.5px] disabled:opacity-40"
      style={{ color: destructive ? "var(--onsen-color-red)" : "var(--onsen-color-text-label)" }}
    >
      {label}
    </button>
  );
}
