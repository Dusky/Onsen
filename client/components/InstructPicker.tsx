import { useState } from "react";
import type { InstructTemplateDto, ProviderDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { useConfirm } from "./ConfirmSheet.tsx";
import {
  useCreateInstructTemplate,
  useDeleteInstructTemplate,
  useInstructTemplates,
  useUpdateInstructTemplate,
} from "../lib/queries.ts";

/**
 * Choosing an instruct template for a text-completion provider (SPEC §4, §16).
 *
 * This is the one setting in the app where a wrong answer produces no error at
 * all. A near-miss template makes the model drift, repeat the reader, or never
 * stop — which reads as a bad model rather than as a misconfiguration — so the
 * preview is not decoration. It is the only feedback there is.
 *
 * Built-in templates can be copied but not edited: correcting a format for
 * everyone is a release, not a setting, and a user who edited ChatML in place
 * would silently change every provider using it.
 */

/** The markers, in the order they appear in a rendered prompt. */
const MARKER_FIELDS = [
  ["bos", strings.instruct.bos],
  ["systemPrefix", strings.instruct.systemPrefix],
  ["systemSuffix", strings.instruct.systemSuffix],
  ["userPrefix", strings.instruct.userPrefix],
  ["userSuffix", strings.instruct.userSuffix],
  ["assistantPrefix", strings.instruct.assistantPrefix],
  ["assistantSuffix", strings.instruct.assistantSuffix],
] as const;

/**
 * What a two-turn conversation looks like under this template.
 *
 * Rendered here rather than fetched: it is the same arithmetic as the server's
 * renderer over a fixed two-line fixture, and a round trip per keystroke to
 * show a preview would make the editor feel broken.
 */
function preview(template: InstructTemplateDto): string {
  const system = "You are an author.";
  const parts: string[] = [template.bos];
  if (template.systemInUser) {
    parts.push(template.userPrefix + system + template.systemSuffix + "Hello." + template.userSuffix);
  } else {
    parts.push(template.systemPrefix + system + template.systemSuffix);
    parts.push(template.userPrefix + "Hello." + template.userSuffix);
  }
  parts.push(template.assistantPrefix + "Hi." + template.assistantSuffix);
  parts.push(template.userPrefix + "Again." + template.userSuffix);
  parts.push(template.assistantPrefix);
  return parts.join("");
}

function MarkerField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange(next: string): void;
}) {
  return (
    <label className="min-w-0 flex-1">
      <span className="section-label mb-[4px] block">{label}</span>
      <input
        aria-label={label}
        className="chrome w-full border border-rule-strong bg-bg-input px-[8px] py-[9px] text-[11.5px] text-ink"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function InstructPicker({
  provider,
  onSelect,
  onError,
}: {
  provider: ProviderDto;
  onSelect(templateId: string | null): void;
  onError(message: string): void;
}) {
  const templates = useInstructTemplates();
  const create = useCreateInstructTemplate();
  const update = useUpdateInstructTemplate();
  const remove = useDeleteInstructTemplate();
  const [open, setOpen] = useState(false);
  const [confirmNode, confirm] = useConfirm();

  const list = templates.data ?? [];
  // Null means the shipped default, which is ChatML — shown as chosen rather
  // than as nothing, because "no template" is a different thing (`plain`) and
  // an unlabelled default is how people end up debugging the wrong problem.
  const selectedId = provider.instructTemplate ?? "chatml";
  const selected = list.find((template) => template.id === selectedId) ?? null;

  return (
    <div className="mb-[14px]">
      <p className="section-label mb-[6px]">{strings.instruct.label}</p>
      <div className="mb-[6px] flex flex-wrap gap-[6px]">
        {list.map((template) => (
          <button
            key={template.id}
            type="button"
            className={`btn ${template.id === selectedId ? "btn-primary" : ""}`}
            onClick={() => onSelect(template.id === "chatml" ? null : template.id)}
          >
            {template.name}
          </button>
        ))}
      </div>
      <p className="explain mb-[10px]">
        {strings.instruct.hint}
      </p>

      {selected === null ? null : (
        <>
          <div className="mb-[8px] flex flex-wrap gap-[6px]">
            <button
              type="button"
              className="btn"
              onClick={() =>
                create.mutate(
                  { name: strings.instruct.copyName(selected.name), copyFrom: selected.id },
                  {
                    // Selected immediately: copying is what you do when you are
                    // about to change something.
                    onSuccess: (made) => {
                      onSelect(made.id);
                      setOpen(true);
                    },
                    onError: (error: Error) => onError(error.message),
                  },
                )
              }
            >
              {strings.instruct.copy}
            </button>
            <button type="button" className="btn" onClick={() => setOpen(!open)}>
              {open ? strings.instruct.hide : strings.instruct.edit}
            </button>
            {selected.builtIn ? null : (
              <button
                type="button"
                className="btn"
                style={{ color: "var(--onsen-color-red)" }}
                onClick={() =>
                  confirm(
                    strings.instruct.removeConfirm(selected.name),
                    () =>
                      remove.mutate(selected.id, {
                        onSuccess: () => onSelect(null),
                        onError: (error: Error) => onError(error.message),
                      }),
                    { confirmLabel: strings.instruct.remove },
                  )
                }
              >
                {strings.instruct.remove}
              </button>
            )}
          </div>

          {!open ? null : (
            <div className="mb-[10px] border border-rule p-[12px]">
              {selected.builtIn ? (
                <p className="explain mb-[10px]">
                  {strings.instruct.builtInLocked}
                </p>
              ) : (
                <Editor
                  template={selected}
                  onCommit={(patch) =>
                    update.mutate(
                      { id: selected.id, ...patch },
                      { onError: (error: Error) => onError(error.message) },
                    )
                  }
                />
              )}

              {/* The only feedback there is. A near-miss template errors
                  nowhere, so seeing the actual string is the whole check. */}
              <p className="section-label mt-[10px] mb-[4px]">{strings.instruct.preview}</p>
              <pre className="chrome overflow-x-auto border border-rule bg-bg-inset p-[10px] text-[11px] leading-[1.6] whitespace-pre-wrap text-ink-muted">
                {preview(selected)}
              </pre>
            </div>
          )}
        </>
      )}
      {confirmNode}
    </div>
  );
}

/**
 * The markers, committed on blur rather than per keystroke.
 *
 * Every commit is a round trip, and a marker typed as `<|im` on the way to
 * `<|im_start|>` is a template that means something very different.
 */
function Editor({
  template,
  onCommit,
}: {
  template: InstructTemplateDto;
  onCommit(patch: Partial<InstructTemplateDto>): void;
}) {
  const [draft, setDraft] = useState<InstructTemplateDto>(template);

  function set<K extends keyof InstructTemplateDto>(field: K, value: InstructTemplateDto[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  return (
    <div onBlur={() => onCommit(draft)}>
      <p className="section-label mb-[4px]">{strings.instruct.name}</p>
      <input
        aria-label={strings.instruct.name}
        className="field mb-[10px]"
        value={draft.name}
        onChange={(event) => set("name", event.target.value)}
      />

      <div className="mb-[10px] grid grid-cols-2 gap-[8px]">
        {MARKER_FIELDS.map(([field, label]) => (
          <MarkerField
            key={field}
            label={label}
            value={draft[field]}
            onChange={(value) => set(field, value)}
          />
        ))}
      </div>
      <p className="explain mb-[10px]">
        {strings.instruct.bosHint}
      </p>

      <p className="section-label mb-[4px]">{strings.instruct.stopSequences}</p>
      <input
        aria-label={strings.instruct.stopSequences}
        className="chrome mb-[4px] w-full border border-rule-strong bg-bg-input px-[8px] py-[9px] text-[11.5px] text-ink"
        value={draft.stopSequences.join(", ")}
        onChange={(event) =>
          set(
            "stopSequences",
            event.target.value
              .split(",")
              .map((entry) => entry.trim())
              .filter((entry) => entry !== ""),
          )
        }
      />
      <p className="explain mb-[10px]">
        {strings.instruct.stopHint}
      </p>

      <button
        type="button"
        aria-pressed={draft.systemInUser}
        onClick={() => set("systemInUser", !draft.systemInUser)}
        className="flex w-full items-center justify-between gap-[10px] py-[6px] text-left"
      >
        <span className="section-label">{strings.instruct.systemInUser}</span>
        <span
          className="chrome flex-none text-[10.5px]"
          style={{
            color: draft.systemInUser ? "var(--onsen-color-red)" : "var(--onsen-color-text-dim)",
          }}
        >
          {draft.systemInUser ? strings.lore.on : strings.lore.off}
        </span>
      </button>
      <p className="explain">
        {strings.instruct.systemInUserHint}
      </p>
    </div>
  );
}
