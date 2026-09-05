import { useState } from "react";
import type { PersonaDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { Sheet } from "./Sheet.tsx";
import { useConfirm } from "./ConfirmSheet.tsx";
import {
  useCreatePersona,
  useDeletePersona,
  usePersonas,
  useUpdatePersona,
} from "../lib/queries.ts";

/**
 * Who the reader is (SPEC §2, §20 phase 54).
 *
 * A persona could be created from scene setup and then never touched again:
 * `useUpdatePersona` existed in the client and was called by nothing, there was
 * no delete at all, and `description` — the one field that actually reaches the
 * prompt — had nowhere to be typed. Server-side the CRUD had been complete
 * since phase 7.
 *
 * A sheet rather than a screen: personas are chosen from scene setup, so the
 * place to manage them is where they are chosen. The tab bar has five slots and
 * they are all doing something.
 */

function One({ persona, onClose }: { persona: PersonaDto; onClose(): void }) {
  const update = useUpdatePersona(persona.id);
  const remove = useDeletePersona();
  const [confirmNode, confirm] = useConfirm();

  return (
    <div className="border-b border-rule py-[14px] last:border-b-0">
      <p className="section-label mb-[6px]">{strings.sceneSetup.personaName}</p>
      <input
        className="field mb-[12px]"
        defaultValue={persona.name}
        onBlur={(event) => {
          const name = event.target.value.trim();
          if (name !== "" && name !== persona.name) update.mutate({ name });
        }}
      />

      <p className="section-label mb-[6px]">{strings.sceneSetup.personaDescription}</p>
      <textarea
        className="field mb-[12px] min-h-[92px] resize-y"
        defaultValue={persona.description ?? ""}
        placeholder={strings.sceneSetup.personaDescriptionPlaceholder}
        onBlur={(event) => {
          const description = event.target.value.trim();
          if (description !== (persona.description ?? "")) {
            update.mutate({ description: description === "" ? null : description });
          }
        }}
      />

      <div className="flex gap-[8px]">
        <button
          type="button"
          className={`btn flex-1 ${persona.isDefault ? "btn-primary" : ""}`}
          disabled={persona.isDefault}
          onClick={() => update.mutate({ isDefault: true })}
        >
          {persona.isDefault ? strings.settings.presetIsDefault : strings.sceneSetup.personaIsDefault}
        </button>
        <button
          type="button"
          className="btn flex-none"
          onClick={() =>
            confirm(
              strings.sceneSetup.personaDeleteConfirm,
              () => remove.mutate(persona.id, { onSuccess: onClose }),
              { confirmLabel: strings.common.delete },
            )
          }
        >
          {strings.common.delete}
        </button>
      </div>
      {confirmNode}
    </div>
  );
}

export function PersonaEditor({ onClose }: { onClose(): void }) {
  const personas = usePersonas();
  const create = useCreatePersona();
  const [added, setAdded] = useState<string | null>(null);
  const list = personas.data ?? [];

  return (
    <Sheet title={strings.sceneSetup.personaEdit} onClose={onClose}>
      <div className="pt-[4px] pb-[14px]">
        {list.map((persona) => (
          <One
            key={persona.id + (added === persona.id ? "-new" : "")}
            persona={persona}
            onClose={() => {
              if (list.length === 1) onClose();
            }}
          />
        ))}
        <button
          type="button"
          className="btn mt-[14px] w-full"
          disabled={create.isPending}
          onClick={() => create.mutate({}, { onSuccess: (made) => setAdded(made.id) })}
        >
          {strings.sceneSetup.personaAdd}
        </button>
      </div>
    </Sheet>
  );
}
