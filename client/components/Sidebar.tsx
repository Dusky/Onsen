import { useEffect, useState } from "react";
import type { ConnectionProfileDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { api } from "../lib/api.ts";
import { navigate, useRoute, type Route } from "../lib/router.ts";
import { useCreateScene, useLorebooks, useScenes } from "../lib/queries.ts";

/**
 * The desktop sidebar (design `4a`).
 *
 * "The mobile tab bar turned vertical" — the same five destinations, the same
 * mono uppercase, the same red for the active one, unrolled into a column with
 * room for the counts a bottom bar has no space for. The active row takes
 * `bg-inset` and a 2px red left border, which is the tab bar's red text given
 * somewhere to live.
 *
 * Below the nav, `RECENT`: the roleplay list the phone puts on its own screen.
 * That is the whole justification for the sidebar existing — on a phone,
 * switching scenes is a screen change, and on a desktop it should not be.
 */
export function Sidebar() {
  const route = useRoute();
  const scenes = useScenes();
  const create = useCreateScene();
  const books = useLorebooks();
  const [profileId, setProfileId] = useState<string | null>(null);

  // A new roleplay needs somewhere to generate, the same way the roleplay list
  // decides it: the default profile, or the first one there is.
  useEffect(() => {
    void api
      .get<ConnectionProfileDto[]>("/connections/profiles")
      .then((profiles) =>
        setProfileId(profiles.find((row) => row.isDefault)?.id ?? profiles[0]?.id ?? null),
      )
      .catch(() => setProfileId(null));
  }, []);

  const items: { key: string; label: string; route: Route; count?: number }[] = [
    {
      key: "scenes",
      label: strings.nav.roleplays,
      route: { name: "scenes" },
      count: scenes.data?.length ?? 0,
    },
    { key: "characters", label: strings.nav.characters, route: { name: "characters" } },
    { key: "authors", label: strings.nav.authors, route: { name: "authors" } },
    {
      key: "lorebooks",
      label: strings.nav.lore,
      route: { name: "lorebooks" },
      count: books.data?.length ?? 0,
    },
    { key: "settings", label: strings.nav.settings, route: { name: "settings" } },
  ];

  // The roleplay screen and a chat inside one are both "roleplays" as far as
  // the nav is concerned; anything else names itself.
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

  const openSceneId = route.name === "chat" ? route.sceneId : null;

  return (
    <nav className="flex w-[232px] flex-none flex-col border-r border-rule bg-bg-sunken">
      <div className="hairline px-[18px] pt-[22px] pb-[16px]">
        <p className="screen-kicker">{strings.scenes.kicker}</p>
      </div>

      {items.map((item) => {
        const isActive = item.key === activeKey;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => navigate(item.route)}
            aria-current={isActive ? "page" : undefined}
            className="chrome flex items-center gap-[10px] py-[13px] pr-[16px] pl-[16px] text-left text-[11px] tracking-[0.12em] uppercase"
            style={{
              color: isActive ? "var(--onsen-color-red)" : "var(--onsen-color-text-muted)",
              background: isActive ? "var(--onsen-color-bg-inset)" : "transparent",
              borderLeft: `2px solid ${isActive ? "var(--onsen-color-red)" : "transparent"}`,
            }}
          >
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.count === undefined ? null : (
              <span className="flex-none text-[10.5px] text-ink-dim">{item.count}</span>
            )}
          </button>
        );
      })}

      <p className="section-label mt-[24px] mb-[6px] px-[18px]">{strings.nav.recent}</p>
      <div className="min-h-0 flex-1 overflow-y-auto pb-[10px]">
        {(scenes.data ?? []).map((scene) => {
          const isOpen = scene.id === openSceneId;
          return (
            <button
              key={scene.id}
              type="button"
              onClick={() => navigate({ name: "chat", sceneId: scene.id })}
              className="block w-full px-[18px] py-[9px] text-left"
              style={{ background: isOpen ? "var(--onsen-color-bg-inset)" : "transparent" }}
            >
              <span
                className="block truncate text-[13px]"
                style={{
                  color: isOpen ? "var(--onsen-color-text)" : "var(--onsen-color-text-muted)",
                }}
              >
                {scene.title === "" ? strings.scenes.untitled : scene.title}
              </span>
              <span className="chrome mt-[2px] block text-[10px] tracking-[0.08em] text-ink-dim uppercase">
                {strings.scenes.counts(scene.messageCount)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex-none border-t border-rule p-[12px]">
        <button
          type="button"
          className="btn btn-primary w-full"
          disabled={create.isPending}
          onClick={() =>
            create.mutate(
              { title: strings.scenes.untitled, connectionProfileId: profileId },
              { onSuccess: (scene) => navigate({ name: "chat", sceneId: scene.id }) },
            )
          }
        >
          {strings.scenes.create}
        </button>
      </div>
    </nav>
  );
}
