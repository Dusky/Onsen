import type { SceneDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { navigate } from "../lib/router.ts";
import { useCreateScene, useScenes } from "../lib/queries.ts";
import { useGenerationStore } from "../state/generation.ts";
import { api } from "../lib/api.ts";
import { useEffect, useState } from "react";
import { TabBar } from "../components/TabBar.tsx";
import type { ConnectionProfileDto } from "@shared/types.ts";

/**
 * The entry screen: recent roleplays first, each showing enough to remember what
 * it was. The "still writing" strip under the header is the cross-screen
 * generation indicator — generation continues when the user navigates away, and
 * this is how they get back to it.
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

function SceneRow({ scene }: { scene: SceneDto }) {
  const empty = scene.messageCount === 0;
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
        <span className="chrome flex-none text-[9px] tracking-[0.08em] text-ink-dim uppercase">
          {relativeTime(scene.updatedAt)}
        </span>
      </div>
      <p className="mt-[6px] text-[length:var(--onsen-text-prose-excerpt)] leading-[1.5] text-ink-prose-muted">
        {empty ? strings.scenes.emptyScene : strings.scenes.counts(scene.messageCount)}
      </p>
    </button>
  );
}

export function ScenesScreen() {
  const scenes = useScenes();
  const create = useCreateScene();
  const active = useGenerationStore((state) => state.active);
  const [profileId, setProfileId] = useState<string | null>(null);

  // A new roleplay needs somewhere to generate; the wizard's default profile is
  // the sensible choice until there is a scene-setup screen (phase 8).
  useEffect(() => {
    void api
      .get<ConnectionProfileDto[]>("/connections/profiles")
      .then((profiles) => setProfileId(profiles.find((p) => p.isDefault)?.id ?? profiles[0]?.id ?? null))
      .catch(() => setProfileId(null));
  }, []);

  const writingElsewhere =
    active !== null && (active.status === "connecting" || active.status === "streaming");

  return (
    <div className="flex screen-height flex-col bg-bg">
      <header
        className="hairline flex-none px-[22px] pb-[14px]"
        style={{ paddingTop: "calc(22px + env(safe-area-inset-top))" }}
      >
        <p className="screen-kicker">{strings.scenes.kicker}</p>
        <h1 className="screen-title mt-[6px]">{strings.scenes.title}</h1>
      </header>

      {/* Generation continues when the user navigates away; this is the way back. */}
      {writingElsewhere ? (
        <button
          type="button"
          onClick={() => navigate({ name: "chat", sceneId: active.sceneId })}
          className="mx-[18px] mt-[10px] flex flex-none items-center justify-between gap-[10px] border border-red-border bg-red-bg px-[11px] py-[8px]"
        >
          <span className="chrome truncate text-[9.5px] tracking-[0.12em] text-red-text uppercase">
            {strings.scenes.stillWriting(active.sceneTitle)}
          </span>
          <span
            className="chrome flex-none text-[9.5px] tracking-[0.12em] uppercase"
            style={{ color: "var(--onsen-color-red)" }}
          >
            {strings.scenes.open}
          </span>
        </button>
      ) : null}

      <main className="min-h-0 flex-1 overflow-y-auto px-[22px]">
        <div className="mx-auto w-full max-w-[var(--onsen-prose-measure)]">
          {scenes.data?.length === 0 ? (
            <p className="chrome mt-[24px] text-[10px] tracking-[0.14em] text-ink-dim uppercase">
              {strings.scenes.empty}
            </p>
          ) : null}
          {scenes.data?.map((scene) => <SceneRow key={scene.id} scene={scene} />)}
        </div>
      </main>

      <footer
        className="flex-none border-t border-rule bg-bg-raised px-[22px] pt-[12px]"
        style={{ paddingBottom: "calc(10px + env(safe-area-inset-bottom))" }}
      >
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
      </footer>

      <TabBar active="scenes" />
    </div>
  );
}
