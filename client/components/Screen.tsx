import type { ReactNode } from "react";

interface ScreenProps {
  kicker: string;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * The standing screen shell: mono kicker over a Spectral title, a hairline
 * rule, then content. 100dvh rather than 100vh, and the footer rail carries the
 * safe-area inset so it clears the iOS home indicator.
 */
export function Screen({ kicker, title, children, footer }: ScreenProps) {
  return (
    <div className="flex screen-height flex-col bg-bg">
      <header
        className="hairline shrink-0 px-[22px] pb-[14px]"
        style={{ paddingTop: "calc(22px + env(safe-area-inset-top))" }}
      >
        <p className="screen-kicker">{kicker}</p>
        <h1 className="screen-title mt-[6px]">{title}</h1>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-[22px] py-[18px]">
        <div className="mx-auto w-full max-w-[var(--onsen-prose-measure)]">{children}</div>
      </main>

      {footer ? (
        <footer
          className="shrink-0 border-t border-rule bg-bg-raised px-[22px] pt-[12px]"
          style={{ paddingBottom: "calc(10px + env(safe-area-inset-bottom))" }}
        >
          <div className="mx-auto w-full max-w-[var(--onsen-prose-measure)]">{footer}</div>
        </footer>
      ) : null}
    </div>
  );
}
