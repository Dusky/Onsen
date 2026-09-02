import { useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { CharacterDto, SavedFilterDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { navigate } from "../lib/router.ts";
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
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const derive = useDeriveCharacter(menuFor?.id ?? "");

  const list = characters.data ?? [];

  // The grid is virtualized (DESIGN §289): hundreds of cards, three to a row,
  // only the visible rows mounted.
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = Math.ceil(list.length / 3);
  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 175,
    overscan: 4,
  });

  function onFile(file: File | undefined) {
    if (file === undefined) return;
    setNotice(null);
    importCard.mutate(file, {
      onSuccess: (result) => {
        setNotice([strings.characters.imported(result.character.name), ...result.warnings].join(" "));
      },
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

  function promptFor(question: string, fallback: string): string | null {
    const value = window.prompt(question, fallback);
    if (value === null) return null;
    return value.trim();
  }

  return (
    <div className="flex screen-height flex-col bg-bg">
      <header
        className="screen-header hairline flex-none px-[22px] pb-[14px]"
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
        <div className="mx-auto w-full max-w-[var(--onsen-prose-measure)]">
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
                const name = promptFor(strings.characters.filterName, "");
                if (name === null || name === "") return;
                createFilter.mutate({ name, query: { q, tag, folder } });
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
              const start = row.index * 3;
              const tiles = list.slice(start, start + 3);
              return (
                <div
                  key={row.key}
                  className="absolute top-0 left-0 grid w-full grid-cols-3 gap-x-[10px] gap-y-[12px]"
                  style={{ transform: `translateY(${row.start}px)` }}
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
          <div className="mx-auto w-full max-w-[var(--onsen-prose-measure)]">
            <p className="chrome mb-[8px] text-[9px] tracking-[0.12em] text-ink-dim uppercase">
              {strings.characters.selected(selected.size)}
            </p>
            <div className="flex gap-[6px]">
              <button
                type="button"
                className="btn flex-1"
                disabled={selected.size === 0}
                onClick={() => {
                  const value = promptFor(strings.characters.tagPrompt, "");
                  if (value === null || value === "") return;
                  bulk.mutate({ ids: [...selected], op: "tag", tag: value });
                  setSelected(new Set());
                }}
              >
                {strings.characters.bulkTag}
              </button>
              <button
                type="button"
                className="btn flex-1"
                disabled={selected.size === 0}
                onClick={() => {
                  const value = promptFor(strings.characters.folderPrompt, "");
                  if (value === null) return;
                  bulk.mutate({ ids: [...selected], op: "move", folder: value });
                  setSelected(new Set());
                }}
              >
                {strings.characters.bulkMove}
              </button>
              <button
                type="button"
                className="btn flex-1"
                style={{ color: "var(--onsen-color-red)" }}
                disabled={selected.size === 0}
                onClick={() => {
                  if (!window.confirm(strings.characters.bulkDeleteConfirm(selected.size))) return;
                  bulk.mutate({ ids: [...selected], op: "delete" });
                  setSelected(new Set());
                }}
              >
                {strings.characters.bulkDelete}
              </button>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-[var(--onsen-prose-measure)] gap-[8px]">
            <input
              ref={fileInput}
              type="file"
              hidden
              accept=".png,.charx,.json,image/png,application/zip,application/json"
              onChange={(event) => {
                onFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              className="btn btn-primary flex-1"
              disabled={importCard.isPending}
              onClick={() => fileInput.current?.click()}
            >
              {importCard.isPending ? strings.characters.importing : strings.characters.import}
            </button>
            <button
              type="button"
              className="btn flex-1"
              onClick={() => setAiOpen(true)}
            >
              {strings.characters.writeWithAi}
            </button>
            <button
              type="button"
              className="btn flex-1"
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
            onClick={() => {
              if (!window.confirm(strings.characters.deleteConfirm(menuFor.name))) return;
              remove.mutate(menuFor.id);
              setMenuFor(null);
            }}
          />
        </Sheet>
      ) : null}

      <TabBar active="characters" />
    </div>
  );
}
