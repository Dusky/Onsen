import type { SceneDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { useConfirm } from "../components/ConfirmSheet.tsx";
import { TagEditor } from "../components/TagEditor.tsx";
import { navigate } from "../lib/router.ts";
import { useIsDesktop } from "../lib/breakpoint.ts";
import {
  useCreateScene,
  useDeleteScene,
  useOrganiseScene,
  useRenameScene,
  useSceneFolders,
  useSceneList,
  useSceneTags,
  useStartLikeScene,
} from "../lib/queries.ts";
import { api } from "../lib/api.ts";
import { useEffect, useMemo, useState } from "react";
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
  if (seconds < 60) return strings.time.justNow;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return strings.time.minutesAgo(minutes);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return strings.time.hoursAgo(hours);
  return strings.time.daysAgo(Math.round(hours / 24));
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

function SceneRow({
  scene,
  onManage,
  onFavourite,
}: {
  scene: SceneDto;
  onManage(): void;
  onFavourite(): void;
}) {
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
          <span className="meta mr-[58px] flex-none">{relativeTime(scene.updatedAt)}</span>
        </div>
        {/* One line of the newest turn - what the row is actually for. Clamped
            rather than truncated, so a wide window gets the whole line. */}
        <p className="mt-[3px] line-clamp-1 text-[length:var(--onsen-text-prose-excerpt)] leading-[1.5] text-ink-prose-muted">
          {scene.lastLine ?? strings.scenes.emptyScene}
        </p>
        <div className="meta mt-[3px] flex items-baseline justify-between gap-[12px]">
          <span className="truncate">
            {[scene.folder, ...scene.tags].filter((v) => v !== null && v !== "").join(" · ") ||
              cast ||
              strings.scenes.noCast}
          </span>
          <span className="flex-none">{strings.scenes.counts(scene.messageCount)}</span>
        </div>
      </button>

      {/* The row's own controls, in one cluster at the top right.
          Outside the row's button because a button cannot nest, absolute
          because in flow they would reserve width on every row.

          Always visible and 44px tall: the first version of the manage
          affordance faded in on hover, which on a phone left a long-press
          nobody is told about as the only way in (§20 phase 54). */}
      <span className="absolute top-[4px] right-[-8px] flex items-center">
        <button
          type="button"
          onClick={onFavourite}
          aria-label={`${scene.isFavourite ? strings.scenes.unfavourite : strings.scenes.favourite}: ${scene.title}`}
          aria-pressed={scene.isFavourite}
          className="chrome flex h-[44px] w-[28px] items-center justify-center text-[13px]"
          style={{
            color: scene.isFavourite ? "var(--onsen-color-red)" : "var(--onsen-color-text-dim)",
          }}
        >
          {scene.isFavourite ? "\u2605" : "\u2606"}
        </button>
        <button
          type="button"
          onClick={onManage}
          aria-label={`${strings.scenes.manage} ${scene.title}`}
          className="chrome flex h-[44px] w-[30px] items-center justify-center text-[15px] text-ink-dim hover:text-ink-label"
        >
          &hellip;
        </button>
      </span>
    </div>
  );
}

const PAGE = 50;

/**
 * Tags and a folder for one roleplay (§20 phase 59).
 *
 * A folder is a label rather than a tree — the same reading the character
 * library settled on in phase 26 (`0023_character_library.sql`: "a folder is a
 * label, not a tree"), so the two libraries file things the same way.
 */
function OrganiseSheet({
  scene,
  folders,
  onSave,
  onClose,
}: {
  scene: SceneDto;
  folders: string[];
  onSave(patch: { tags: string[]; folder: string | null }): void;
  onClose(): void;
}) {
  const [tags, setTags] = useState(scene.tags);
  const [folder, setFolder] = useState(scene.folder ?? "");

  return (
    <Sheet title={strings.scenes.organise} meta={scene.title} onClose={onClose}>
      <div className="pt-[8px] pb-[14px]">
        <p className="section-label mb-[6px]">{strings.scenes.tagsLabel}</p>
        <TagEditor tags={tags} onChange={setTags} placeholder={strings.scenes.tagAdd} />

        <p className="section-label mb-[6px]">{strings.scenes.folderLabel}</p>
        <input
          className="field mb-[6px]"
          value={folder}
          list="scene-folders"
          placeholder={strings.scenes.noFolder}
          aria-label={strings.scenes.folderLabel}
          onChange={(event) => setFolder(event.target.value)}
        />
        {/* The folders already in use, offered rather than imposed: typing a
            new one is how a folder gets created. */}
        <datalist id="scene-folders">
          {folders.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>

        <button
          type="button"
          className="btn btn-primary mt-[12px] w-full"
          onClick={() => onSave({ tags, folder: folder.trim() === "" ? null : folder.trim() })}
        >
          {strings.settings.save}
        </button>
      </div>
    </Sheet>
  );
}

export function ScenesScreen() {
  const create = useCreateScene();
  const rename = useRenameScene();
  const remove = useDeleteScene();
  const startLike = useStartLikeScene();
  const [confirmNode, confirm] = useConfirm();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [tag, setTag] = useState("");
  const [folder, setFolder] = useState("");
  const [favourite, setFavourite] = useState(false);
  /** How many pages have been asked for; the list grows rather than flips. */
  const [pages, setPages] = useState(1);
  const tags = useSceneTags();
  const folders = useSceneFolders();
  const organise = useOrganiseScene();
  /** The row whose action sheet is open, and whether it is being renamed. */
  const [managing, setManaging] = useState<SceneDto | null>(null);
  const [renaming, setRenaming] = useState<SceneDto | null>(null);
  const [organising, setOrganising] = useState<SceneDto | null>(null);
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
   * Filtered and paged on the server (§20 phase 59).
   *
   * Phase 54 did this on the client and left a note saying why that was fine
   * and when it would stop being: "if a library ever gets big enough to hurt,
   * the fix is pagination, and that is the change that should move this." The
   * install this replaces runs 139 roleplays. This is that change.
   */
  const filter = useMemo(
    () => ({
      ...(query.trim() === "" ? {} : { q: query.trim() }),
      ...(tag === "" ? {} : { tag }),
      ...(folder === "" ? {} : { folder }),
      ...(favourite ? { favourite: true } : {}),
      sort,
      limit: PAGE * pages,
    }),
    [query, tag, folder, favourite, sort, pages],
  );
  const page = useSceneList(filter);
  const shown = page.data?.scenes ?? [];
  const total = page.data?.total ?? 0;
  const all = page.data?.all ?? 0;

  // A narrowed filter should start at the top rather than keeping the depth
  // scrolled to under the last one.
  useEffect(() => setPages(1), [query, tag, folder, favourite, sort]);

  const nothing = all === 0;

  return (
    <div className="flex screen-height flex-col bg-bg">
      <header
        className="screen-header screen-header-wide hairline flex-none px-[22px] pb-[14px]"
        style={{ paddingTop: "22px" }}
      >
        <p className="screen-kicker">{strings.scenes.kicker}</p>
        <div className="mt-[6px] flex items-baseline justify-between gap-[12px]">
          <h1 className="screen-title">{strings.scenes.title}</h1>
          <div className="flex shrink-0 items-center gap-[12px]">
            {/* How many of how many (§16 §Density rule 2). On the title row
                rather than beside the sort buttons, where it was squeezed onto
                the edge of "Longest" and read as part of it. */}
            {nothing ? null : (
              <span className="meta tabular-nums">
                {/* Against the whole library when a filter narrows it: "1 of 60"
                    answers "did my filter work", where a bare "1" does not. */}
                {total < all
                  ? strings.showing(total, all)
                  : strings.showing(shown.length, total)}
              </span>
            )}
            {/* On a phone the footer carries the create button; with room there
                is no footer, so it belongs here in the header (§149). */}
            {isDesktop ? (
              <button
                type="button"
                className="btn"
                disabled={create.isPending}
                onClick={startScene}
              >
                {strings.scenes.create}
              </button>
            ) : null}
          </div>
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
            {/* Tag, folder and favourites (§20 phase 59). Selects rather than
                chips: at 139 roleplays the vocabulary is longer than a row, and
                the app already picks this way everywhere else. */}
            <div className="flex flex-wrap gap-[6px]">
              <button
                type="button"
                aria-pressed={favourite}
                onClick={() => setFavourite(!favourite)}
                className={`btn flex-none ${favourite ? "btn-primary" : ""}`}
              >
                {"\u2605"} {strings.scenes.favouritesOnly}
              </button>
              {(tags.data ?? []).length === 0 ? null : (
                <select
                  className="field min-w-0 flex-1"
                  aria-label={strings.scenes.tagsLabel}
                  value={tag}
                  onChange={(event) => setTag(event.target.value)}
                >
                  <option value="">{strings.scenes.allTags}</option>
                  {(tags.data ?? []).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              )}
              {(folders.data ?? []).length === 0 ? null : (
                <select
                  className="field min-w-0 flex-1"
                  aria-label={strings.scenes.folderLabel}
                  value={folder}
                  onChange={(event) => setFolder(event.target.value)}
                >
                  <option value="">{strings.scenes.allFolders}</option>
                  {(folders.data ?? []).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              )}
            </div>

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
            <SceneRow
              key={scene.id}
              scene={scene}
              onManage={() => setManaging(scene)}
              onFavourite={() =>
                organise.mutate({ id: scene.id, isFavourite: !scene.isFavourite })
              }
            />
          ))}
          {shown.length < total ? (
            <button
              type="button"
              className="btn mt-[12px] mb-[16px] w-full"
              onClick={() => setPages((n) => n + 1)}
            >
              {strings.scenes.more}
            </button>
          ) : null}
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
              onClick={() => {
                setOrganising(managing);
                setManaging(null);
              }}
            >
              {strings.scenes.organise}
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

      {organising === null ? null : (
        <OrganiseSheet
          scene={organising}
          folders={folders.data ?? []}
          onSave={(patch) => {
            organise.mutate({ id: organising.id, ...patch });
            setOrganising(null);
          }}
          onClose={() => setOrganising(null)}
        />
      )}

      {confirmNode}
    </div>
  );
}
