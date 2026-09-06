import { useEffect, useState } from "react";
import type { ConnectionProfileDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { api } from "../lib/api.ts";
import { navigate, useRoute, type Route } from "../lib/router.ts";
import { useCreateScene, useLorebooks, useScenes } from "../lib/queries.ts";
import { useGeneration } from "../lib/generation.ts";

/**
 * The desktop sidebar (design `4a`, §20 phase 67).
 *
 * "The mobile tab bar turned vertical" — the same five destinations, the same
 * red for the active one, unrolled into a column with room for the counts a
 * bottom bar has no space for. The active row takes `bg-inset` and a 2px red
 * left border, which is the tab bar's red text given somewhere to live.
 *
 * Below the nav, `RECENT`: the roleplay list the phone puts on its own screen.
 * That is the whole justification for the sidebar existing — on a phone,
 * switching scenes is a screen change, and on a desktop it should not be. So a
 * recent row is a real row, not a bare title: the newest line of prose, the
 * cast's initials, the message count, and — while the scene is generating — a
 * red dot and a red `writing` in place of the count.
 */

/** Initials of up to three cast members, with a surplus count past that. */
function castInitials(names: string[]): string {
  if (names.length === 0) return "";
  const shown = names
    .slice(0, 3)
    .map((name) => name[0] ?? "")
    .join("");
  return names.length > 3 ? `${shown}+${names.length - 3}` : shown;
}

export function Sidebar() {
  const route = useRoute();
  const scenes = useScenes();
  const create = useCreateScene();
  const books = useLorebooks();
  const generation = useGeneration();
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
  // The scene generating right now, wherever it is (§5): the recent row wears
  // a red dot and a red `writing` so the sidebar is a live map, not a list.
  const writingSceneId = generation.active?.sceneId ?? null;

  return (
    <nav className="flex w-[232px] flex-none flex-col border-r border-rule bg-bg-sunken">
      {/* The wordmark. The one serif moment in the chrome, the same allowance
          phase 47 made for a group heading: the app's own name, set as prose. */}
      <div className="hairline px-[18px] pt-[20px] pb-[13px]">
        <p
          className="text-[19px] font-medium leading-none tracking-[-0.01em]"
          style={{
            fontFamily: "var(--onsen-font-prose)",
            color: "var(--onsen-color-text-bright)",
          }}
        >
          {strings.nav.appName}
        </p>
      </div>

      {/* The five destinations. Full-bleed so the active row's red bar runs to
          the edge; the bar plus the inset plus the red label are three signals,
          not one, which is what makes the state read at a glance. */}
      <div className="flex flex-col py-[8px]">
        {items.map((item) => {
          const isActive = item.key === activeKey;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => navigate(item.route)}
              aria-current={isActive ? "page" : undefined}
              className="flex items-baseline gap-[10px] py-[11px] pr-[16px] pl-[16px] text-left text-[13px]"
              style={{
                color: isActive
                  ? "var(--onsen-color-red)"
                  : "var(--onsen-color-text-muted)",
                background: isActive ? "var(--onsen-color-bg-inset)" : "transparent",
                borderLeft: `2px solid ${isActive ? "var(--onsen-color-red)" : "transparent"}`,
                fontWeight: isActive ? 600 : 400,
              }}
            >
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.count === undefined ? null : (
                <span
                  className="flex-none text-[12px]"
                  style={{
                    color: isActive
                      ? "var(--onsen-color-red)"
                      : "var(--onsen-color-text-dim)",
                  }}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <p className="section-label mt-[18px] mb-[2px] px-[18px]">{strings.nav.recent}</p>
      <div className="min-h-0 flex-1 overflow-y-auto pb-[10px]">
        {(scenes.data ?? []).map((scene) => {
          const isOpen = scene.id === openSceneId;
          const isWriting = scene.id === writingSceneId;
          const cast = castInitials(scene.cast.map((member) => member.name));
          const title =
            scene.title === "" ? strings.scenes.untitled : scene.title;
          return (
            <button
              key={scene.id}
              type="button"
              onClick={() => navigate({ name: "chat", sceneId: scene.id })}
              className="row block w-full px-[18px] text-left"
              style={{ background: isOpen ? "var(--onsen-color-bg-inset)" : "transparent" }}
            >
              <span className="flex items-center gap-[8px]">
                {isWriting ? (
                  <span
                    className="h-[6px] w-[6px] flex-none self-center"
                    style={{ background: "var(--onsen-color-red)" }}
                  />
                ) : null}
                <span
                  className="min-w-0 flex-1 truncate text-[13px] font-medium"
                  style={{
                    color: isWriting
                      ? "var(--onsen-color-red)"
                      : isOpen
                        ? "var(--onsen-color-text)"
                        : "var(--onsen-color-text-label)",
                  }}
                >
                  {title}
                </span>
                <span
                  className="chrome flex-none text-[11.5px]"
                  style={{
                    color: isWriting
                      ? "var(--onsen-color-red)"
                      : "var(--onsen-color-text-dim)",
                  }}
                >
                  {isWriting ? strings.nav.writing : strings.scenes.counts(scene.messageCount)}
                </span>
              </span>

              {scene.lastLine !== null ? (
                <span
                  className="mt-[3px] line-clamp-1 block text-[12.5px] leading-[1.4]"
                  style={{ color: "var(--onsen-color-text-prose-muted)" }}
                >
                  {scene.lastLine}
                </span>
              ) : null}

              {cast === "" ? null : (
                <span
                  className="chrome mt-[4px] block text-[11.5px]"
                  style={{ color: "var(--onsen-color-text-dim)" }}
                >
                  {cast}
                </span>
              )}
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
          {`+ ${strings.scenes.create}`}
        </button>
      </div>
    </nav>
  );
}
