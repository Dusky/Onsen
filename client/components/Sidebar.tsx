import { useEffect, useState } from "react";
import type { ConnectionProfileDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { api } from "../lib/api.ts";
import { navigate, useRoute } from "../lib/router.ts";
import { useCreateScene, useScenes } from "../lib/queries.ts";
import { useGeneration } from "../lib/generation.ts";

/**
 * The desktop rail (design `4a`, §20 phases 67 and 80).
 *
 * The destinations moved to the global top bar in phase 80; what stays here is
 * the thing that justified a desktop rail in the first place — the recent
 * roleplay list, so switching scenes is not a screen change on a desktop the
 * way it is on a phone. A recent row is a real row: the newest line of prose,
 * the cast's initials, the message count, and a red `writing` while the scene
 * is generating.
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

  const openSceneId = route.name === "chat" ? route.sceneId : null;
  // The scene generating right now, wherever it is (§5): the recent row wears
  // a red dot and a red `writing` so the sidebar is a live map, not a list.
  const writingSceneId = generation.active?.sceneId ?? null;

  return (
    <nav className="flex w-[232px] flex-none flex-col border-r border-rule bg-bg-sunken">
      <p className="section-label px-[18px] pt-[16px] pb-[2px]">{strings.nav.recent}</p>
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
