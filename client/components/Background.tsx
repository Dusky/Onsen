import { useEffect } from "react";
import { useBackgrounds, useScenes } from "../lib/queries.ts";
import { useRoute } from "../lib/router.ts";

/**
 * The backdrop behind everything (SPEC §12, §20 phase 108).
 *
 * One picture, drawn under the sidebars and the chat: the scene's own
 * background when it has one, else the library's default, else the built-in
 * onsen. Its opacity is the reader's, and while it shows the chrome goes
 * translucent — `data-background` on the root flips the surface tokens to
 * colour-mix — so the picture reads through the rails without drowning them.
 */
export function Background() {
  const route = useRoute();
  const scenes = useScenes();
  const backgrounds = useBackgrounds();

  const sceneId = route.name === "chat" ? route.sceneId : null;
  const scene = (scenes.data ?? []).find((candidate) => candidate.id === sceneId) ?? null;
  const defaultId = backgrounds.data?.defaultId ?? null;
  const opacity = backgrounds.data?.opacity ?? 0.8;

  const url =
    scene?.hasBackground === true
      ? `/api/scenes/${sceneId}/background`
      : defaultId !== null
        ? `/api/backgrounds/${defaultId}/image`
        : "/default-background.jpg";

  useEffect(() => {
    document.documentElement.dataset.background = "1";
    return () => {
      delete document.documentElement.dataset.background;
    };
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0">
      <img
        src={url}
        alt=""
        className="h-full w-full object-cover"
        style={{ opacity }}
        draggable={false}
      />
    </div>
  );
}
