import { navigate, type Route } from "../lib/router.ts";
import { strings } from "../strings.ts";
import { useIsDesktop } from "../lib/breakpoint.ts";

/**
 * The bottom tab bar. Mono, uppercase, the active item in red — the design's
 * one use of colour for navigation state.
 *
 * The design's five tabs, complete as of phase 21: lore is the fifth, and it
 * is a top-level destination rather than a page inside a roleplay because §10
 * lets one book be global, bound to a roleplay, and carried by a character all
 * at once — there is no single owner to file it under.
 */
type TabKey = "scenes" | "characters" | "authors" | "lore" | "settings";

export function TabBar({ active }: { active: TabKey }) {
  // With room, this is the sidebar instead — the same five destinations
  // unrolled into a column (design `4a`). Drawn in one place or the other,
  // never both.
  const isDesktop = useIsDesktop();
  const items: { key: TabKey; label: string; route: Route }[] = [
    { key: "scenes", label: strings.nav.roleplays, route: { name: "scenes" } },
    { key: "characters", label: strings.nav.characters, route: { name: "characters" } },
    { key: "authors", label: strings.nav.authors, route: { name: "authors" } },
    { key: "lore", label: strings.nav.lore, route: { name: "lorebooks" } },
    { key: "settings", label: strings.nav.settings, route: { name: "settings" } },
  ];

  if (isDesktop) return null;

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
          className="chrome flex-1 py-[14px] text-[9.5px] tracking-[0.08em] uppercase"
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
