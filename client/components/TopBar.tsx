import { useState } from "react";
import { strings } from "../strings.ts";
import { navigate, useRoute, type Route } from "../lib/router.ts";
import { useGeneration } from "../lib/generation.ts";
import { Logo } from "./Logo.tsx";
import { Sheet } from "./Sheet.tsx";

/**
 * The global top bar (SPEC §16, §20 phase 80).
 *
 * The one thing SillyTavern puts at the top and this app scattered: the
 * wordmark, the destinations, and the one piece of live state a reader reaches
 * for from anywhere — which scene is writing right now. The bar is the
 * navigation on every screen and every width; on a desktop the sidebar shrinks
 * to a recent-scenes rail, and on a phone the bottom tab bar is gone.
 *
 * A destination is interactive/selected (blue); which scene is writing is
 * live/now (amber) — the three-role split desktop's Header/LeftRail/RightRail
 * already draw, brought here to match (design review follow-up).
 *
 * Six destinations do not fit a 390px bar. Rather than scroll them (a
 * destination off the edge is a destination nobody finds), the last two live
 * behind a "more" button on a phone and join the visible row once there is
 * room (§20 phase 120).
 *
 * The scene's own readouts (token count, model, the prompt preview) stay in the
 * chat screen's status bar, where they have the scene to read from.
 */

const ITEMS: readonly { key: string; label: string; route: Route }[] = [
  { key: "scenes", label: strings.nav.roleplays, route: { name: "scenes" } },
  { key: "characters", label: strings.nav.characters, route: { name: "characters" } },
  { key: "authors", label: strings.nav.authors, route: { name: "authors" } },
  { key: "lorebooks", label: strings.nav.lorebooks, route: { name: "lorebooks" } },
  { key: "backgrounds", label: strings.nav.backgrounds, route: { name: "backgrounds" } },
  { key: "settings", label: strings.nav.settings, route: { name: "settings" } },
];

/** Always on the bar; the rest go behind "more" until the bar is wide enough. */
const PRIMARY = ITEMS.slice(0, 4);
const OVERFLOW = ITEMS.slice(4);

export function TopBar() {
  const route = useRoute();
  const generation = useGeneration();
  const [moreOpen, setMoreOpen] = useState(false);

  // A chat, a scene's setup, and the roleplays list are all "roleplays" as far
  // as the nav is concerned; an editor names its list.
  const activeKey =
    route.name === "chat" || route.name === "setup" || route.name === "unknown"
      ? "scenes"
      : route.name === "character"
        ? "characters"
        : route.name === "author"
          ? "authors"
          : route.name === "lorebook"
            ? "lorebooks"
            : route.name;

  const writing =
    generation.active !== null &&
    (generation.active.status === "connecting" || generation.active.status === "streaming")
      ? generation.active
      : null;
  // On the generating scene's own chat the log is already showing the words,
  // so the bar's indicator would repeat the screen back at itself (§5).
  const showWriting =
    writing !== null && !(route.name === "chat" && route.sceneId === writing.sceneId);

  const overflowActive = OVERFLOW.some((item) => item.key === activeKey);

  function itemButton(item: (typeof ITEMS)[number]) {
    const active = item.key === activeKey;
    return (
      <button
        key={item.key}
        type="button"
        onClick={() => navigate(item.route)}
        aria-current={active ? "page" : undefined}
        className="chrome flex-none px-[10px] py-[14px] text-[12px]"
        style={{
          color: active ? "var(--onsen-color-blue)" : "var(--onsen-color-text-muted)",
          borderBottom: `2px solid ${active ? "var(--onsen-color-blue)" : "transparent"}`,
        }}
      >
        {item.label}
      </button>
    );
  }

  return (
    <header
      className="flex flex-none items-center gap-[2px] border-b border-rule bg-bg-sunken px-[12px]"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      {/* The wordmark: the mark beside the name, in the mono the redesign
          sets it in. */}
      <button
        type="button"
        onClick={() => navigate({ name: "scenes" })}
        className="chrome tap flex flex-none items-center gap-[7px] py-[11px] pl-[6px] pr-[10px] text-[12px] font-medium"
        style={{ color: "var(--onsen-color-text-bright)" }}
      >
        <Logo className="h-[20px] w-auto" />
        <span>onsen</span>
      </button>

      <span aria-hidden="true" className="mx-[4px] h-[16px] w-px flex-none bg-rule" />

      {/* The destinations. Active takes the interactive blue and a blue
          underline, the same signal the desktop rails use for their own
          active tab. The last two stay behind "more" on a phone, where six
          labels would not fit. */}
      <nav className="flex min-w-0 flex-1 items-center overflow-x-auto">
        {PRIMARY.map(itemButton)}
        {OVERFLOW.map((item) => (
          <span key={item.key} className="hidden sm:contents">
            {itemButton(item)}
          </span>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-label={strings.nav.more}
          className="chrome flex-none px-[10px] py-[14px] text-[13px] sm:hidden"
          style={{
            color: overflowActive ? "var(--onsen-color-blue)" : "var(--onsen-color-text-muted)",
            borderBottom: `2px solid ${overflowActive ? "var(--onsen-color-blue)" : "transparent"}`,
          }}
        >
          {"\u22ef"}
        </button>
      </nav>

      {/* Which scene is writing, from anywhere (SPEC §5). An amber dot, the
          title, and a tap back to it — live/now, the same colour the scene
          title and turn spine use while a turn is streaming. */}
      {showWriting ? (
        <button
          type="button"
          onClick={() => navigate({ name: "chat", sceneId: writing!.sceneId })}
          className="chrome tap flex flex-none items-center gap-[6px] py-[12px] pl-[10px] pr-[4px] text-[11px]"
          style={{ color: "var(--onsen-color-amber)" }}
        >
          <span
            aria-hidden="true"
            className="h-[6px] w-[6px] flex-none"
            style={{ background: "var(--onsen-color-amber)" }}
          />
          <span className="max-w-[180px] truncate">{writing!.sceneTitle}</span>
          <span className="hidden sm:inline">{strings.nav.writing}</span>
        </button>
      ) : null}

      {moreOpen ? (
        <Sheet title={strings.nav.more} onClose={() => setMoreOpen(false)}>
          <div className="flex flex-col pb-[6px]">
            {OVERFLOW.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  navigate(item.route);
                }}
                className="chrome flex w-full items-center border-b border-rule py-[15px] text-left text-[13.5px]"
                style={{
                  color:
                    item.key === activeKey
                      ? "var(--onsen-color-blue)"
                      : "var(--onsen-color-text-label)",
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </Sheet>
      ) : null}
    </header>
  );
}
