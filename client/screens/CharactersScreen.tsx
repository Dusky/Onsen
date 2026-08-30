import { useMemo, useRef, useState } from "react";
import type { CharacterDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { navigate } from "../lib/router.ts";
import { useCharacters, useCreateCharacter, useImportCharacter } from "../lib/queries.ts";
import { TabBar } from "../components/TabBar.tsx";
import { Notice } from "../components/Notice.tsx";

/**
 * The character library: a three-column grid of cards.
 *
 * Where a card has no image, the tile shows the diagonal-stripe placeholder the
 * design uses everywhere for user-supplied imagery, rather than an invented
 * silhouette.
 */

function Tile({ character }: { character: CharacterDto }) {
  return (
    <button
      type="button"
      onClick={() => navigate({ name: "character", characterId: character.id })}
      className="text-left"
    >
      <div
        className="h-[128px] w-full border border-rule bg-cover bg-center"
        style={
          character.hasAvatar
            ? { backgroundImage: `url(/api/characters/${character.id}/avatar)` }
            : { background: "var(--onsen-stripe)" }
        }
      />
      <p className="mt-[7px] truncate text-[14px] font-medium">{character.name}</p>
      <p className="chrome mt-[2px] text-[8.5px] tracking-[0.06em] text-ink-dim uppercase">
        {strings.characters.tokens(character.tokens.total)}
      </p>
    </button>
  );
}

export function CharactersScreen() {
  const characters = useCharacters();
  const importCard = useImportCharacter();
  const create = useCreateCharacter();
  const [filter, setFilter] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Full-text search, tags, saved filters and bulk operations are the library
  // at scale (SPEC §9, phase 24). A name filter is what this phase needs.
  const shown = useMemo(() => {
    const list = characters.data ?? [];
    const needle = filter.trim().toLowerCase();
    return needle === ""
      ? list
      : list.filter((character) => character.name.toLowerCase().includes(needle));
  }, [characters.data, filter]);

  function onFile(file: File | undefined) {
    if (file === undefined) return;
    setNotice(null);
    importCard.mutate(file, {
      onSuccess: (result) => {
        // Stay on the library rather than jumping into the editor: importing
        // several cards in a row is the common case, and being thrown into an
        // editor after each one makes that tedious.
        setNotice(
          [strings.characters.imported(result.character.name), ...result.warnings].join(" "),
        );
      },
      onError: (error) => setNotice(error.message),
    });
  }

  return (
    <div className="flex screen-height flex-col bg-bg">
      <header
        className="screen-header hairline flex-none px-[22px] pb-[14px]"
        style={{ paddingTop: "calc(22px + env(safe-area-inset-top))" }}
      >
        <p className="screen-kicker">{strings.characters.kicker}</p>
        <h1 className="screen-title mt-[6px]">{strings.characters.title}</h1>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-[22px] py-[14px]">
        <div className="mx-auto w-full max-w-[var(--onsen-prose-measure)]">
          {notice !== null ? <Notice>{notice}</Notice> : null}

          <input
            className="field mb-[16px]"
            placeholder={strings.characters.searchPlaceholder}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            aria-label={strings.characters.search}
          />

          {characters.data !== undefined && characters.data.length === 0 ? (
            <p className="chrome text-[10px] tracking-[0.14em] text-ink-dim uppercase">
              {strings.characters.empty}
            </p>
          ) : null}

          {characters.data !== undefined && characters.data.length > 0 && shown.length === 0 ? (
            <p className="chrome text-[10px] tracking-[0.14em] text-ink-dim uppercase">
              {strings.characters.noResults}
            </p>
          ) : null}

          <div className="grid grid-cols-3 gap-x-[10px] gap-y-[12px]">
            {shown.map((character) => (
              <Tile key={character.id} character={character} />
            ))}
          </div>
        </div>
      </main>

      <footer className="flex-none border-t border-rule bg-bg-raised px-[22px] py-[12px]">
        <div className="mx-auto flex w-full max-w-[var(--onsen-prose-measure)] gap-[8px]">
          <input
            ref={fileInput}
            type="file"
            hidden
            accept=".png,.charx,.json,image/png,application/zip,application/json"
            onChange={(event) => {
              onFile(event.target.files?.[0]);
              // Reset so re-picking the same file fires a change event again.
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
      </footer>

      <TabBar active="characters" />
    </div>
  );
}
