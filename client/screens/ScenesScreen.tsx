import type { SceneDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { useConfirm } from "../components/ConfirmSheet.tsx";
import { navigate } from "../lib/router.ts";
import { useIsDesktop } from "../lib/breakpoint.ts";
import {
  useCreateScene,
  useDeleteScene,
  useRenameScene,
  useScenes,
  useStartLikeScene,
} from "../lib/queries.ts";
import { api } from "../lib/api.ts";
import { useEffect, useMemo, useState } from "react";
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
 *
 * Until phase 54 a row did exactly one thing: open. A roleplay could be started
 * and never renamed, copied, or deleted — `DELETE /scenes/:id` had existed
 * since phase 2 with no caller at all.
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

function castNames(scene: SceneDto): string[] {
  return scene.cast
    .filter((member) => member.isActive)
    .map((member) => member.name.trim())
    .filter((name) => name !== "");
}

function castLine(scene: SceneDto): string | null {
  const names = castNames(scene);
  if (names.length === 0) return null;
  return names.length <= NAMES_FIT
    ? names.join(" · ")
    : names.map((name) => name.charAt(0)).join(" ");
}

type Sort = "recent" | "title" | "longest";

function SceneRow({ scene, onManage }: { scene: SceneDto; onManage(): void }) {
  const empty = scene.messageCount === 0;
  const cast = castLine(scene);
  return (
    <div
      className="group relative row"
      // An empty roleplay is still a roleplay, just quieter.
      style={{ opacity: empty ? 0.75 : 1 }}
    >
      <button
        type="button"
        onClick={() => navigate({ name: "chat", sceneId: scene.id })}
        onContextMenu={(event) => {
          // Long-press on a phone arrives as a context menu; the same gesture
          // the message log uses for its action sheet.
          event.preventDefault();
          onManage();
        }}
        className="w-full text-left"
      >
        <div className="flex items-baseline justify-between gap-[12px]">
          <span className="truncate text-[17px] font-medium">{scene.title}</span>
          <span className="meta mr-[30px] flex-none">{relativeTime(scene.updatedAt)}</span>
        </div>
        {/* One line of the newest turn - what the row is actually for. Clamped
            rather than truncated, so a wide window gets the whole line. */}
        <p className="mt-[3px] line-clamp-1 text-[length:var(--onsen-text-prose-excerpt)] leading-[1.5] text-ink-prose-muted">
          {scene.lastLine ?? strings.scenes.emptyScene}
        </p>
        <div className="meta mt-[3px] flex items-baseline justify-between gap-[12px]">
          <span className="truncate">{cast ?? strings.scenes.noCast}</span>
          <span className="flex-none">{strings.scenes.counts(scene.messageCount)}</span>
        </div>
      </button>

      {/* Always visible, and 44px square.
          The first version faded it in on hover, which meant that on a phone —
          where there is no hover — the only way to rename or delete anything
          was a long-press nobody is told about. A control you cannot see is
          not a control; it brightens on hover rather than appearing. */}
      <button
        type="button"
        onClick={onManage}
        aria-label={`${strings.scenes.manage} ${scene.title}`}
        className="chrome absolute top-[8px] right-[-8px] flex h-[44px] w-[44px] items-center justify-center text-[15px] text-ink-dim hover:text-ink-label"
      >
        &hellip;
      </button>
    </div>
  );
}

export function ScenesScreen() {
  const scenes = useScenes();
  const create = useCreateScene();
  const rename = useRenameScene();
  const remove = useDeleteScene();
  const startLike = useStartLikeScene();
  const [confirmNode, confirm] = useConfirm();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  /** The row whose action sheet is open, and whether it is being renamed. */
  const [managing, setManaging] = useState<SceneDto | null>(null);
  const [renaming, setRenaming] = useState<SceneDto | null>(null);
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

  /*
   * Searched and sorted here rather than on the server, deliberately.
   * `useScenes` already fetches the whole list and this screen already renders
   * all of it, so a server filter without pagination would buy a round trip and
   * change nothing. If a library ever gets big enough to hurt, the fix is
   * pagination, and that is the change that should move this.
   */
  const shown = useMemo(() => {
    const all = scenes.data ?? [];
    const needle = query.trim().toLowerCase();
    const matched =
      needle === ""
        ? all
        : all.filter((scene) =>
            [scene.title, scene.lastLine ?? "", ...castNames(scene)]
              .join(" ")
              .toLowerCase()
              .includes(needle),
          );
    const sorted = [...matched];
    if (sort === "title") sorted.sort((a, b) => a.title.localeCompare(b.title));
    if (sort === "longest") sorted.sort((a, b) => b.messageCount - a.messageCount);
    return sorted;
  }, [scenes.data, query, sort]);

  const nothing = (scenes.data ?? []).length === 0;

  return (
    <div className="flex screen-height flex-col bg-bg">
      <header
        className="screen-header screen-header-wide hairline flex-none px-[22px] pb-[14px]"
        style={{ paddingTop: "calc(22px + env(safe-area-inset-top))" }}
      >
        <p className="screen-kicker">{strings.scenes.kicker}</p>
        <div className="mt-[6px] flex items-baseline justify-between gap-[12px]">
          <h1 className="screen-title">{strings.scenes.title}</h1>
          {/* How many of how many (§16 §Density rule 2). On the title row
              rather than beside the sort buttons, where it was squeezed onto
              the edge of "Longest" and read as part of it. */}
          {nothing ? null : (
            <span className="meta shrink-0 tabular-nums">
              {strings.showing(shown.length, (scenes.data ?? []).length)}
            </span>
          )}
        </div>
      </header>

      {/* Offered once there is enough here to lose something in. */}
      {nothing ? null : (
        <div className="hairline flex flex-none flex-col gap-[9px] px-[22px] pb-[11px]">
          <div className="mx-auto flex w-full max-w-[var(--onsen-list-measure)] flex-col gap-[9px]">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={strings.scenes.search}
              aria-label={strings.scenes.search}
              className="field"
            />
            <div className="flex gap-[6px]">
              {(
                [
                  ["recent", strings.scenes.sortRecent],
                  ["title", strings.scenes.sortTitle],
                  ["longest", strings.scenes.sortLongest],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={sort === value}
                  onClick={() => setSort(value)}
                  className={`btn flex-1 ${sort === value ? "btn-primary" : ""}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto px-[22px]">
        <div className="mx-auto w-full max-w-[var(--onsen-list-measure)]">
          {nothing ? (
            <EmptyState
              title={strings.scenes.empty}
              actions={[{ label: strings.scenes.create, onClick: startScene }]}
            />
          ) : null}
          {!nothing && shown.length === 0 ? (
            <p className="explain mt-[18px]">{strings.scenes.noMatches}</p>
          ) : null}
          {shown.map((scene) => (
            <SceneRow key={scene.id} scene={scene} onManage={() => setManaging(scene)} />
          ))}
        </div>
      </main>

      {/* On a phone this is the only way to start one. With room the sidebar
          already carries it, and two identical red buttons on one screen is a
          question about which one is the real one. */}
      {isDesktop || nothing ? null : (
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

      {managing === null ? null : (
        <Sheet title={managing.title} onClose={() => setManaging(null)}>
          <div className="flex flex-col gap-[8px] pt-[8px] pb-[14px]">
            <button
              type="button"
              className="btn w-full"
              onClick={() => {
                setRenaming(managing);
                setManaging(null);
              }}
            >
              {strings.scenes.rename}
            </button>
            <button
              type="button"
              className="btn w-full"
              disabled={startLike.isPending}
              onClick={() => {
                const source = managing;
                setManaging(null);
                startLike.mutate(source.id, {
                  onSuccess: (made) => navigate({ name: "setup", sceneId: made.id }),
                });
              }}
            >
              {strings.scenes.startLike}
            </button>
            <button
              type="button"
              className="btn w-full"
              onClick={() => {
                const doomed = managing;
                setManaging(null);
                confirm(
                  strings.scenes.deleteConfirm,
                  () => remove.mutate(doomed.id),
                  { confirmLabel: strings.common.delete },
                );
              }}
            >
              {strings.common.delete}
            </button>
          </div>
        </Sheet>
      )}

      {renaming === null ? null : (
        <Sheet title={strings.scenes.renameTitle} onClose={() => setRenaming(null)}>
          <form
            className="pt-[8px] pb-[14px]"
            onSubmit={(event) => {
              event.preventDefault();
              const title = String(new FormData(event.currentTarget).get("title") ?? "").trim();
              if (title === "") return;
              rename.mutate({ id: renaming.id, title }, { onSuccess: () => setRenaming(null) });
            }}
          >
            <input
              name="title"
              className="field mb-[12px]"
              defaultValue={renaming.title}
              autoFocus
              required
            />
            <button type="submit" className="btn btn-primary w-full">
              {strings.settings.save}
            </button>
          </form>
        </Sheet>
      )}

      {confirmNode}
      <TabBar active="scenes" />
    </div>
  );
}
