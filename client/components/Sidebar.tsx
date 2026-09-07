import { useEffect, useState } from "react";
import type { ConnectionProfileDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { api } from "../lib/api.ts";
import { navigate, useRoute } from "../lib/router.ts";
import {
  useConnectionProfiles,
  useCreateScene,
  usePersonas,
  usePresets,
  useScenes,
} from "../lib/queries.ts";
import { useGeneration } from "../lib/generation.ts";
import { useUiStore } from "../state/ui.ts";

/**
 * The desktop config rail (design `4a`, §20 phase 85).
 *
 * After the destinations moved to the top bar, this rail had only the recent
 * scenes. It now carries what the Settings screen buried: the prompt, the
 * profiles, the persona, and the way to Settings itself — the configuration a
 * power user reaches for mid-session — with the recent scenes and the new
 * roleplay below. Collapsible; the state lives in memory, not the browser.
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
  const profiles = useConnectionProfiles();
  const presets = usePresets();
  const personas = usePersonas();
  const { leftRailOpen, toggleLeftRail } = useUiStore();
  const [profileId, setProfileId] = useState<string | null>(null);

  // A new roleplay needs somewhere to generate, the same way the roleplay list
  // decides it: the default profile, or the first one there is.
  useEffect(() => {
    void api
      .get<ConnectionProfileDto[]>("/connections/profiles")
      .then((rows) =>
        setProfileId(rows.find((row) => row.isDefault)?.id ?? rows[0]?.id ?? null),
      )
      .catch(() => setProfileId(null));
  }, []);

  const openSceneId = route.name === "chat" ? route.sceneId : null;
  const writingSceneId = generation.active?.sceneId ?? null;
  const defaultPreset = (presets.data ?? []).find((preset) => preset.isDefault) ?? null;
  const defaultPersona = (personas.data ?? []).find((persona) => persona.isDefault) ?? null;

  if (!leftRailOpen) {
    return (
      <nav className="flex w-[34px] flex-none flex-col items-center border-r border-rule bg-bg-sunken py-[10px]">
        <button
          type="button"
          aria-label={strings.settings.railOpen}
          onClick={toggleLeftRail}
          className="chrome flex h-[34px] w-[30px] items-center justify-center text-[13px] text-ink-muted"
        >
          {"\u203a"}
        </button>
      </nav>
    );
  }

  return (
    <nav className="flex w-[232px] flex-none flex-col border-r border-rule bg-bg-sunken">
      <div className="hairline flex flex-none items-center justify-between px-[14px] py-[9px]">
        <p className="section-label">{strings.settings.config}</p>
        <button
          type="button"
          aria-label={strings.settings.railClose}
          onClick={toggleLeftRail}
          className="chrome flex h-[28px] w-[28px] items-center justify-center text-[13px] text-ink-muted"
        >
          {"\u2039"}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* The prompt: what the next generation is assembled from. */}
        <p className="section-label mt-[14px] mb-[2px] px-[18px]">
          {strings.settings.promptOrder}
        </p>
        <button
          type="button"
          onClick={() => navigate({ name: "settings" })}
          className="row flex w-full items-baseline gap-[10px] px-[18px] text-left"
        >
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
            {defaultPreset?.name ?? strings.settings.presetDefault}
          </span>
          <span className="chrome flex-none text-[13px] text-ink-dim">{"\u203a"}</span>
        </button>

        {/* The profiles: which model answers, switchable per operation. */}
        <p className="section-label mt-[12px] mb-[2px] px-[18px]">
          {strings.settings.profiles}
        </p>
        {(profiles.data ?? []).map((profile) => (
          <button
            key={profile.id}
            type="button"
            onClick={() => navigate({ name: "settings" })}
            className="row flex w-full items-baseline gap-[10px] px-[18px] text-left"
          >
            <span className="min-w-0 flex-1 truncate text-[13px]">
              {profile.name}
            </span>
            <span className="meta flex-none truncate">{profile.model}</span>
          </button>
        ))}

        {/* The reader. */}
        <p className="section-label mt-[12px] mb-[2px] px-[18px]">
          {strings.sceneSetup.personaTitle}
        </p>
        <button
          type="button"
          onClick={() => navigate({ name: "personas" })}
          className="row flex w-full items-baseline gap-[10px] px-[18px] text-left"
        >
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
            {defaultPersona?.name ?? strings.sceneSetup.personaNone}
          </span>
          <span className="chrome flex-none text-[13px] text-ink-dim">{"\u203a"}</span>
        </button>

        <p className="section-label mt-[12px] mb-[2px] px-[18px]">
          {strings.nav.settings}
        </p>
        <button
          type="button"
          onClick={() => navigate({ name: "settings" })}
          className="row flex w-full items-baseline gap-[10px] px-[18px] text-left"
        >
          <span className="min-w-0 flex-1 truncate text-[13px]">
            {strings.settings.kicker}
          </span>
          <span className="chrome flex-none text-[13px] text-ink-dim">{"\u203a"}</span>
        </button>

        <p className="section-label mt-[14px] mb-[2px] px-[18px]">{strings.nav.recent}</p>
        {(scenes.data ?? []).map((scene) => {
          const isOpen = scene.id === openSceneId;
          const isWriting = scene.id === writingSceneId;
          const cast = castInitials(scene.cast.map((member) => member.name));
          const title = scene.title === "" ? strings.scenes.untitled : scene.title;
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
