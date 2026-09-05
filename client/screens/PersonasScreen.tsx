import { useMemo, useState } from "react";
import type { PersonaDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { useConfirm } from "../components/ConfirmSheet.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { TabBar } from "../components/TabBar.tsx";
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
 * A screen rather than a sheet, as of phase 55. Phase 54 put this in a `Sheet`
 * on the reasoning that personas are chosen from scene setup — which is true of
 * *choosing* one and not of managing twenty-three, the number the install this
 * replaces actually carries. §16 §Density rule 3: a sheet is for a form, not
 * for a list you have to work in. Reached from scene setup rather than from the
 * tab bar, whose five slots are all doing something.
 */

function One({ persona, onClose }: { persona: PersonaDto; onClose(): void }) {
  const update = useUpdatePersona(persona.id);
  const remove = useDeletePersona();
  const [confirmNode, confirm] = useConfirm();

  return (
    <div className="row last:border-b-0">
      <p className="section-label mb-[6px]">{strings.sceneSetup.personaName}</p>
      <input
        className="field mb-[12px]"
        aria-label={strings.sceneSetup.personaName}
        defaultValue={persona.name}
        onBlur={(event) => {
          const name = event.target.value.trim();
          if (name !== "" && name !== persona.name) update.mutate({ name });
        }}
      />

      <p className="section-label mb-[6px]">{strings.sceneSetup.personaDescription}</p>
      <textarea
        className="field mb-[12px] min-h-[92px] resize-y"
        aria-label={strings.sceneSetup.personaDescription}
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

/** A closed persona: who they are, in one row (§16 §Density). */
function Row({ persona, onOpen }: { persona: PersonaDto; onOpen(): void }) {
  return (
    <button type="button" onClick={onOpen} className="row flex w-full items-baseline gap-[10px] text-left">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{persona.name}</span>
        <span className="meta mt-[2px] block truncate">
          {persona.description ?? strings.sceneSetup.personaNoDescription}
        </span>
      </span>
      {persona.isDefault ? (
        <span className="meta flex-none" style={{ color: "var(--onsen-color-red)" }}>
          {strings.settings.presetIsDefault}
        </span>
      ) : null}
    </button>
  );
}

export function PersonasScreen() {
  const personas = usePersonas();
  const create = useCreatePersona();
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const all = personas.data ?? [];

  // Client-side for the same reason the roleplay list is: the whole list is
  // already here and already rendered, so a server filter would buy a round
  // trip and change nothing.
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return all;
    return all.filter((persona) =>
      `${persona.name} ${persona.description ?? ""}`.toLowerCase().includes(needle),
    );
  }, [all, query]);

  return (
    <div className="flex screen-height flex-col bg-bg">
      <header
        className="screen-header screen-header-wide hairline flex-none px-[22px] pb-[14px]"
        style={{ paddingTop: "calc(22px + env(safe-area-inset-top))" }}
      >
        <p className="screen-kicker">{strings.sceneSetup.personaKicker}</p>
        <div className="mt-[6px] flex items-baseline justify-between gap-[12px]">
          <h1 className="screen-title">{strings.sceneSetup.personaTitle}</h1>
          {all.length === 0 ? null : (
            <span className="meta shrink-0 tabular-nums">{strings.showing(shown.length, all.length)}</span>
          )}
        </div>
      </header>

      {all.length < 6 ? null : (
        <div className="hairline flex-none px-[22px] pb-[11px]">
          <div className="mx-auto w-full max-w-[var(--onsen-list-measure)]">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={strings.sceneSetup.personaSearch}
              aria-label={strings.sceneSetup.personaSearch}
              className="field"
            />
          </div>
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto px-[22px]">
        <div className="mx-auto w-full max-w-[var(--onsen-list-measure)]">
          {all.length === 0 ? (
            <EmptyState
              title={strings.sceneSetup.personaEmpty}
              actions={[{ label: strings.sceneSetup.personaAdd, onClick: () => create.mutate({}) }]}
            />
          ) : null}

          {shown.map((persona) =>
            persona.id === openId ? (
              <One key={persona.id} persona={persona} onClose={() => setOpenId(null)} />
            ) : (
              <Row key={persona.id} persona={persona} onOpen={() => setOpenId(persona.id)} />
            ),
          )}

          {all.length === 0 ? null : (
            <button
              type="button"
              className="btn mt-[14px] mb-[18px] w-full"
              disabled={create.isPending}
              onClick={() => create.mutate({}, { onSuccess: (made) => setOpenId(made.id) })}
            >
              {strings.sceneSetup.personaAdd}
            </button>
          )}
        </div>
      </main>

      <TabBar active="scenes" />
    </div>
  );
}
