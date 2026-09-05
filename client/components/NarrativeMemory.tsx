import { useState } from "react";
import type { MemoryEntityDto } from "@shared/types.ts";
import { MEMORY_KINDS } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { Sheet } from "./Sheet.tsx";
import { useConfirm } from "./ConfirmSheet.tsx";
import {
  useDeleteMemoryEntity,
  useEditMemoryEntity,
  useExtractMemory,
  useMemory,
  useSetMemoryEnabled,
} from "../lib/queries.ts";

/**
 * What the scene remembers (SPEC §11 layer 3).
 *
 * Not `MemoryPanel`, which is §11 *layer 1* — the rolling summaries, in the
 * blue sheet beside the guides. Two features called memory, one layer apart:
 * that one is what the prompt carries instead of old turns, this one is a graph
 * of what the story established.
 *
 * §11's rule that a reader's edit is never overwritten is only worth having if
 * there is somewhere to edit, so this is that place. An entity the reader has
 * touched says so — the mark is the promise that the extractor will leave it
 * alone, and a promise nobody can see is not one.
 */
export function MemorySection({ sceneId }: { sceneId: string }) {
  const memory = useMemory(sceneId);
  const setEnabled = useSetMemoryEnabled(sceneId);
  const extract = useExtractMemory(sceneId);
  const [editing, setEditing] = useState<MemoryEntityDto | null>(null);

  const enabled = memory.data?.enabled ?? false;
  const entities = memory.data?.entities ?? [];

  return (
    <>
      <p className="section-label mb-[8px]">{strings.sceneSetup.memory}</p>
      <div className="mb-[8px] flex gap-[6px]">
        {[true, false].map((on) => (
          <button
            key={String(on)}
            type="button"
            onClick={() => setEnabled.mutate(on)}
            className={`btn flex-1 ${enabled === on ? "btn-primary" : ""}`}
          >
            {on ? strings.sceneSetup.memoryOn : strings.sceneSetup.memoryOff}
          </button>
        ))}
      </div>

      {enabled ? (
        <>
          {entities.length === 0 ? (
            <p className="explain mb-[10px]">
              {strings.sceneSetup.memoryEmpty}
            </p>
          ) : (
            entities.map((entity) => (
              <button
                key={entity.id}
                type="button"
                onClick={() => setEditing(entity)}
                className="w-full border-b border-rule py-[10px] text-left"
              >
                <div className="flex items-baseline justify-between gap-[10px]">
                  <span className="min-w-0 flex-1 truncate text-[15px] font-medium">
                    {entity.name}
                  </span>
                  {/* The reader's own mark, in the blue pencil: this is the app
                      saying what it will not do, not the story speaking. */}
                  {entity.userEdited ? (
                    <span className="chrome flex-none text-[10px] text-blue-text">
                      {strings.sceneSetup.memoryYours}
                    </span>
                  ) : null}
                  <span className="chrome flex-none text-[10px] text-ink-dim">
                    {strings.sceneSetup.memoryKindLabel[entity.kind] ?? entity.kind}
                  </span>
                </div>
                {entity.content === "" ? null : (
                  <p className="mt-[3px] line-clamp-2 text-[13px] leading-[1.5] text-ink-prose-muted">
                    {entity.content}
                  </p>
                )}
                <p className="meta mt-[4px]">
                  {/* Salience and how long it has been quiet, because one
                      without the other does not say what will be recalled. */}
                  {`${Math.round(entity.salience * 100)}% · ${strings.sceneSetup.memoryQuiet(entity.turnsSince)}`}
                </p>
              </button>
            ))
          )}

          <button
            type="button"
            className="btn mt-[12px] mb-[18px] w-full"
            disabled={extract.isPending}
            onClick={() => extract.mutate(undefined)}
          >
            {extract.isPending
              ? strings.sceneSetup.memoryExtracting
              : strings.sceneSetup.memoryExtract}
          </button>
        </>
      ) : (
        <div className="mb-[10px]" />
      )}

      {editing !== null ? (
        <MemoryEditor sceneId={sceneId} entity={editing} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}

function MemoryEditor({
  sceneId,
  entity,
  onClose,
}: {
  sceneId: string;
  entity: MemoryEntityDto;
  onClose(): void;
}) {
  const edit = useEditMemoryEntity(sceneId);
  const remove = useDeleteMemoryEntity(sceneId);
  const [confirmNode, confirm] = useConfirm();

  return (
    <Sheet title={entity.name} onClose={onClose}>
      <form
        className="pt-[8px] pb-[14px]"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          edit.mutate(
            {
              id: entity.id,
              name: String(form.get("name") ?? "").trim(),
              kind: String(form.get("kind") ?? entity.kind),
              content: String(form.get("content") ?? ""),
              salience: Number(form.get("salience") ?? entity.salience),
            },
            { onSuccess: () => onClose() },
          );
        }}
      >
        <p className="section-label mb-[6px]">{strings.sceneSetup.memoryName}</p>
        <input name="name" className="field mb-[16px]" defaultValue={entity.name} required />

        <p className="section-label mb-[6px]">{strings.sceneSetup.memoryKind}</p>
        <select name="kind" className="field mb-[16px]" defaultValue={entity.kind}>
          {MEMORY_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {strings.sceneSetup.memoryKindLabel[kind]}
            </option>
          ))}
        </select>

        <p className="section-label mb-[6px]">{strings.sceneSetup.memoryContent}</p>
        <textarea
          name="content"
          className="field mb-[16px] min-h-[72px]"
          defaultValue={entity.content}
        />

        <p className="section-label mb-[6px]">{strings.sceneSetup.memorySalience}</p>
        {/* `any`, not a step. Salience is a continuous score the extractor
            computed — a 0.05 grid would make the form refuse a value it had
            just been handed, which is exactly what it did the first time. */}
        <input
          name="salience"
          type="number"
          step="any"
          min="0"
          max="1"
          className="field"
          defaultValue={entity.salience}
        />

        {entity.links.length > 0 ? (
          <>
            <p className="section-label mb-[6px]">{strings.sceneSetup.memoryLinks}</p>
            {entity.links.map((link) => (
              <p key={link} className="mb-[4px] text-[13px] leading-[1.5] text-ink-prose-muted">
                {link}
              </p>
            ))}
            <div className="mb-[16px]" />
          </>
        ) : null}

        {/* Said before the button that causes it: saving is what makes this
            note the reader's, and the promise is that nothing overwrites it. */}
        <p className="chrome mb-[12px] text-[11.5px] leading-[1.6] text-blue-text">
          {strings.sceneSetup.memoryYoursHint}
        </p>

        <button type="submit" className="btn btn-primary w-full">
          {strings.settings.save}
        </button>
        <button
          type="button"
          className="btn mt-[8px] w-full"
          onClick={() =>
            confirm(
              strings.sceneSetup.memoryDeleteConfirm,
              () => remove.mutate(entity.id, { onSuccess: () => onClose() }),
              { confirmLabel: strings.sceneSetup.memoryDelete },
            )
          }
        >
          {strings.sceneSetup.memoryDelete}
        </button>
      </form>
      {confirmNode}
    </Sheet>
  );
}
