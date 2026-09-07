import { useState } from "react";
import { strings } from "../strings.ts";
import { EditorField } from "./EditorField.tsx";
import { TextField } from "./TextField.tsx";
import { CastEditPane } from "./CastEditPane.tsx";
import { useRoute } from "../lib/router.ts";
import {
  useAuthors,
  useCharacters,
  useCreateAuthor,
  useCreateCharacter,
  useScenes,
  useUpdateAuthor,
} from "../lib/queries.ts";
import { useUiStore } from "../state/ui.ts";
import type { AuthorDto } from "@shared/types.ts";

/**
 * The global right rail (SPEC §16, the redesign phase 90, polished phase 97).
 *
 * The mockup's right side is three flat tabs — *In this scene* (the cast,
 * scene-scoped and fed in by the chat screen), *Characters* (the library, with
 * search, a new-card button and an inline editor) and *Authors* (the same, plus
 * a live sample of the aside voice). Lore moved to the left rail's Lore
 * section, and the persona moved into the scene pane. On every desktop page
 * unless collapsed.
 */

type RailTab = "scene" | "characters" | "authors";

export function RightRail() {
  const route = useRoute();
  const { rightRailOpen, rightTab, setRightTab, toggleRightRail, sceneInspector } = useUiStore();
  const sceneId = route.name === "chat" ? route.sceneId : null;

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
        {active === "characters" ? <CharacterPane sceneId={sceneId} /> : null}
        {active === "authors" ? <AuthorPane sceneId={sceneId} /> : null}
      </div>
    </aside>
  );
}

function CharacterPane({ sceneId }: { sceneId: string | null }) {
  const characters = useCharacters();
  const scenes = useScenes();
  const create = useCreateCharacter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [needle, setNeedle] = useState("");

  if (editingId !== null) {
    return <CastEditPane characterId={editingId} onClose={() => setEditingId(null)} />;
  }

  const all = characters.data ?? [];
  const rows = all.filter(
    (character) => needle === "" || character.name.toLowerCase().includes(needle.toLowerCase()),
  );
  const inScene =
    sceneId === null
      ? new Set<string>()
      : new Set(
          (scenes.data ?? [])
            .find((scene) => scene.id === sceneId)
            ?.cast.map((member) => member.characterId) ?? [],
        );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none gap-[6px] border-b border-rule p-[10px]">
        <input
          className="field min-h-0 flex-1 py-[7px] text-[13px]"
          placeholder={strings.characters.searchPlaceholder}
          value={needle}
          onChange={(event) => setNeedle(event.target.value)}
        />
        <button
          type="button"
          className="btn flex-none px-[10px]"
          disabled={create.isPending}
          onClick={() =>
            create.mutate({}, { onSuccess: (made) => setEditingId(made.id) })
          }
        >
          {strings.characters.create}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-[10px] py-[8px]">
        {rows.length === 0 ? (
          <p className="explain">{strings.characters.empty}</p>
        ) : null}
        {rows.filter((character) => inScene.has(character.id)).length > 0 ? (
          <>
            <p className="section-label mt-[6px] mb-[4px]">{strings.rightRail.inThisScene}</p>
            {rows
              .filter((character) => inScene.has(character.id))
              .map((character) => (
                <CharacterRow
                  key={character.id}
                  character={character}
                  badge={strings.rightRail.inScene}
                  onOpen={() => setEditingId(character.id)}
                />
              ))}
          </>
        ) : null}
        {rows.filter((character) => !inScene.has(character.id)).length > 0 ? (
          <>
            <p className="section-label mt-[10px] mb-[4px]">{strings.characters.title}</p>
            {rows
              .filter((character) => !inScene.has(character.id))
              .map((character) => (
                <CharacterRow
                  key={character.id}
                  character={character}
                  onOpen={() => setEditingId(character.id)}
                />
              ))}
          </>
        ) : null}
      </div>
    </div>
  );
}

function CharacterRow({
  character,
  badge,
  onOpen,
}: {
  character: { id: string; name: string; tokens: { total: number } };
  badge?: string;
  onOpen(): void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="row flex w-full items-baseline gap-[10px] text-left"
    >
      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{character.name}</span>
      {badge === undefined ? null : (
        <span
          className="chrome flex-none text-[11px]"
          style={{ color: "var(--onsen-color-amber)" }}
        >
          {badge}
        </span>
      )}
      <span className="meta flex-none">{strings.characters.tokens(character.tokens.total)}</span>
    </button>
  );
}

function AuthorPane({ sceneId }: { sceneId: string | null }) {
  const authors = useAuthors();
  const scenes = useScenes();
  const create = useCreateAuthor();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [needle, setNeedle] = useState("");

  const author = (authors.data ?? []).find((candidate) => candidate.id === editingId) ?? null;
  if (author !== null) {
    return <AuthorEdit author={author} onClose={() => setEditingId(null)} />;
  }

  const rows = (authors.data ?? []).filter(
    (candidate) => needle === "" || candidate.name.toLowerCase().includes(needle.toLowerCase()),
  );
  const sceneAuthorId = sceneId === null ? null : (scenes.data ?? []).find((scene) => scene.id === sceneId)?.authorId ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none gap-[6px] border-b border-rule p-[10px]">
        <input
          className="field min-h-0 flex-1 py-[7px] text-[13px]"
          placeholder={strings.characters.searchPlaceholder}
          value={needle}
          onChange={(event) => setNeedle(event.target.value)}
        />
        <button
          type="button"
          className="btn flex-none px-[10px]"
          disabled={create.isPending}
          onClick={() => create.mutate({}, { onSuccess: (made) => setEditingId(made.id) })}
        >
          {strings.authors.create}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-[10px] py-[8px]">
        {rows.length === 0 ? (
          <p className="explain">{strings.authors.empty}</p>
        ) : (
          rows.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              onClick={() => setEditingId(candidate.id)}
              className="row flex w-full items-baseline gap-[10px] text-left"
            >
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
                {candidate.name}
              </span>
              {candidate.id === sceneAuthorId ? (
                <span
                  className="chrome flex-none text-[11px]"
                  style={{ color: "var(--onsen-color-amber)" }}
                >
                  {strings.rightRail.inUse}
                </span>
              ) : null}
              <span className="meta flex-none">
                {strings.characters.tokens(candidate.tokens.total)}
              </span>
            </button>
          ))
        )}
      </div>
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

      {/* A live sample in the exact treatment the aside appears in, so the voice
          is configured against something seen (§20 phase 97). */}
      <div className="mt-[16px]">
        <p className="section-label mb-[8px]">{strings.authors.sampleVoice}</p>
        <div className="pl-[18px]" style={{ borderLeft: "2px solid var(--onsen-color-blue)" }}>
          <p
            className="chrome mb-[6px] text-[12.5px]"
            style={{ color: "var(--onsen-color-blue)" }}
          >
            {author.name} · OOC
          </p>
          <div
            className="px-[11px] py-[9px]"
            style={{
              background: "var(--onsen-color-blue-bg)",
              border: "1px solid var(--onsen-color-blue-border)",
              borderRadius: "3px 12px 12px 12px",
            }}
          >
            <p
              className="chrome text-[12.5px] leading-[1.55]"
              style={{ color: "var(--onsen-color-blue-text)" }}
            >
              {author.oocVoice ?? strings.authors.sampleVoiceEmpty}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
