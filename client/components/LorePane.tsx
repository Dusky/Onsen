import { useState } from "react";
import { strings } from "../strings.ts";
import { EditorField } from "./EditorField.tsx";
import { TextField } from "./TextField.tsx";
import { useLorebook, useLorebooks, useUpdateLoreEntry } from "../lib/queries.ts";
import type { LoreEntryDto } from "@shared/types.ts";

/**
 * The lorebooks, editable in the right pane (SPEC §16, §20 phase 84).
 *
 * The world facts a scene is running on, without leaving the log: pick a book,
 * pick an entry, edit its title, keys and content in place. The full lorebook
 * editor — bindings, timed effects, the activation test — stays a screen. The
 * pane edits the three fields a reader actually touches mid-scene.
 */

function keysOf(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part !== ""),
    ),
  ];
}

export function LorePane() {
  const books = useLorebooks();
  const [bookId, setBookId] = useState<string | null>(null);
  const [entryId, setEntryId] = useState<string | null>(null);
  const book = useLorebook(bookId ?? "");

  // The entry list, with a back button to the books.
  if (bookId !== null) {
    const entry = (book.data?.entries ?? []).find((candidate) => candidate.id === entryId) ?? null;
    if (entry !== null) {
      return <EntryEdit entry={entry} onClose={() => setEntryId(null)} />;
    }
    return (
      <div className="px-[16px] py-[14px]">
        <button
          type="button"
          className="chrome mb-[10px] text-[12.5px] text-ink-muted"
          onClick={() => setBookId(null)}
        >
          {strings.chat.back} {strings.lore.books}
        </button>
        <p className="text-[14px] font-medium">{book.data?.lorebook.name ?? ""}</p>
        {(book.data?.entries ?? []).map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={() => setEntryId(row.id)}
            className="row flex w-full items-baseline gap-[10px] text-left"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px]">
                {row.title === "" ? strings.lore.untitled : row.title}
              </span>
              <span className="meta mt-[2px] block truncate">
                {row.keys.length === 0 ? strings.lore.noKeys : row.keys.join(", ")}
              </span>
            </span>
            <span className="meta flex-none">{strings.lore.tokens(row.tokenCount)}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="px-[16px] py-[14px]">
      {(books.data ?? []).map((book) => (
        <button
          key={book.id}
          type="button"
          onClick={() => setBookId(book.id)}
          className="row flex w-full items-baseline gap-[10px] text-left"
        >
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{book.name}</span>
          <span className="meta flex-none">{book.entryCount}</span>
        </button>
      ))}
    </div>
  );
}

function EntryEdit({ entry, onClose }: { entry: LoreEntryDto; onClose(): void }) {
  const update = useUpdateLoreEntry(entry.lorebookId);
  return (
    <div className="px-[16px] py-[14px]">
      <button
        type="button"
        className="chrome mb-[10px] text-[12.5px] text-ink-muted"
        onClick={onClose}
      >
        {strings.chat.back}
      </button>

      <EditorField label={strings.lore.entryTitle}>
        <TextField
          value={entry.title}
          onCommit={(title) => update.mutate({ entryId: entry.id, title })}
        />
      </EditorField>

      <EditorField label={strings.lore.keys} hint={strings.lore.keysHint}>
        <TextField
          value={entry.keys.join(", ")}
          onCommit={(raw) => update.mutate({ entryId: entry.id, keys: keysOf(raw) })}
        />
      </EditorField>

      <EditorField label={strings.lore.content}>
        <TextField
          value={entry.content}
          rows={5}
          placeholder={strings.lore.contentPlaceholder}
          onCommit={(content) => update.mutate({ entryId: entry.id, content })}
        />
      </EditorField>
    </div>
  );
}
