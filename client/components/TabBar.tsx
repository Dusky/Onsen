import { navigate, type Route } from "../lib/router.ts";
import { strings } from "../strings.ts";

/**
 * The bottom tab bar. Mono, uppercase, the active item in red — the design's
 * one use of colour for navigation state.
 *
 * Four tabs. The design draws five; the fifth is a screen that arrives with a
 * later phase, and a tab that leads nowhere is worse than no tab.
 */
type TabKey = "scenes" | "characters" | "authors" | "settings";

export function TabBar({ active }: { active: TabKey }) {
  const items: { key: TabKey; label: string; route: Route }[] = [
    { key: "scenes", label: strings.nav.roleplays, route: { name: "scenes" } },
    { key: "characters", label: strings.nav.characters, route: { name: "characters" } },
    { key: "authors", label: strings.nav.authors, route: { name: "authors" } },
    { key: "settings", label: strings.nav.settings, route: { name: "settings" } },
  ];

  return (
    <nav
      className="flex flex-none border-t border-rule bg-bg-raised"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => navigate(item.route)}
          aria-current={item.key === active ? "page" : undefined}
          className="chrome flex-1 py-[14px] text-[9.5px] tracking-[0.12em] uppercase"
          style={{
            color:
              item.key === active ? "var(--onsen-color-red)" : "var(--onsen-color-text-muted)",
          }}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
