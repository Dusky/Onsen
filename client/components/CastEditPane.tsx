import { useRef, useState } from "react";
import { strings } from "../strings.ts";
import { EditorField } from "./EditorField.tsx";
import { TextField } from "./TextField.tsx";
import { navigate } from "../lib/router.ts";
import { useCharacter, useSetCharacterAvatar, useUpdateCharacter } from "../lib/queries.ts";

/**
 * A character's card, editable in the right pane of the chat (SPEC §16,
 * §20 phase 82).
 *
 * The fields a reader actually changes mid-scene — who they are, how they
 * speak, the scenario — editable without leaving the log. The full editor, with
 * its tabs, sprites and greetings, stays a screen; a button opens it. The pane
 * renders the same `EditorField`s the screen does, so the two cannot drift.
 */
export function CastEditPane({
  characterId,
  onClose,
  contextSize,
}: {
  characterId: string;
  onClose(): void;
  /** The open scene's window, for the card's share of it (§20 phase 98). */
  contextSize?: number | null;
}) {
  const query = useCharacter(characterId);
  const update = useUpdateCharacter(characterId);
  const character = query.data;

  if (character === undefined) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <p className="chrome text-ui text-ink-dim">{strings.common.working}</p>
      </div>
    );
  }

  const tokens = character.tokens;

  return (
    <aside className="flex min-h-0 w-full flex-col">
      <div className="hairline flex flex-none items-center gap-[10px] px-[16px] py-[12px]">
        <button
          type="button"
          aria-label={strings.common.back}
          className="chrome flex-none text-[14px] text-ink-muted"
          onClick={onClose}
        >
          {strings.chat.back}
        </button>
        <span className="min-w-0 flex-1 truncate text-[15px] font-medium">
          {character.name}
        </span>
        {/* Export, both shapes the format knows (§20 phase 112). */}
        <a
          className="chrome flex-none text-[12px] text-ink-muted"
          href={`/api/characters/${character.id}/export?format=png`}
          download
        >
          PNG
        </a>
        <a
          className="chrome flex-none text-[12px] text-ink-muted"
          href={`/api/characters/${character.id}/export?format=json`}
          download
        >
          JSON
        </a>
        <button
          type="button"
          className="btn flex-none"
          onClick={() => navigate({ name: "character", characterId })}
        >
          {strings.characters.openEditor}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-[16px] py-[14px]">
        {/* The card's own picture, changeable here (§20 phase 112). */}
        <CharacterAvatar characterId={character.id} hasAvatar={character.hasAvatar} />

        <EditorField label={strings.characters.name}>
          <TextField value={character.name} onCommit={(name) => update.mutate({ name })} />
        </EditorField>

        <EditorField label={strings.characters.description} tokens={tokens.description}>
          <TextField
            value={character.description ?? ""}
            rows={4}
            onCommit={(description) => update.mutate({ description: description || null })}
          />
        </EditorField>

        <EditorField label={strings.characters.personality} tokens={tokens.personality}>
          <TextField
            value={character.personality ?? ""}
            rows={3}
            onCommit={(personality) => update.mutate({ personality: personality || null })}
          />
        </EditorField>

        <EditorField label={strings.characters.speech} tokens={tokens.voiceNotes}>
          <TextField
            value={character.voiceNotes ?? ""}
            rows={3}
            onCommit={(voiceNotes) => update.mutate({ voiceNotes: voiceNotes || null })}
          />
        </EditorField>

        <EditorField label={strings.characters.scenario} tokens={tokens.scenario}>
          <TextField
            value={character.scenario ?? ""}
            rows={3}
            onCommit={(scenario) => update.mutate({ scenario: scenario || null })}
          />
        </EditorField>

        {/* The card's cost as a share of the window, the same arithmetic the
            prompt panel shows, so the two agree (§20 phase 98). */}
        {contextSize !== null && contextSize !== undefined && contextSize > 0 ? (
          <p className="meta mt-[16px] border-t border-rule pt-[10px]">
            {strings.characters.cardContext(
              tokens.total,
              Math.round((tokens.total / contextSize) * 100),
            )}
          </p>
        ) : null}
      </div>
    </aside>
  );
}

/** The card's picture, changeable in the pane (§20 phase 112). */
function CharacterAvatar({ characterId, hasAvatar }: { characterId: string; hasAvatar: boolean }) {
  const set = useSetCharacterAvatar(characterId);
  const input = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState(0);
  const url = hasAvatar ? `/api/characters/${characterId}/avatar?v=${version}` : null;

  return (
    <div className="mb-[14px] flex items-center gap-[12px]">
      <span
        aria-hidden="true"
        className="h-[76px] w-[57px] flex-none border border-rule bg-cover bg-center"
        style={url !== null ? { backgroundImage: `url(${url})` } : { background: "var(--onsen-stripe)" }}
      />
      <div className="flex flex-col gap-[6px]">
        <button type="button" className="btn" onClick={() => input.current?.click()}>
          {strings.characters.changePicture}
        </button>
        {hasAvatar ? (
          <button type="button" className="btn" onClick={() => set.mutate(null)}>
            {strings.characters.removePicture}
          </button>
        ) : null}
      </div>
      <input
        ref={input}
        type="file"
        hidden
        accept="image/*"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file !== undefined) {
            set.mutate(file);
            setVersion((v) => v + 1);
          }
        }}
      />
    </div>
  );
}
