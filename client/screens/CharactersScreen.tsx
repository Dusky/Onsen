import { useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type {
  BulkImportCharactersResponse,
  CharacterDto,
  SavedFilterDto,
} from "@shared/types.ts";
import { strings } from "../strings.ts";
import { useConfirm } from "../components/ConfirmSheet.tsx";
import { navigate } from "../lib/router.ts";
import { useIsDesktop } from "../lib/breakpoint.ts";
import {
  useBulkCharacters,
  useCharacterFolders,
  useCharacters,
  useCharacterTags,
  useCreateCharacter,
  useCreateFilter,
  useDeleteCharacter,
  useDeleteFilter,
  useDeriveCharacter,
  useBulkImportCharacters,
  useImportCharacter,
  useSeedDemo,
  useSavedFilters,
  useAuthorCreate,
} from "../lib/queries.ts";
import { TabBar } from "../components/TabBar.tsx";
import { Notice } from "../components/Notice.tsx";
import { Sheet, SheetAction } from "../components/Sheet.tsx";

/**
 * The character library (SPEC §9, phase 26).
 *
 * Search is the server's now, not a name filter: full-text across name,
 * description, personality and creator notes, then narrowed by tag and folder.
 * A selection turns the grid into the subject of bulk edits; a card's own
 * menu offers derivation and deletion.
 */

function Tile({
  character,
  selecting,
  selected,
  onToggle,
  onMenu,
}: {
  character: CharacterDto;
  selecting: boolean;
  selected: boolean;
  onToggle(): void;
  onMenu(): void;
}) {
  return (
    <div className="relative text-left">
      <button
        type="button"
        onClick={() => (selecting ? onToggle() : navigate({ name: "character", characterId: character.id }))}
        className="block w-full text-left"
      >
        <div
          className="h-[128px] w-full border bg-cover bg-center"
          style={{
            borderColor: selected ? "var(--onsen-color-red)" : "var(--onsen-color-rule)",
            outline: selected ? "2px solid var(--onsen-color-red)" : "none",
            ...(character.hasAvatar
              ? { backgroundImage: `url(/api/characters/${character.id}/avatar)` }
              : { background: "var(--onsen-stripe)" }),
          }}
        />
        <p className="mt-[7px] truncate text-[14px] font-medium">{character.name}</p>
        <p className="chrome mt-[2px] truncate text-[8.5px] tracking-[0.06em] text-ink-dim uppercase">
          {[character.folder, strings.characters.tokens(character.tokens.total)]
            .filter((part) => part !== null && part !== "")
            .join(" · ")}
        </p>
      </button>
      {!selecting ? (
        <button
          type="button"
          aria-label={strings.characters.actions}
          onClick={onMenu}
          className="chrome absolute top-[6px] right-[6px] flex h-[24px] w-[24px] items-center justify-center text-[13px]"
          style={{ background: "rgba(0,0,0,0.45)", color: "var(--onsen-color-text-bright)" }}
        >
          ⋯
        </button>
      ) : null}
    </div>
  );
}

export function CharactersScreen() {
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [folder, setFolder] = useState("");
  const [savedId, setSavedId] = useState<string>("");

  const characters = useCharacters({ q, tag, folder });
  const tags = useCharacterTags();
  const folders = useCharacterFolders();
  const savedFilters = useSavedFilters();
  const importCard = useImportCharacter();
  const bulkImport = useBulkImportCharacters();
  const busy = importCard.isPending || bulkImport.isPending;
  const seedDemo = useSeedDemo();
  const create = useCreateCharacter();
  const bulk = useBulkCharacters();
  const createFilter = useCreateFilter();
  const deleteFilter = useDeleteFilter();
  const remove = useDeleteCharacter();
  const authorCreate = useAuthorCreate();
  const [aiOpen, setAiOpen] = useState(false);
  const [aiDraft, setAiDraft] = useState("");

  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<CharacterDto | null>(null);
  /** The in-app prompt: which field is being asked for, and its draft. */
  const [promptOpen, setPromptOpen] = useState<null | "tag" | "folder" | "filter">(null);
  const [promptValue, setPromptValue] = useState("");
  const [confirmNode, confirm] = useConfirm();
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<BulkImportCharactersResponse | null>(null);
  const derive = useDeriveCharacter(menuFor?.id ?? "");

  const list = characters.data ?? [];

  // The grid is virtualized (DESIGN §289): hundreds of cards, only the visible
  // rows mounted. Three to a row on a phone; a desktop row is wide enough that
  // three tiles stretch into letterboxes, so it takes five.
  const isDesktop = useIsDesktop();
  const columns = isDesktop ? 5 : 3;
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = Math.ceil(list.length / columns);
  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 175,
    overscan: 4,
  });

  /**
   * One file keeps the single-card path, which reports the warnings a card
   * carries. Several go through the bulk endpoint, which reports per file —
   * "it worked" is not an answer for a folder of two hundred (SPEC §9).
   */
  function onFiles(chosen: FileList | null) {
    const files = [...(chosen ?? [])];
    if (files.length === 0) return;
    setNotice(null);

    if (files.length === 1) {
      importCard.mutate(files[0]!, {
        onSuccess: (result) => {
          setNotice(
            [strings.characters.imported(result.character.name), ...result.warnings].join(" "),
          );
        },
        onError: (error) => setNotice(error.message),
      });
      return;
    }

    bulkImport.mutate(files, {
      onSuccess: (result) => setReport(result),
      onError: (error) => setNotice(error.message),
    });
  }

  function toggleOne(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function applyFilter(filter: SavedFilterDto) {
    setSavedId(filter.id);
    setQ(filter.query.q ?? "");
    setTag(filter.query.tag ?? "");
    setFolder(filter.query.folder ?? "");
  }

  function commitPrompt() {
    if (promptOpen === null) return;
    const value = promptValue.trim();
    setPromptOpen(null);
    setPromptValue("");
    if (promptOpen === "tag") {
      // An empty tag is not a tag.
      if (value === "") return;
      bulk.mutate({ ids: [...selected], op: "tag", tag: value });
      setSelected(new Set());
    } else if (promptOpen === "folder") {
      // Empty is a real answer here, and the only way to say it: the server
      // reads a blank folder as "no folder", which is how a character is moved
      // back out of one. Refusing it would leave nothing in the app able to
      // unfile anything.
      bulk.mutate({ ids: [...selected], op: "move", folder: value });
      setSelected(new Set());
    } else {
      // A filter with no name could not be told from the others in the list.
      if (value === "") return;
      createFilter.mutate({ name: value, query: { q, tag, folder } });
    }
  }

  return (
    <div className="flex screen-height flex-col bg-bg">
      <header
        className="screen-header screen-header-wide hairline flex-none px-[22px] pb-[14px]"
        style={{ paddingTop: "calc(22px + env(safe-area-inset-top))" }}
      >
        <p className="screen-kicker">{strings.characters.kicker}</p>
        <div className="mt-[6px] flex items-center gap-[8px]">
          <h1 className="screen-title flex-1">{strings.characters.title}</h1>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setSelecting((value) => !value);
              setSelected(new Set());
            }}
          >
            {selecting ? strings.characters.done : strings.characters.select}
          </button>
        </div>
      </header>

      <main ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-[22px] py-[14px]">
        <div className="mx-auto w-full max-w-[var(--onsen-list-measure)]">
          {notice !== null ? <Notice>{notice}</Notice> : null}

          <input
            className="field mb-[10px]"
            placeholder={strings.characters.searchPlaceholder}
            value={q}
            onChange={(event) => setQ(event.target.value)}
            aria-label={strings.characters.search}
          />

          {/* Tag and folder narrow the search; the saved filter row keeps the
              combination. All three are the server's filter, not the client's
              — the library is too big to sort in a phone's memory. */}
          <div className="mb-[10px] flex gap-[6px]">
            <select
              className="field flex-1"
              value={tag}
              onChange={(event) => setTag(event.target.value)}
              aria-label={strings.characters.tagFilter}
            >
              <option value="">{strings.characters.allTags}</option>
              {(tags.data ?? []).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <select
              className="field flex-1"
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
              aria-label={strings.characters.folderFilter}
            >
              <option value="">{strings.characters.allFolders}</option>
              {(folders.data ?? []).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-[16px] flex gap-[6px]">
            <select
              className="field flex-1"
              value={savedId}
              onChange={(event) => {
                const chosen = (savedFilters.data ?? []).find(
                  (filter) => filter.id === event.target.value,
                );
                if (chosen !== undefined) applyFilter(chosen);
                else setSavedId("");
              }}
              aria-label={strings.characters.savedFilters}
            >
              <option value="">{strings.characters.savedFilters}</option>
              {(savedFilters.data ?? []).map((filter) => (
                <option key={filter.id} value={filter.id}>
                  {filter.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn flex-none"
              onClick={() => {
                setPromptValue("");
                setPromptOpen("filter");
              }}
            >
              {strings.characters.saveFilter}
            </button>
            {savedId !== "" ? (
              <button
                type="button"
                className="btn flex-none"
                onClick={() => {
                  deleteFilter.mutate(savedId);
                  setSavedId("");
                }}
              >
                ×
              </button>
            ) : null}
          </div>

          {list.length === 0 && characters.data !== undefined ? (
            <>
              <p className="chrome text-[10px] tracking-[0.14em] text-ink-dim uppercase">
                {characters.data.length === 0 ? strings.characters.empty : strings.characters.noResults}
              </p>
              {characters.data.length === 0 ? (
                <button
                  type="button"
                  className="btn mt-[10px] w-full"
                  disabled={seedDemo.isPending}
                  onClick={() =>
                    seedDemo.mutate(undefined, {
                      onSuccess: ({ sceneId }) => navigate({ name: "chat", sceneId }),
                    })
                  }
                >
                  {strings.characters.loadDemo}
                </button>
              ) : null}
            </>
          ) : null}

          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((row) => {
              const start = row.index * columns;
              const tiles = list.slice(start, start + columns);
              return (
                <div
                  key={row.key}
                  className="absolute top-0 left-0 grid w-full gap-x-[10px] gap-y-[12px]"
                  style={{
                    transform: `translateY(${row.start}px)`,
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                  }}
                >
                  {tiles.map((character) => (
                    <Tile
                      key={character.id}
                      character={character}
                      selecting={selecting}
                      selected={selected.has(character.id)}
                      onToggle={() => toggleOne(character.id)}
                      onMenu={() => setMenuFor(character)}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </main>

      {/* The bulk bar appears in place of the import row while a selection is
          open: what you selected is the subject now, not the import button. */}
      <footer className="flex-none border-t border-rule bg-bg-raised px-[22px] py-[12px]">
        {selecting ? (
          <div className="mx-auto w-full max-w-[var(--onsen-list-measure)]">
            <p className="chrome mb-[8px] text-[9px] tracking-[0.12em] text-ink-dim uppercase">
              {strings.characters.selected(selected.size)}
            </p>
            <div className="flex gap-[6px]">
              <button
                type="button"
                className="btn flex-1"
                disabled={selected.size === 0}
                onClick={() => {
                  setPromptValue("");
                  setPromptOpen("tag");
                }}
              >
                {strings.characters.bulkTag}
              </button>
              <button
                type="button"
                className="btn flex-1"
                disabled={selected.size === 0}
                onClick={() => {
                  setPromptValue("");
                  setPromptOpen("folder");
                }}
              >
                {strings.characters.bulkMove}
              </button>
              <button
                type="button"
                className="btn flex-1"
                style={{ color: "var(--onsen-color-red)" }}
                disabled={selected.size === 0}
                onClick={() =>
                  confirm(
                    strings.characters.bulkDeleteConfirm(selected.size),
                    () => {
                      bulk.mutate({ ids: [...selected], op: "delete" });
                      setSelected(new Set());
                    },
                    { confirmLabel: strings.characters.bulkDelete },
                  )
                }
              >
                {strings.characters.bulkDelete}
              </button>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-[var(--onsen-list-measure)] flex-wrap gap-[8px]">
            <input
              ref={fileInput}
              type="file"
              hidden
              multiple
              accept=".png,.charx,.json,image/png,application/zip,application/json"
              onChange={(event) => {
                onFiles(event.target.files);
                event.target.value = "";
              }}
            />
            {/* A folder is its own input: `webkitdirectory` is non-standard but
                universally supported, and the multi-select above is the
                fallback that always works. No accept filter — a folder holds
                whatever it holds, and the report says what was passed over. */}
            <input
              ref={folderInput}
              type="file"
              hidden
              multiple
              // @ts-expect-error — not in React's typings; every engine here has it.
              webkitdirectory=""
              onChange={(event) => {
                onFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              className="btn btn-primary min-w-[92px] flex-1"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              {busy ? strings.characters.importing : strings.characters.import}
            </button>
            <button
              type="button"
              className="btn min-w-[92px] flex-1"
              disabled={busy}
              onClick={() => folderInput.current?.click()}
            >
              {strings.characters.importFolder}
            </button>
            <button
              type="button"
              className="btn min-w-[92px] flex-1"
              onClick={() => setAiOpen(true)}
            >
              {strings.characters.writeWithAi}
            </button>
            <button
              type="button"
              className="btn min-w-[92px] flex-1"
              disabled={create.isPending}
              onClick={() =>
                create.mutate(
                  {},
                  {
                    onSuccess: (character) =>
                      navigate({ name: "character", characterId: character.id }),
                  },
                )
              }
            >
              {strings.characters.create}
            </button>
          </div>
        )}
      </footer>

      {/* What a folder import actually did, file by file. A folder is never
          clean, and the skips are the half worth reading (SPEC §9). */}
      {report !== null ? (
        <Sheet
          title={strings.characters.importReport}
          meta={strings.characters.importReportMeta(report.added, report.skipped)}
          onClose={() => setReport(null)}
        >
          <div className="pt-[8px] pb-[14px]">
            {report.items.length === 0 ? (
              <p className="text-[14px] leading-[1.6] text-ink-prose-muted">
                {strings.characters.importNothing}
              </p>
            ) : null}
            {(["add", "skip"] as const).map((action) => {
              const rows = report.items.filter((item) => item.action === action);
              if (rows.length === 0) return null;
              return (
                <div key={action}>
                  <p className="section-label mt-[10px] mb-[6px]">
                    {action === "add"
                      ? strings.characters.importAdded
                      : strings.characters.importSkipped}
                  </p>
                  {rows.map((item) => (
                    <div
                      key={item.filename}
                      className="border-b border-rule py-[9px]"
                      style={{ opacity: action === "add" ? 1 : 0.6 }}
                    >
                      <div className="flex items-baseline justify-between gap-[10px]">
                        <span className="min-w-0 flex-1 truncate text-[14px]">{item.name}</span>
                        <span className="chrome flex-none text-[9px] tracking-[0.08em] text-ink-dim">
                          {item.filename}
                        </span>
                      </div>
                      {item.detail !== "" ? (
                        <p className="chrome mt-[3px] text-[10px] leading-[1.5] text-ink-dim">
                          {item.detail}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </Sheet>
      ) : null}

      {aiOpen ? (
        <Sheet title={strings.characters.writeTitle} onClose={() => setAiOpen(false)}>
          <div className="pt-[8px] pb-[14px]">
            <textarea
              className="field min-h-[96px] resize-y"
              placeholder={strings.characters.writePlaceholder}
              value={aiDraft}
              onChange={(event) => setAiDraft(event.target.value)}
            />
            <button
              type="button"
              className="btn btn-primary mt-[10px] w-full"
              disabled={authorCreate.isPending || aiDraft.trim() === ""}
              onClick={() =>
                authorCreate.mutate(
                  { description: aiDraft.trim() },
                  {
                    onSuccess: (character) => {
                      setAiOpen(false);
                      setAiDraft("");
                      navigate({ name: "character", characterId: character.id });
                    },
                    onError: (error) => setNotice(error.message),
                  },
                )
              }
            >
              {authorCreate.isPending ? strings.characters.writingCard : strings.characters.writeGo}
            </button>
          </div>
        </Sheet>
      ) : null}

      {promptOpen !== null ? (
        <Sheet
          title={
            promptOpen === "tag"
              ? strings.characters.bulkTag
              : promptOpen === "folder"
                ? strings.characters.bulkMove
                : strings.characters.saveFilter
          }
          onClose={() => {
            setPromptOpen(null);
            setPromptValue("");
          }}
        >
          <div className="pt-[8px] pb-[14px]">
            <input
              className="field"
              placeholder={
                promptOpen === "tag"
                  ? strings.characters.tagPrompt
                  : promptOpen === "folder"
                    ? strings.characters.folderPrompt
                    : strings.characters.filterName
              }
              value={promptValue}
              onChange={(event) => setPromptValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitPrompt();
              }}
              autoFocus
            />
            <button
              type="button"
              className="btn btn-primary mt-[10px] w-full"
              disabled={promptValue.trim() === ""}
              onClick={commitPrompt}
            >
              {strings.characters.saveFilter}
            </button>
          </div>
        </Sheet>
      ) : null}

      {menuFor !== null ? (
        <Sheet title={menuFor.name} onClose={() => setMenuFor(null)}>
          <SheetAction
            label={strings.characters.derive}
            onClick={() => {
              derive.mutate(
                {},
                {
                  onSuccess: (character) => {
                    setMenuFor(null);
                    navigate({ name: "character", characterId: character.id });
                  },
                },
              );
            }}
          />
          <SheetAction
            label={strings.characters.deleteCharacter}
            onClick={() =>
              confirm(
                strings.characters.deleteConfirm(menuFor.name),
                () => {
                  remove.mutate(menuFor.id);
                  setMenuFor(null);
                },
                { confirmLabel: strings.characters.deleteCharacter },
              )
            }
          />
        </Sheet>
      ) : null}

      {confirmNode}
      <TabBar active="characters" />
    </div>
  );
}
