import { strings } from "../strings.ts";
import { navigate, useRoute, type Route } from "../lib/router.ts";
import { useGeneration } from "../lib/generation.ts";
import { Logo } from "./Logo.tsx";

/**
 * The global top bar (SPEC §16, §20 phase 80).
 *
 * The one thing SillyTavern puts at the top and this app scattered: the
 * wordmark, the destinations, and the one piece of live state a reader reaches
 * for from anywhere — which scene is writing right now. The bar is the
 * navigation on every screen and every width; on a desktop the sidebar shrinks
 * to a recent-scenes rail, and on a phone the bottom tab bar is gone.
 *
 * The scene's own readouts (token count, model, the prompt preview) stay in the
 * chat screen's status bar, where they have the scene to read from.
 */

const ITEMS: readonly { key: string; label: string; route: Route }[] = [
  { key: "scenes", label: strings.nav.roleplays, route: { name: "scenes" } },
  { key: "characters", label: strings.nav.characters, route: { name: "characters" } },
  { key: "authors", label: strings.nav.authors, route: { name: "authors" } },
  { key: "lorebooks", label: strings.nav.lore, route: { name: "lorebooks" } },
  { key: "backgrounds", label: strings.nav.backgrounds, route: { name: "backgrounds" } },
  { key: "settings", label: strings.nav.settings, route: { name: "settings" } },
];

export function TopBar() {
  const route = useRoute();
  const generation = useGeneration();

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
        className="chrome flex flex-none items-center gap-[7px] py-[11px] pl-[6px] pr-[10px] text-[12px] font-medium"
        style={{ color: "var(--onsen-color-text-bright)" }}
      >
        <Logo className="h-[20px] w-auto" />
        <span>onsen</span>
      </button>

      <span aria-hidden="true" className="mx-[4px] h-[16px] w-px flex-none bg-rule" />

      {/* The destinations. Active takes the red pencil and a red underline, the
          same two signals the settings categories use. */}
      <nav className="flex min-w-0 flex-1 items-center overflow-x-auto">
        {ITEMS.map((item) => {
          const active = item.key === activeKey;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => navigate(item.route)}
              aria-current={active ? "page" : undefined}
              className="chrome flex-none px-[10px] py-[14px] text-[12px]"
              style={{
                color: active ? "var(--onsen-color-red)" : "var(--onsen-color-text-muted)",
                borderBottom: `2px solid ${active ? "var(--onsen-color-red)" : "transparent"}`,
              }}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Which scene is writing, from anywhere (SPEC §5). A red dot, the title,
          and a tap back to it. */}
      {showWriting ? (
        <button
          type="button"
          onClick={() => navigate({ name: "chat", sceneId: writing!.sceneId })}
          className="chrome flex flex-none items-center gap-[6px] py-[12px] pl-[10px] pr-[4px] text-[11px]"
          style={{ color: "var(--onsen-color-red)" }}
        >
          <span
            aria-hidden="true"
            className="h-[6px] w-[6px] flex-none"
            style={{ background: "var(--onsen-color-red)" }}
          />
          <span className="max-w-[180px] truncate">{writing!.sceneTitle}</span>
          <span className="hidden sm:inline">{strings.nav.writing}</span>
        </button>
      ) : null}
    </header>
  );
}
