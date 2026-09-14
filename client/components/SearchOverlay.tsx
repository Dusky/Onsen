import { useMemo, useRef, useState } from "react";
import { strings } from "../strings.ts";
import { useModalFocus } from "../lib/modal.ts";
import { navigate } from "../lib/router.ts";
import { useUiStore } from "../state/ui.ts";
import {
  useAuthors,
  useCharacters,
  useLorebooks,
  usePersonas,
  useScenes,
} from "../lib/queries.ts";

/**
 * Global search (phase 211): one box that finds anything in the library.
 *
 * The command palette answers "what can I do"; this answers "where is the
 * thing". It searches the already-fetched lists — roleplays, characters,
 * lorebooks, personas, authors — and jumps to the result. The install is
 * single-user and small enough that a client-side filter over cached lists is
 * the honest implementation; a server index can come the day a library is
 * large enough to need one.
 */

interface Hit {
  kind: "scene" | "character" | "lorebook" | "persona" | "author";
  id: string;
  title: string;
  sub: string;
  go(): void;
}

export function SearchOverlay() {
  const open = useUiStore((state) => state.searchOpen);
  const close = () => useUiStore.getState().setSearchOpen(false);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const dialog = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const scenes = useScenes().data ?? [];
  const characters = useCharacters().data ?? [];
  const lorebooks = useLorebooks().data ?? [];
  const personas = usePersonas().data ?? [];
  const authors = useAuthors().data ?? [];

  useModalFocus(dialog, close);

  const hits = useMemo<Hit[]>(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return [];
    const match = (text: string | null | undefined) =>
      (text ?? "").toLowerCase().includes(needle);

    const out: Hit[] = [];
    for (const scene of scenes) {
      if (match(scene.title)) {
        out.push({
          kind: "scene",
          id: scene.id,
          title: scene.title === "" ? strings.scenes.untitled : scene.title,
          sub: scene.lastLine ?? "",
          go: () => navigate({ name: "chat", sceneId: scene.id }),
        });
      }
    }
    for (const character of characters) {
      if (match(character.name)) {
        out.push({
          kind: "character",
          id: character.id,
          title: character.name,
          sub: character.folder ?? "",
          go: () => navigate({ name: "character", characterId: character.id }),
        });
      }
    }
    for (const book of lorebooks) {
      if (match(book.name)) {
        out.push({
          kind: "lorebook",
          id: book.id,
          title: book.name,
          sub: strings.search.lorebook,
          go: () => navigate({ name: "lorebook", bookId: book.id }),
        });
      }
    }
    for (const persona of personas) {
      if (match(persona.name)) {
        out.push({
          kind: "persona",
          id: persona.id,
          title: persona.name,
          sub: strings.search.persona,
          go: () => navigate({ name: "personas" }),
        });
      }
    }
    for (const author of authors) {
      if (match(author.name)) {
        out.push({
          kind: "author",
          id: author.id,
          title: author.name,
          sub: strings.search.author,
          go: () => navigate({ name: "author", authorId: author.id }),
        });
      }
    }
    return out.slice(0, 60);
  }, [query, scenes, characters, lorebooks, personas, authors]);

  if (!open) return null;

  const run = (hit: Hit) => {
    hit.go();
    close();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-[16px] pt-[64px]"
      style={{ background: "rgba(12, 10, 8, 0.62)" }}
      onClick={close}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={strings.search.title}
        tabIndex={-1}
        className="flex max-h-[70vh] w-full max-w-[620px] flex-col border"
        style={{ background: "var(--onsen-color-bg-raised)", borderColor: "var(--onsen-color-rule-strong)" }}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setAt((n) => Math.min(hits.length - 1, n + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setAt((n) => Math.max(0, n - 1));
          } else if (event.key === "Enter") {
            if (event.target instanceof HTMLButtonElement) return;
            event.preventDefault();
            const hit = hits[at];
            if (hit !== undefined) run(hit);
          } else if (event.key === "Escape") {
            close();
          }
        }}
      >
        <div className="hairline flex flex-none items-center gap-[11px] px-[16px] py-[13px]">
          <span className="chrome text-[13px] text-ink-dim">{"\u2315"}</span>
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setAt(0);
            }}
            placeholder={strings.search.placeholder}
            aria-label={strings.search.placeholder}
            className="chrome min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder:text-ink-dim"
          />
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
          {query.trim() === "" ? (
            <p className="chrome px-[16px] py-[18px] text-ui-loose text-ink-dim">
              {strings.search.hint}
            </p>
          ) : hits.length === 0 ? (
            <p className="chrome px-[16px] py-[18px] text-ui-loose text-ink-dim">
              {strings.search.empty}
            </p>
          ) : (
            hits.map((hit, index) => (
              <button
                key={`${hit.kind}:${hit.id}`}
                type="button"
                data-at={index === at}
                onMouseEnter={() => setAt(index)}
                onClick={() => run(hit)}
                className="flex min-h-[44px] w-full items-center gap-[12px] px-[16px] py-[9px] text-left"
                style={{
                  background: index === at ? "var(--onsen-color-blue-bg)" : "transparent",
                  borderLeft: `2px solid ${index === at ? "var(--onsen-color-blue)" : "transparent"}`,
                }}
              >
                <span
                  className="chrome flex-none text-[11px]"
                  style={{ color: "var(--onsen-color-text-dim)" }}
                >
                  {strings.search.kinds[hit.kind]}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className="block truncate text-ui"
                    style={{ color: index === at ? "var(--onsen-color-text)" : "var(--onsen-color-text-label)" }}
                  >
                    {hit.title}
                  </span>
                  {hit.sub === "" ? null : (
                    <span className="block truncate text-[12px] text-ink-dim">{hit.sub}</span>
                  )}
                </span>
              </button>
            ))
          )}
        </div>

        <div className="flex flex-none items-center gap-[16px] border-t border-rule px-[16px] py-[9px]">
          <span className="chrome text-[12px] text-ink-dim">{strings.chat.paletteHintMove}</span>
          <span className="chrome text-[12px] text-ink-dim">{strings.chat.paletteHintRun}</span>
          <span className="chrome text-[12px] text-ink-dim">{strings.chat.paletteHintClose}</span>
        </div>
      </div>
    </div>
  );
}
