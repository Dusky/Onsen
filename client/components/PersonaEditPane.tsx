import { strings } from "../strings.ts";
import { PERSONA_DEPTH_BOUNDS } from "@shared/types.ts";
import { EditorField } from "./EditorField.tsx";
import { TextField } from "./TextField.tsx";
import { AvatarField } from "./AvatarField.tsx";
import { usePersonas, useUpdatePersona, useUpdateScene } from "../lib/queries.ts";

/**
 * The reader in this scene, editable without leaving the log (SPEC §16,
 * §20 phase 83).
 *
 * The persona is who the author is told the reader is; changing it mid-scene is
 * a direction the reader gives, not a scene configuration trip. The pane edits
 * name, description and depth, and — when the scene has none yet — offers the
 * list to pick one. The same `EditorField`s as everywhere else.
 */
export function PersonaEditPane({
  sceneId,
  personaId,
}: {
  sceneId: string;
  personaId: string | null;
}) {
  const personas = usePersonas();
  const update = useUpdatePersona(personaId ?? "");
  const scene = useUpdateScene(sceneId);
  const persona = (personas.data ?? []).find((candidate) => candidate.id === personaId) ?? null;

  if (persona === null) {
    return (
      <div className="px-[16px] py-[14px]">
        <p className="explain mb-[12px]">{strings.sceneSetup.personaNoneInScene}</p>
        {(personas.data ?? []).map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            onClick={() => scene.mutate({ personaId: candidate.id })}
            className="row flex w-full items-baseline gap-[10px] text-left"
          >
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
              {candidate.name}
            </span>
            <span className="meta flex-none">{strings.sceneSetup.personaPick}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="px-[16px] py-[14px]">
      <AvatarField kind="personas" id={persona.id} name={persona.name} hasAvatar={persona.hasAvatar} />

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

      {/* Where the block lands (§3, §20 phase 61): prefix, or a depth among
          the turns. The same control the persona screen carries. */}
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
