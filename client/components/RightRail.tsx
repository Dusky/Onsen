import { useState } from "react";
import { strings } from "../strings.ts";
import { EditorField } from "./EditorField.tsx";
import { TextField } from "./TextField.tsx";
import { LorePane } from "./LorePane.tsx";
import { CastEditPane } from "./CastEditPane.tsx";
import {
  useAuthors,
  useCharacters,
  usePersonas,
  useUpdateAuthor,
  useUpdatePersona,
} from "../lib/queries.ts";
import { useUiStore } from "../state/ui.ts";
import { PERSONA_DEPTH_BOUNDS, type AuthorDto, type PersonaDto } from "@shared/types.ts";

/**
 * The global right rail (SPEC §16, §20 phase 87).
 *
 * On every desktop page unless collapsed. The entities a reader manages —
 * the cast (characters), the author, the lore and the persona — live here, and
 * while a scene is open a *Scene* tab carries its context, cast and persona,
 * fed in by the chat screen. The left rail holds the configuration; this holds
 * the people and the world.
 */

type RailTab = "cast" | "author" | "lore" | "you" | "scene";

export function RightRail() {
  const { rightRailOpen, toggleRightRail, sceneInspector } = useUiStore();
  const [tab, setTab] = useState<RailTab>("cast");

  const active: RailTab =
    tab === "scene" && sceneInspector === null ? "cast" : tab;

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
    ["cast", strings.nav.characters],
    ["author", strings.nav.authors],
    ["lore", strings.nav.lore],
    ["you", strings.chat.inspectorTabPersona],
    ...(sceneInspector === null ? [] : ([["scene", strings.chat.inspectorTabScene]] as [RailTab, string][])),
  ];

  return (
    <aside className="flex w-[364px] flex-none flex-col border-l border-rule bg-bg-sunken">
      <div className="hairline flex flex-none items-center justify-between pr-[8px]">
        <div className="flex min-w-0 items-stretch">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={active === id ? "true" : undefined}
              className="chrome flex min-h-[44px] items-center px-[12px] text-[12.5px]"
              style={{
                color: active === id ? "var(--onsen-color-text)" : "var(--onsen-color-text-dim)",
                borderBottom: `2px solid ${active === id ? "var(--onsen-color-red)" : "transparent"}`,
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
        {active === "cast" ? <CharacterPane /> : null}
        {active === "author" ? <AuthorPane /> : null}
        {active === "lore" ? <LorePane /> : null}
        {active === "you" ? <PersonaPane /> : null}
        {active === "scene" ? sceneInspector : null}
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

function PersonaPane() {
  const personas = usePersonas();
  const [editingId, setEditingId] = useState<string | null>(null);
  const persona = (personas.data ?? []).find((candidate) => candidate.id === editingId) ?? null;

  if (persona !== null) {
    return <PersonaEdit persona={persona} onClose={() => setEditingId(null)} />;
  }

  return (
    <div className="px-[16px] py-[14px]">
      {(personas.data ?? []).map((candidate) => (
        <button
          key={candidate.id}
          type="button"
          onClick={() => setEditingId(candidate.id)}
          className="row flex w-full items-baseline gap-[10px] text-left"
        >
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
            {candidate.name}
          </span>
          {candidate.isDefault ? <span className="meta flex-none">{strings.settings.presetIsDefault}</span> : null}
        </button>
      ))}
    </div>
  );
}

function PersonaEdit({ persona, onClose }: { persona: PersonaDto; onClose(): void }) {
  const update = useUpdatePersona(persona.id);
  return (
    <div className="px-[16px] py-[14px]">
      <button type="button" className="chrome mb-[10px] text-[12.5px] text-ink-muted" onClick={onClose}>
        {strings.chat.back}
      </button>

      <EditorField label={strings.sceneSetup.personaName}>
        <TextField value={persona.name} onCommit={(name) => update.mutate({ name })} />
      </EditorField>
      <EditorField label={strings.sceneSetup.personaDescription}>
        <TextField
          value={persona.description ?? ""}
          rows={4}
          placeholder={strings.sceneSetup.personaDescriptionPlaceholder}
          onCommit={(description) => update.mutate({ description: description || null })}
        />
      </EditorField>
      <EditorField label={strings.sceneSetup.personaPosition}>
        <div className="flex items-center gap-[10px]">
          <button
            type="button"
            className={`btn flex-none ${persona.depth === null ? "btn-primary" : ""}`}
            onClick={() => update.mutate({ depth: persona.depth === null ? 0 : null })}
          >
            {persona.depth === null
              ? strings.sceneSetup.personaPositionPrefix
              : strings.sceneSetup.personaPositionDepth(persona.depth)}
          </button>
          {persona.depth === null ? null : (
            <input
              type="range"
              className="min-w-0 flex-1"
              min={PERSONA_DEPTH_BOUNDS.min}
              max={PERSONA_DEPTH_BOUNDS.max}
              step={1}
              value={persona.depth}
              aria-label={strings.sceneSetup.personaPosition}
              onChange={(event) => update.mutate({ depth: Number(event.target.value) })}
            />
          )}
        </div>
      </EditorField>
    </div>
  );
}
