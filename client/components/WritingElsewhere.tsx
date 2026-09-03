import { strings } from "../strings.ts";
import { navigate, useRoute } from "../lib/router.ts";
import { useGenerationStore } from "../state/generation.ts";

/**
 * The cross-screen generation indicator (SPEC §5, design §403).
 *
 * Generation continues when the reader navigates away, and this is the way
 * back. It lives in the shell rather than on one screen because the design is
 * specific that it "should appear on any screen that isn't the generating
 * roleplay's chat" — it was on the roleplays list alone, which is the one
 * screen a reader who wandered off is least likely to be on.
 *
 * Hidden on the generating scene's own chat, where the log is already showing
 * the words as they arrive and a strip saying so would be repeating the screen
 * back at itself.
 */
export function WritingElsewhere() {
  const active = useGenerationStore((state) => state.active);
  const route = useRoute();

  const writing =
    active !== null && (active.status === "connecting" || active.status === "streaming");
  if (!writing) return null;
  if (route.name === "chat" && route.sceneId === active.sceneId) return null;

  return (
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
  );
}
