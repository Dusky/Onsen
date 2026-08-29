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
  onClose,
  children,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
}) {
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
        className="relative border-t border-rule-strong bg-bg-raised"
        style={{
          borderRadius: "16px 16px 0 0",
          paddingBottom: "calc(14px + env(safe-area-inset-bottom))",
        }}
      >
        <div className="hairline px-[22px] pt-[16px] pb-[12px]">
          <p className="section-label">{title}</p>
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
      className="chrome flex w-full items-center border-b border-rule py-[15px] text-left text-[10px] tracking-[0.12em] uppercase disabled:opacity-40"
      style={{ color: destructive ? "var(--onsen-color-red)" : "var(--onsen-color-text-label)" }}
    >
      {label}
    </button>
  );
}
