import { useRef, useState } from "react";
import type { LoreBindingDto, LorebookDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { navigate } from "../lib/router.ts";
import { useCreateLorebook, useImportLorebook, useLorebooks } from "../lib/queries.ts";
import { TabBar } from "../components/TabBar.tsx";
import { Notice } from "../components/Notice.tsx";

/**
 * The lorebook library (SPEC §10, §16).
 *
 * Books are their own destination rather than a page inside a scene because
 * that is what §10 makes them: one book can be global, bound to a roleplay,
 * carried by a character and carried by a persona all at once, so there is no
 * single owner to file it under.
 *
 * Each row leads with what the book is attached to, because a book attached to
 * nothing is the single most common reason lore "does not work" — it is not a
 * matching problem, the entries never reach a prompt at all.
 */

export function bindingLabel(binding: LoreBindingDto): string {
  switch (binding.scope) {
    case "global":
      return strings.lore.bindingGlobal;
    case "scene":
      return strings.lore.bindingScene(binding.targetName ?? "—");
    case "character":
      return strings.lore.bindingCharacter(binding.targetName ?? "—");
    case "persona":
      return strings.lore.bindingPersona(binding.targetName ?? "—");
  }
}

function Row({ book }: { book: LorebookDto }) {
  return (
    <button
      type="button"
      onClick={() => navigate({ name: "lorebook", bookId: book.id })}
      className="flex w-full items-baseline gap-[10px] border-b border-rule py-[13px] text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{book.name}</span>
        <span className="meta mt-[4px] block truncate">
          {book.ownerAuthorName !== null
            ? strings.lore.ownedBy(book.ownerAuthorName)
            : book.bindings.length === 0
              ? strings.lore.unbound
              : book.bindings.map(bindingLabel).join(" · ")}
        </span>
      </span>
      <span className="meta flex-none">
        {strings.lore.entries(book.entryCount)}
      </span>
    </button>
  );
}

export function LorebooksScreen() {
  const books = useLorebooks();
  const create = useCreateLorebook();
  const importBook = useImportLorebook();
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function onFile(file: File | undefined) {
    if (file === undefined) return;
    setNotice(null);
    importBook.mutate(file, {
      // Straight into the editor, unlike a character card: an imported book is
      // almost always opened to check what survived the trip, and there is no
      // equivalent of importing twenty of them in a row.
      onSuccess: (result) => {
        setNotice(strings.lore.imported(result.lorebook.name, result.entries));
        navigate({ name: "lorebook", bookId: result.lorebook.id });
      },
      onError: (error) => setNotice(error.message),
    });
  }

  return (
    <div className="flex screen-height flex-col bg-bg">
      <header
        className="screen-header screen-header-wide hairline flex-none px-[22px] pb-[14px]"
        style={{ paddingTop: "calc(22px + env(safe-area-inset-top))" }}
      >
        <p className="screen-kicker">{strings.lore.kicker}</p>
        <h1 className="screen-title mt-[6px]">{strings.lore.title}</h1>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-[22px] py-[14px]">
        <div className="mx-auto w-full max-w-[var(--onsen-list-measure)]">
          {notice !== null ? <Notice>{notice}</Notice> : null}

          {books.data !== undefined && books.data.length === 0 ? (
            <p className="chrome text-[10px] tracking-[0.14em] text-ink-dim uppercase">
              {strings.lore.empty}
            </p>
          ) : null}

          {(books.data ?? []).map((book) => (
            <Row key={book.id} book={book} />
          ))}
        </div>
      </main>

      <footer className="flex-none border-t border-rule bg-bg-raised px-[22px] py-[12px]">
        <div className="mx-auto flex w-full max-w-[var(--onsen-list-measure)] gap-[8px]">
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              onFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            className="btn flex-1"
            disabled={importBook.isPending}
            onClick={() => fileInput.current?.click()}
          >
            {importBook.isPending ? strings.lore.importing : strings.lore.import}
          </button>
          <button
            type="button"
            className="btn btn-primary flex-1"
            onClick={() =>
              create.mutate(
                { name: "New lorebook" },
                { onSuccess: (book) => navigate({ name: "lorebook", bookId: book.id }) },
              )
            }
          >
            {strings.lore.create}
          </button>
        </div>
      </footer>

      <TabBar active="lore" />
    </div>
  );
}
