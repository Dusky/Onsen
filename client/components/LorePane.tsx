import { useState } from "react";
import { strings } from "../strings.ts";
import { EditorField } from "./EditorField.tsx";
import { TextField } from "./TextField.tsx";
import { useLorebook, useLorebooks, useUpdateLorebook, useUpdateLoreEntry } from "../lib/queries.ts";
import type { LoreEntryDto, LorebookDto } from "@shared/types.ts";

/**
 * The lorebooks, editable in the left rail's Lore section (SPEC §16,
 * §20 phase 100).
 *
 * The world facts a scene runs on, without needing a roleplay open: pick a
 * book, pick an entry, edit its title, keys and content in place. The full
 * lorebook editor — bindings, timed effects, the activation test — stays a
 * screen; the rail edits the three fields a reader actually touches.
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
      <div>
        <button
          type="button"
          className="chrome mb-[10px] text-[12.5px] text-ink-muted"
          onClick={() => setBookId(null)}
        >
          {strings.chat.back} {strings.lore.books}
        </button>
        <p className="mb-[8px] text-[14px] font-medium">{book.data?.lorebook.name ?? ""}</p>
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
    <div>
      {books.data !== undefined && (books.data ?? []).length === 0 ? (
        <p className="explain">{strings.lore.empty}</p>
      ) : (
        (books.data ?? []).map((lorebook) => (
          <BookRow key={lorebook.id} book={lorebook} onOpen={() => setBookId(lorebook.id)} />
        ))
      )}
    </div>
  );
}

/** A book in the rail, with its mute switch (§20 phase 131). */
function BookRow({ book, onOpen }: { book: LorebookDto; onOpen(): void }) {
  const update = useUpdateLorebook(book.id);
  return (
    <div
      className="row flex w-full items-center gap-[10px]"
      style={book.enabled ? undefined : { opacity: 0.55 }}
    >
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[14px] font-medium">{book.name}</span>
      </button>
      <button
        type="button"
        onClick={() => update.mutate({ enabled: !book.enabled })}
        aria-pressed={book.enabled}
        className="chrome flex-none text-[12.5px]"
        style={{ color: book.enabled ? "var(--onsen-color-red)" : "var(--onsen-color-text-dim)" }}
      >
        {book.enabled ? strings.lore.on : strings.lore.off}
      </button>
      <span className="meta flex-none">{book.entryCount}</span>
    </div>
  );
}

function EntryEdit({ entry, onClose }: { entry: LoreEntryDto; onClose(): void }) {
  const update = useUpdateLoreEntry(entry.lorebookId);
  return (
    <div>
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
