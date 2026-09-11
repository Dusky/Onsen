import { useMemo, useState } from "react";
import { strings } from "../strings.ts";
import { navigate } from "../lib/router.ts";
import { useIsDesktop } from "../lib/breakpoint.ts";
import { useConfirm } from "../components/ConfirmSheet.tsx";
import { Sheet, SheetAction } from "../components/Sheet.tsx";
import { TagEditor } from "../components/TagEditor.tsx";
import {
  useBackgrounds,
  useDeleteBackground,
  useGenerateBackground,
  useSetDefaultBackground,
  useUpdateBackground,
  useUpdateBackgroundOpacity,
} from "../lib/queries.ts";

/**
 * The backdrop library, as a screen (§20 phase 111).
 *
 * A top-bar destination because a library of pictures needs the main display:
 * thumbnails, search, tags, folders and sort, with an editor for the name, the
 * prompt, the tags and the folder — the things that make a list manageable.
 */

type Sort = "recent" | "name";

export function BackgroundsScreen() {
  const backgrounds = useBackgrounds();
  const generate = useGenerateBackground();
  const setDefault = useSetDefaultBackground();
  const remove = useDeleteBackground();
  const update = useUpdateBackground();
  const setOpacity = useUpdateBackgroundOpacity();
  const [confirmNode, confirm] = useConfirm();
  const isDesktop = useIsDesktop();

  const [needle, setNeedle] = useState("");
  const [tag, setTag] = useState("");
  const [folder, setFolder] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");

  const list = backgrounds.data?.backgrounds ?? [];
  const [menuFor, setMenuFor] = useState<(typeof list)[number] | null>(null);
  const opacity = backgrounds.data?.opacity ?? 0.8;

  const allTags = useMemo(
    () => [...new Set(list.flatMap((background) => background.tags))].sort(),
    [list],
  );
  const allFolders = useMemo(
    () => [...new Set(list.map((background) => background.folder).filter((f): f is string => f !== null))].sort(),
    [list],
  );

  const rows = useMemo(() => {
    const filtered = list.filter(
      (background) =>
        (needle === "" || background.name.toLowerCase().includes(needle.toLowerCase())) &&
        (tag === "" || background.tags.includes(tag)) &&
        (folder === "" || background.folder === folder),
    );
    return [...filtered].sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name) : b.createdAt - a.createdAt,
    );
  }, [list, needle, tag, folder, sort]);

  const editing = list.find((background) => background.id === editingId) ?? null;

  return (
    <div className="flex screen-height flex-col bg-bg">
      <header
        className="hairline flex flex-none flex-wrap items-center gap-x-[12px] gap-y-[8px] px-[22px] pb-[12px]"
        style={{ paddingTop: "18px" }}
      >
        <button
          type="button"
          onClick={() => navigate({ name: "scenes" })}
          aria-label={strings.common.back}
          className="chrome tap -ml-[6px] flex h-[34px] w-[24px] flex-none items-center self-center text-[18px] text-ink-muted"
        >
          {strings.chat.back}
        </button>
        <div className="min-w-0 flex-1">
          <p className="screen-kicker">{strings.settings.backgrounds}</p>
          <h1 className="screen-title mt-[6px]">{strings.settings.backgrounds}</h1>
        </div>
        <form
          className="flex items-center gap-[6px]"
          onSubmit={(event) => {
            event.preventDefault();
            generate.mutate(prompt.trim() === "" ? {} : { prompt: prompt.trim() });
            setPrompt("");
          }}
        >
          <input
            className="field min-h-0 w-[200px] py-[8px] text-[13px] sm:w-[260px]"
            placeholder={strings.settings.backgroundPrompt}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <button type="submit" className="btn flex-none" disabled={generate.isPending}>
            {generate.isPending ? strings.settings.backgroundWorking : strings.settings.backgroundGenerate}
          </button>
        </form>
        <label className="flex items-center gap-[8px]">
          <span className="section-label">{strings.settings.backgroundOpacity}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={opacity}
            className="w-[120px]"
            onChange={(event) => setOpacity.mutate(Number(event.target.value))}
          />
          <span className="meta tabular-nums">{Math.round(opacity * 100)}%</span>
        </label>
      </header>

      {generate.error !== null ? (
        <p className="explain explain-alert mx-[22px] mb-[10px]">{generate.error.message}</p>
      ) : null}

      <div className="flex flex-none flex-wrap items-center gap-[8px] px-[22px] pb-[10px]">
        <input
          className="field min-h-0 min-w-[140px] flex-1 py-[8px] text-[13px]"
          placeholder={strings.characters.searchPlaceholder}
          value={needle}
          onChange={(event) => setNeedle(event.target.value)}
        />
        <select className="field min-h-0 flex-none py-[8px]" value={tag} onChange={(event) => setTag(event.target.value)}>
          <option value="">{strings.scenes.allTags}</option>
          {allTags.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select className="field min-h-0 flex-none py-[8px]" value={folder} onChange={(event) => setFolder(event.target.value)}>
          <option value="">{strings.scenes.allFolders}</option>
          {allFolders.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <select className="field min-h-0 flex-none py-[8px]" value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
          <option value="recent">{strings.scenes.sortRecent}</option>
          <option value="name">{strings.scenes.sortTitle}</option>
        </select>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-[22px] pb-[22px]">
        {rows.length === 0 ? (
          <p className="explain">{strings.settings.backgroundNone}</p>
        ) : (
          <div className="grid grid-cols-2 gap-[14px] md:grid-cols-3 lg:grid-cols-4">
            {rows.map((background) => (
              <button
                key={background.id}
                type="button"
                onClick={() => setEditingId(background.id)}
                onContextMenu={(event) => {
                  // Right-click is the desktop's long-press: default or delete.
                  event.preventDefault();
                  setMenuFor(background);
                }}
                className="group overflow-hidden border border-rule text-left"
              >
                <div className="relative h-[140px] overflow-hidden">
                  <img
                    src={`/api/backgrounds/${background.id}/image`}
                    alt=""
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    loading="lazy"
                  />
                  {background.isDefault ? (
                    <span
                      className="chrome absolute left-[6px] top-[6px] px-[6px] py-[2px] text-[11px]"
                      style={{ background: "var(--onsen-color-amber)", color: "#0b1219" }}
                    >
                      {strings.settings.presetIsDefault}
                    </span>
                  ) : null}
                </div>
                <div className="p-[10px]">
                  <span className="block truncate text-[14px] font-medium">{background.name}</span>
                  <span className="meta mt-[3px] block truncate">
                    {[
                      background.folder,
                      background.tags.length > 0 ? background.tags.slice(0, 3).join(", ") : null,
                    ]
                      .filter((part) => part !== null && part !== "")
                      .join(" · ")}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {editing === null ? null : isDesktop ? (
        <aside className="flex w-[420px] flex-none flex-col border-l border-rule bg-bg-sunken">
          <div className="hairline flex flex-none items-center gap-[10px] px-[16px] py-[12px]">
            <button type="button" aria-label={strings.common.back} className="chrome text-[14px] text-ink-muted" onClick={() => setEditingId(null)}>
              {strings.chat.back}
            </button>
            <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{editing.name}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-[16px] py-[14px]">
            <BackgroundEditorBody
              key={editing.id}
              background={editing}
              onSave={(patch) => update.mutate({ id: editing.id, ...patch })}
              onDefault={() => setDefault.mutate(editing.id)}
              onDelete={() =>
                confirm(
                  strings.settings.backgroundDelete,
                  () => {
                    setEditingId(null);
                    remove.mutate(editing.id);
                  },
                )
              }
            />
          </div>
        </aside>
      ) : (
        <Sheet title={strings.settings.backgrounds} meta={editing.name} onClose={() => setEditingId(null)}>
          <BackgroundEditorBody
            key={editing.id}
            background={editing}
            onSave={(patch) => update.mutate({ id: editing.id, ...patch })}
            onDefault={() => setDefault.mutate(editing.id)}
            onDelete={() =>
              confirm(
                strings.settings.backgroundDelete,
                () => {
                  setEditingId(null);
                  remove.mutate(editing.id);
                },
              )
            }
          />
        </Sheet>
      )}
      {menuFor === null ? null : (
        <Sheet title={menuFor.name} onClose={() => setMenuFor(null)}>
          <SheetAction
            label={strings.settings.backgroundSetDefault}
            onClick={() => {
              setDefault.mutate(menuFor.id);
              setMenuFor(null);
            }}
          />
          <SheetAction
            label={strings.common.delete}
            destructive
            onClick={() =>
              confirm(
                strings.settings.backgroundDelete,
                () => {
                  remove.mutate(menuFor.id);
                  setMenuFor(null);
                },
              )
            }
          />
        </Sheet>
      )}
      {confirmNode}
    </div>
  );
}

function BackgroundEditorBody({
  background,
  onSave,
  onDefault,
  onDelete,
}: {
  background: { id: string; name: string; prompt: string | null; tags: string[]; folder: string | null; isDefault: boolean };
  onSave(patch: { name?: string; prompt?: string; tags?: string[]; folder?: string | null }): void;
  onDefault(): void;
  onDelete(): void;
}) {
  const [name, setName] = useState(background.name);
  const [prompt, setPrompt] = useState(background.prompt ?? "");
  const [tags, setTags] = useState<string[]>(background.tags);
  const [folder, setFolder] = useState(background.folder ?? "");
  const [saved, setSaved] = useState(false);

  const nextName = name.trim();
  const nextPrompt = prompt.trim();
  const nextFolder = folder.trim() === "" ? null : folder.trim();
  const dirty =
    (nextName !== "" && nextName !== background.name) ||
    nextPrompt !== (background.prompt ?? "") ||
    tags.length !== background.tags.length ||
    tags.some((tag, index) => tag !== background.tags[index]) ||
    nextFolder !== background.folder;

  function save() {
    const patch: { name?: string; prompt?: string; tags?: string[]; folder?: string | null } = {};
    if (nextName !== "" && nextName !== background.name) patch.name = nextName;
    if (nextPrompt !== (background.prompt ?? "")) patch.prompt = nextPrompt;
    if (tags.length !== background.tags.length || tags.some((tag, index) => tag !== background.tags[index])) {
      patch.tags = tags;
    }
    if (nextFolder !== background.folder) patch.folder = nextFolder;
    if (Object.keys(patch).length === 0) return;
    onSave(patch);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  }

  return (
    <>
      <div className="mb-[14px] overflow-hidden border border-rule">
        <img src={`/api/backgrounds/${background.id}/image`} alt="" className="h-[180px] w-full object-cover" />
      </div>

      <p className="section-label mb-[6px]">{strings.characters.name}</p>
      <input
        className="field mb-[12px]"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />

      <p className="section-label mb-[6px]">{strings.settings.backgroundPrompt}</p>
      <textarea
        rows={3}
        className="field mb-[12px] resize-none py-[10px]"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
      />

      <p className="section-label mb-[6px]">{strings.characters.tagFilter}</p>
      <TagEditor tags={tags} onChange={setTags} placeholder={strings.characters.tagPrompt} />

      <p className="section-label mb-[6px]">{strings.characters.folderFilter}</p>
      <input
        className="field mb-[16px]"
        value={folder}
        onChange={(event) => setFolder(event.target.value)}
      />

      {/* One save for the whole editor, rather than a silent save per field on
          blur (§20 phase 118): the button is disabled until something changed,
          and a brief "Saved" confirms it landed. */}
      <button
        type="button"
        className="btn btn-primary w-full"
        disabled={!dirty}
        onClick={save}
      >
        {saved ? strings.characters.saved : strings.settings.save}
      </button>

      {background.isDefault ? null : (
        <button type="button" className="btn mt-[8px] w-full" onClick={onDefault}>
          {strings.settings.backgroundSetDefault}
        </button>
      )}
      {background.isDefault ? null : (
        <button
          type="button"
          className="btn mt-[8px] w-full"
          style={{ color: "var(--onsen-color-red)", borderColor: "var(--onsen-color-red-border)" }}
          onClick={onDelete}
        >
          {strings.settings.backgroundDelete}
        </button>
      )}
    </>
  );
}
