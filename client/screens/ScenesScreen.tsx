import type { SceneDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { navigate } from "../lib/router.ts";
import { useIsDesktop } from "../lib/breakpoint.ts";
import { useCreateScene, useScenes } from "../lib/queries.ts";
import { api } from "../lib/api.ts";
import { useEffect, useState } from "react";
import { TabBar } from "../components/TabBar.tsx";
import type { ConnectionProfileDto } from "@shared/types.ts";

/**
 * The entry screen: recent roleplays first, each showing enough to remember what
 * it was.
 *
 * The "still writing" strip used to live here. It is in the shell now, because
 * the design asks for it on every screen that is not the generating roleplay's
 * chat — and this list is the one screen a reader who wandered off is least
 * likely to be looking at.
 */

function relativeTime(at: number): string {
  const seconds = Math.round((Date.now() - at) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Who is in it. Two roleplays started from the same card have the same title
 * and the same counts; the cast is what tells them apart at a glance.
 *
 * The design asks for initials, which is right for a crowd and wrong for a
 * duet - a row reading `A` says less than one reading `ALDAN`. So names while
 * they fit, initials once there are enough of them that names would not.
 */
const NAMES_FIT = 3;

function castLine(scene: SceneDto): string | null {
  const names = scene.cast
    .filter((member) => member.isActive)
    .map((member) => member.name.trim())
    .filter((name) => name !== "");
  if (names.length === 0) return null;
  return names.length <= NAMES_FIT
    ? names.join(" \u00b7 ")
    : names.map((name) => name.charAt(0)).join(" ");
}

function SceneRow({ scene }: { scene: SceneDto }) {
  const empty = scene.messageCount === 0;
  const cast = castLine(scene);
  return (
    <button
      type="button"
      onClick={() => navigate({ name: "chat", sceneId: scene.id })}
      className="w-full border-b border-rule py-[15px] text-left"
      // An empty roleplay is still a roleplay, just quieter.
      style={{ opacity: empty ? 0.75 : 1 }}
    >
      <div className="flex items-baseline justify-between gap-[12px]">
        <span className="truncate text-[17px] font-medium">{scene.title}</span>
        <span className="meta flex-none">
          {relativeTime(scene.updatedAt)}
        </span>
      </div>
      {/* One line of the newest turn - what the row is actually for. Clamped
          rather than truncated, so a wide window gets the whole line. */}
      <p className="mt-[6px] line-clamp-1 text-[length:var(--onsen-text-prose-excerpt)] leading-[1.5] text-ink-prose-muted">
        {scene.lastLine ?? strings.scenes.emptyScene}
      </p>
      <div className="meta mt-[7px] flex items-baseline justify-between gap-[12px]">
        <span className="truncate">{cast ?? strings.scenes.noCast}</span>
        <span className="flex-none">{strings.scenes.counts(scene.messageCount)}</span>
      </div>
    </button>
  );
}

export function ScenesScreen() {
  const scenes = useScenes();
  const create = useCreateScene();
  const [profileId, setProfileId] = useState<string | null>(null);
  const isDesktop = useIsDesktop();

  // A new roleplay needs somewhere to generate; the wizard's default profile is
  // the sensible choice until there is a scene-setup screen (phase 8).
  useEffect(() => {
    void api
      .get<ConnectionProfileDto[]>("/connections/profiles")
      .then((profiles) => setProfileId(profiles.find((p) => p.isDefault)?.id ?? profiles[0]?.id ?? null))
      .catch(() => setProfileId(null));
  }, []);

  /** Start one. Called from the footer and from the empty screen. */
  function startScene() {
    create.mutate(
      { title: strings.scenes.untitled, connectionProfileId: profileId },
      { onSuccess: (scene) => navigate({ name: "chat", sceneId: scene.id }) },
    );
  }

  return (
    <div className="flex screen-height flex-col bg-bg">
      <header
        className="screen-header screen-header-wide hairline flex-none px-[22px] pb-[14px]"
        style={{ paddingTop: "calc(22px + env(safe-area-inset-top))" }}
      >
        <p className="screen-kicker">{strings.scenes.kicker}</p>
        <h1 className="screen-title mt-[6px]">{strings.scenes.title}</h1>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-[22px]">
        <div className="mx-auto w-full max-w-[var(--onsen-list-measure)]">
          {scenes.data?.length === 0 ? (
            <EmptyState
              title={strings.scenes.empty}
              actions={[{ label: strings.scenes.create, onClick: startScene }]}
            />
          ) : null}
          {scenes.data?.map((scene) => <SceneRow key={scene.id} scene={scene} />)}
        </div>
      </main>

      {/* On a phone this is the only way to start one. With room the sidebar
          already carries it, and two identical red buttons on one screen is a
          question about which one is the real one. */}
      {isDesktop || scenes.data?.length === 0 ? null : (
        <footer
          className="flex-none border-t border-rule bg-bg-raised px-[22px] pt-[12px]"
          style={{ paddingBottom: "calc(10px + env(safe-area-inset-bottom))" }}
        >
          <button
            type="button"
            className="btn btn-primary w-full"
            disabled={create.isPending}
            onClick={startScene}
          >
            {strings.scenes.create}
          </button>
        </footer>
      )}

      <TabBar active="scenes" />
    </div>
  );
}
