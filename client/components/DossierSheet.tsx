import { useState } from "react";
import type { DossierDto, DossierProposalDto, RecurringNameDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { Sheet } from "./Sheet.tsx";
import { useConfirm } from "./ConfirmSheet.tsx";

/**
 * Character dossiers (SPEC §11, §20 phase 32).
 *
 * For the characters who arrived during play — the innkeeper who turned out to
 * matter. Three things in one sheet, in the order the feature happens: who the
 * scene keeps naming, who already has a sheet, and the sheet itself.
 *
 * The field the reader most needs to trust is `injected` — exactly what the
 * prompt gets. It is shown rather than described, because the claim that the
 * buried tier is withheld is the kind of claim a hint cannot make credible.
 */

const EMPTY: DossierProposalDto = {
  name: "",
  role: "",
  voice: "",
  canonLock: "",
  knowledge: { public: "", private: "", buried: "" },
  standing: "",
};

function Field({
  label,
  hint,
  value,
  rows = 2,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  rows?: number;
  onChange(next: string): void;
}) {
  return (
    <div className="mb-[12px]">
      <p className="section-label mb-[5px]">{label}</p>
      <textarea
        rows={rows}
        aria-label={label}
        className="field resize-none py-[10px]"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint === undefined ? null : (
        <p className="explain mt-[4px]">{hint}</p>
      )}
    </div>
  );
}

export function DossierSheet({
  dossiers,
  recurring,
  working,
  error,
  onWrite,
  onSave,
  onUpdate,
  onDelete,
  onPromote,
  onClose,
}: {
  dossiers: DossierDto[];
  recurring: RecurringNameDto[];
  /** The name currently being written by the model, or null. */
  working: string | null;
  error: string | null;
  onWrite(name: string): void;
  onSave(dossier: DossierProposalDto & { mentions?: number }): void;
  onUpdate(id: string, patch: Partial<DossierProposalDto>): void;
  onDelete(id: string): void;
  onPromote(id: string): void;
  onClose(): void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<DossierProposalDto>(EMPTY);
  const [confirmNode, confirm] = useConfirm();

  function open(dossier: DossierDto) {
    setEditing(dossier.id);
    setDraft({
      name: dossier.name,
      role: dossier.role,
      voice: dossier.voice,
      canonLock: dossier.canonLock,
      knowledge: dossier.knowledge,
      standing: dossier.standing,
    });
  }

  const open_ = dossiers.find((row) => row.id === editing) ?? null;

  return (
    <Sheet
      title={strings.dossiers.title}
      meta={strings.dossiers.count(dossiers.length)}
      onClose={onClose}
    >
      <p className="explain mb-[12px]">
        {strings.dossiers.hint}
      </p>

      {error === null ? null : (
        <p className="explain explain-alert mb-[12px]">{error}</p>
      )}

      {/* Who the scene keeps naming. The offer is the feature: a dossier the
          reader has to think to ask for is a dossier nobody writes. */}
      {recurring.length === 0 ? null : (
        <>
          <p className="section-label mb-[6px]">{strings.dossiers.noticed}</p>
          <div className="mb-[16px] flex flex-wrap gap-[6px]">
            {recurring.map((row) => (
              <button
                key={row.name}
                type="button"
                className="btn"
                disabled={working !== null}
                onClick={() => onWrite(row.name)}
              >
                {working === row.name
                  ? strings.dossiers.writing
                  : `${row.name} · ${strings.dossiers.mentions(row.mentions)}`}
              </button>
            ))}
          </div>
        </>
      )}

      {open_ === null ? (
        <>
          <p className="section-label mb-[6px]">{strings.dossiers.written}</p>
          {dossiers.length === 0 ? (
            <p className="chrome mb-[12px] text-[11.5px] tracking-[0.12em] text-ink-dim uppercase">
              {strings.dossiers.empty}
            </p>
          ) : null}
          {dossiers.map((dossier) => (
            <button
              key={dossier.id}
              type="button"
              onClick={() => open(dossier)}
              className="flex w-full items-baseline gap-[10px] border-b border-rule py-[12px] text-left"
              // A promoted dossier is history rather than machinery: it is not
              // injected any more, and reads as spent.
              style={dossier.promoted ? { opacity: 0.55 } : undefined}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px]">{dossier.name}</span>
                <span className="meta mt-[4px] block truncate">
                  {dossier.promoted
                    ? strings.dossiers.promoted
                    : (dossier.role || strings.dossiers.noRole)}
                </span>
              </span>
              <span className="meta flex-none">
                {dossier.entry === null ? "" : strings.characters.tokens(dossier.entry.tokenCount)}
              </span>
            </button>
          ))}

          <button
            type="button"
            className="btn mt-[14px] w-full"
            onClick={() => {
              setDraft(EMPTY);
              setEditing("");
            }}
          >
            {strings.dossiers.write}
          </button>
        </>
      ) : null}

      {/* The blank form, for a character the detector never noticed. */}
      {editing === "" ? (
        <DossierForm
          draft={draft}
          onChange={setDraft}
          onCancel={() => setEditing(null)}
          onSubmit={() => {
            if (draft.name.trim() === "") return;
            onSave(draft);
            setEditing(null);
          }}
          submitLabel={strings.dossiers.save}
        />
      ) : null}

      {open_ === null ? null : (
        <>
          <DossierForm
            draft={draft}
            onChange={setDraft}
            onCancel={() => setEditing(null)}
            onSubmit={() => {
              onUpdate(open_.id, draft);
              setEditing(null);
            }}
            submitLabel={strings.dossiers.save}
          />

          {/* What the prompt actually gets. Shown rather than described: the
              buried tier's absence is the point, and a hint claiming it is not
              the same as seeing it missing. */}
          <p className="section-label mt-[14px] mb-[5px]">{strings.dossiers.injected}</p>
          <pre className="chrome overflow-x-auto border border-rule bg-bg-inset p-[10px] text-[11px] leading-[1.6] whitespace-pre-wrap text-ink-muted">
            {open_.injected === "" ? strings.dossiers.injectedEmpty : open_.injected}
          </pre>
          <p className="explain mt-[4px] mb-[14px]">
            {strings.dossiers.buriedHint}
          </p>

          <div className="flex gap-[8px]">
            {open_.promoted ? (
              <p className="chrome flex-1 py-[12px] text-[10.5px] tracking-[0.1em] text-ink-dim uppercase">
                {strings.dossiers.promoted}
              </p>
            ) : (
              <button
                type="button"
                className="btn flex-1"
                onClick={() =>
                  confirm(
                    strings.dossiers.promoteConfirm(open_.name),
                    () => {
                      onPromote(open_.id);
                      setEditing(null);
                    },
                    { confirmLabel: strings.dossiers.promote },
                  )
                }
              >
                {strings.dossiers.promote}
              </button>
            )}
            <button
              type="button"
              className="btn flex-none"
              style={{ color: "var(--onsen-color-red)" }}
              onClick={() =>
                confirm(
                  strings.dossiers.deleteConfirm(open_.name),
                  () => {
                    onDelete(open_.id);
                    setEditing(null);
                  },
                  { confirmLabel: strings.dossiers.delete },
                )
              }
            >
              {strings.dossiers.delete}
            </button>
          </div>
        </>
      )}

      {confirmNode}
    </Sheet>
  );
}

function DossierForm({
  draft,
  onChange,
  onCancel,
  onSubmit,
  submitLabel,
}: {
  draft: DossierProposalDto;
  onChange(next: DossierProposalDto): void;
  onCancel(): void;
  onSubmit(): void;
  submitLabel: string;
}) {
  const set = <K extends keyof DossierProposalDto>(key: K, value: DossierProposalDto[K]) =>
    onChange({ ...draft, [key]: value });

  return (
    <div className="pt-[8px]">
      <div className="mb-[12px]">
        <p className="section-label mb-[5px]">{strings.dossiers.name}</p>
        <input
          className="field"
          aria-label={strings.dossiers.name}
          value={draft.name}
          onChange={(event) => set("name", event.target.value)}
        />
      </div>

      <Field
        label={strings.dossiers.role}
        value={draft.role}
        onChange={(value) => set("role", value)}
      />
      <Field
        label={strings.dossiers.voice}
        value={draft.voice}
        onChange={(value) => set("voice", value)}
      />
      <Field
        label={strings.dossiers.canonLock}
        hint={strings.dossiers.canonLockHint}
        value={draft.canonLock}
        onChange={(value) => set("canonLock", value)}
      />
      <Field
        label={strings.dossiers.knowledgePublic}
        value={draft.knowledge.public}
        onChange={(value) => set("knowledge", { ...draft.knowledge, public: value })}
      />
      <Field
        label={strings.dossiers.knowledgePrivate}
        value={draft.knowledge.private}
        onChange={(value) => set("knowledge", { ...draft.knowledge, private: value })}
      />
      <Field
        label={strings.dossiers.knowledgeBuried}
        hint={strings.dossiers.knowledgeBuriedHint}
        value={draft.knowledge.buried}
        onChange={(value) => set("knowledge", { ...draft.knowledge, buried: value })}
      />
      <Field
        label={strings.dossiers.standing}
        value={draft.standing}
        onChange={(value) => set("standing", value)}
      />

      <div className="flex gap-[8px] pb-[6px]">
        <button
          type="button"
          className="btn btn-primary flex-1"
          disabled={draft.name.trim() === ""}
          onClick={onSubmit}
        >
          {submitLabel}
        </button>
        <button type="button" className="btn flex-none" onClick={onCancel}>
          {strings.common.cancel}
        </button>
      </div>
    </div>
  );
}
