import { strings } from "../strings.ts";
import { EditorField } from "./EditorField.tsx";
import { TextField } from "./TextField.tsx";
import { navigate } from "../lib/router.ts";
import { useCharacter, useUpdateCharacter } from "../lib/queries.ts";

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
}: {
  characterId: string;
  onClose(): void;
}) {
  const query = useCharacter(characterId);
  const update = useUpdateCharacter(characterId);
  const character = query.data;

  if (character === undefined) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <p className="chrome text-[12.5px] text-ink-dim">{strings.common.working}</p>
      </div>
    );
  }

  const tokens = character.tokens;

  return (
    <aside className="flex w-[420px] flex-none flex-col border-l border-rule bg-bg-sunken">
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
        <button
          type="button"
          className="btn flex-none"
          onClick={() => navigate({ name: "character", characterId })}
        >
          {strings.characters.openEditor}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-[16px] py-[14px]">
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
      </div>
    </aside>
  );
}
