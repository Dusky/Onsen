import { useState } from "react";
import { strings } from "../strings.ts";
import { EditorField } from "./EditorField.tsx";
import { TextField } from "./TextField.tsx";
import { CastEditPane } from "./CastEditPane.tsx";
import { useAuthors, useCharacters, useUpdateAuthor } from "../lib/queries.ts";
import { useUiStore } from "../state/ui.ts";
import type { AuthorDto } from "@shared/types.ts";

/**
 * The global right rail (SPEC §16, the redesign phase 90).
 *
 * The mockup's right side is three flat tabs, not the workbench's five —
 * *In this scene* (the cast, scene-scoped and fed in by the chat screen),
 * *Characters* (the library with an inline editor) and *Authors* (the authors
 * with an inline editor). Lore moved to the left rail's Lore section, and the
 * persona moved into the scene pane — the reader is part of the scene, not a
 * separate tab. On every desktop page unless collapsed.
 */

type RailTab = "scene" | "characters" | "authors";

export function RightRail() {
  const { rightRailOpen, rightTab, setRightTab, toggleRightRail, sceneInspector } = useUiStore();

  const active: RailTab = rightTab === "scene" && sceneInspector === null ? "characters" : rightTab;

  if (!rightRailOpen) {
    return (
      <aside className="flex w-[34px] flex-none flex-col items-center border-l border-rule bg-bg-sunken py-[10px]">
        <button
          type="button"
          aria-label={strings.settings.railOpen}
          onClick={toggleRightRail}
          className="chrome flex h-[34px] w-[30px] items-center justify-center text-[13px] text-ink-muted"
        >
          {"\u2039"}
        </button>
      </aside>
    );
  }

  const tabs: [RailTab, string][] = [
    ["scene", strings.rightRail.inThisScene],
    ["characters", strings.rightRail.characters],
    ["authors", strings.rightRail.authors],
  ];

  return (
    <aside className="flex w-[352px] flex-none flex-col border-l border-rule bg-bg-sunken">
      <div className="hairline flex flex-none items-center justify-between pr-[8px]">
        <div className="flex min-w-0 items-stretch">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setRightTab(id)}
              aria-current={active === id ? "true" : undefined}
              className="chrome flex min-h-[44px] items-center px-[12px] text-[12.5px]"
              style={{
                color: active === id ? "var(--onsen-color-text)" : "var(--onsen-color-text-dim)",
                borderBottom: `2px solid ${active === id ? "var(--onsen-color-blue)" : "transparent"}`,
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label={strings.settings.railClose}
          onClick={toggleRightRail}
          className="chrome flex h-[28px] w-[28px] flex-none items-center justify-center text-[13px] text-ink-muted"
        >
          {"\u203a"}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {active === "scene" ? (
          sceneInspector ?? <p className="explain px-[16px] py-[14px]">{strings.rightRail.noScene}</p>
        ) : null}
        {active === "characters" ? <CharacterPane /> : null}
        {active === "authors" ? <AuthorPane /> : null}
      </div>
    </aside>
  );
}

function CharacterPane() {
  const characters = useCharacters();
  const [editingId, setEditingId] = useState<string | null>(null);

  if (editingId !== null) {
    return <CastEditPane characterId={editingId} onClose={() => setEditingId(null)} />;
  }

  return (
    <div className="px-[16px] py-[14px]">
      {(characters.data ?? []).map((character) => (
        <button
          key={character.id}
          type="button"
          onClick={() => setEditingId(character.id)}
          className="row flex w-full items-baseline gap-[10px] text-left"
        >
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
            {character.name}
          </span>
          <span className="meta flex-none">{strings.characters.tokens(character.tokens.total)}</span>
        </button>
      ))}
    </div>
  );
}

function AuthorPane() {
  const authors = useAuthors();
  const [editingId, setEditingId] = useState<string | null>(null);
  const author = (authors.data ?? []).find((candidate) => candidate.id === editingId) ?? null;

  if (author !== null) {
    return <AuthorEdit author={author} onClose={() => setEditingId(null)} />;
  }

  return (
    <div className="px-[16px] py-[14px]">
      {(authors.data ?? []).map((candidate) => (
        <button
          key={candidate.id}
          type="button"
          onClick={() => setEditingId(candidate.id)}
          className="row flex w-full items-baseline gap-[10px] text-left"
        >
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
            {candidate.name}
          </span>
          <span className="meta flex-none">
            {strings.characters.tokens(candidate.tokens.total)}
          </span>
        </button>
      ))}
    </div>
  );
}

function AuthorEdit({ author, onClose }: { author: AuthorDto; onClose(): void }) {
  const update = useUpdateAuthor(author.id);
  return (
    <div className="px-[16px] py-[14px]">
      <button type="button" className="chrome mb-[10px] text-[12.5px] text-ink-muted" onClick={onClose}>
        {strings.chat.back}
      </button>

      <EditorField label={strings.authors.name}>
        <TextField value={author.name} onCommit={(name) => update.mutate({ name })} />
      </EditorField>
      <EditorField label={strings.authors.personality} tokens={author.tokens.personality}>
        <TextField
          value={author.personality ?? ""}
          rows={4}
          onCommit={(personality) => update.mutate({ personality: personality || null })}
        />
      </EditorField>
      <EditorField label={strings.authors.writingStyle} tokens={author.tokens.writingStyle}>
        <TextField
          value={author.writingStyle ?? ""}
          rows={3}
          onCommit={(writingStyle) => update.mutate({ writingStyle: writingStyle || null })}
        />
      </EditorField>
      <EditorField label={strings.authors.directingStyle} tokens={author.tokens.directingStyle}>
        <TextField
          value={author.directingStyle ?? ""}
          rows={3}
          onCommit={(directingStyle) => update.mutate({ directingStyle: directingStyle || null })}
        />
      </EditorField>
      <EditorField label={strings.authors.oocVoice} tokens={author.tokens.oocVoice} tone="blue">
        <TextField
          value={author.oocVoice ?? ""}
          rows={3}
          onCommit={(oocVoice) => update.mutate({ oocVoice: oocVoice || null })}
        />
      </EditorField>
      <EditorField label={strings.authors.boundaries} tokens={author.tokens.boundaries} tone="red">
        <TextField
          value={author.boundaries ?? ""}
          rows={3}
          onCommit={(boundaries) => update.mutate({ boundaries: boundaries || null })}
        />
      </EditorField>
    </div>
  );
}
