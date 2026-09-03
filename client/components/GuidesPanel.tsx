import { useState } from "react";
import { GUIDE_KINDS, type GuideDto, type GuideKind, type TaskDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { useConfirm } from "./ConfirmSheet.tsx";
import { Sheet } from "./Sheet.tsx";
import { blueOutline, blueSolid } from "./blue.ts";

/**
 * The guides panel (design screen `3f`, SPEC §8).
 *
 * Blue throughout, because a guide is the author's own note about their own
 * scene rather than anything the story said — the same voice as the margin
 * notes, and deliberately not the red of what is happening now.
 *
 * Every one of §8's four management actions is here, and all four are needed:
 * **Show** with a cost, because a guide that quietly eats a thousand tokens a
 * turn is the thing this app exists to make visible; **Edit**, which pins the
 * version so the next refresh leaves it alone; **Flush**, which takes every
 * version rather than the one in force, so rewinding cannot resurrect it; and
 * **Rebuild**, per guide or for the lot.
 *
 * All six kinds get a row whether or not they have been written. A guide that
 * does not exist yet is not absent from the panel — it reads `NONE` and offers
 * the button that writes it, because the alternative is a feature you can only
 * find by turning something on in settings first.
 */
export function GuidesBody({
  guides,
  tasks,
  customPrompt,
  working,
  onRebuild,
  onEdit,
  onFlush,
  onClose,
}: {
  guides: GuideDto[];
  tasks: TaskDto[];
  /** The custom guide's question. Without one there is nothing to ask (§8). */
  customPrompt: string | null;
  /** The kind being written right now, or `"all"`. */
  working: GuideKind | "all" | null;
  onRebuild(kind: GuideKind | "all"): void;
  onEdit(guideId: string, content: string): void;
  onFlush(kind: GuideKind | "all"): void;
  onClose(): void;
}) {
  const [expanded, setExpanded] = useState<GuideKind | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmNode, confirm] = useConfirm();

  const total = guides.reduce((sum, guide) => sum + guide.tokenCount, 0);
  const rows = GUIDE_KINDS.map((kind) => ({
    kind,
    guide: guides.find((row) => row.kind === kind) ?? null,
    label:
      guides.find((row) => row.kind === kind)?.label ??
      tasks.find((task) => task.key === `guide_${kind}`)?.label ??
      kind,
  }));

  return (
    <>
      <div className="pt-[4px] pb-[14px]">
        {guides.length === 0 ? (
          <p
            className="chrome mb-[10px] text-[9.5px] leading-[1.6]"
            style={{ color: "var(--onsen-color-blue-text-muted)" }}
          >
            {strings.chat.guidesEmpty}
          </p>
        ) : null}

        {rows.map(({ kind, guide, label }) => {
          const open = expanded === kind;
          // The custom guide is the one that cannot be written on demand: it is
          // the user's own question, and there is no question until they set one.
          const unavailable = kind === "custom" && customPrompt === null;
          return (
            <div
              key={kind}
              style={{
                borderBottom: "1px solid var(--onsen-color-blue-border)",
              }}
            >
              <button
                type="button"
                onClick={() => setExpanded(open ? null : kind)}
                disabled={guide === null}
                className="chrome flex min-h-[44px] w-full items-center justify-between gap-[10px] py-[12px] text-left disabled:opacity-100"
              >
                <span
                  className="text-[10px] tracking-[0.12em] uppercase"
                  style={{
                    color:
                      guide === null
                        ? "var(--onsen-color-blue-text-muted)"
                        : "var(--onsen-color-blue-text)",
                  }}
                >
                  {label}
                  {guide?.isPinned === true ? (
                    <span className="ml-[7px] text-[8px] opacity-70">
                      {strings.chat.guidesPinned}
                    </span>
                  ) : null}
                </span>
                <span
                  className="flex items-center gap-[8px] text-[9px] tracking-[0.10em] uppercase"
                  style={{ color: "var(--onsen-color-blue-text-muted)" }}
                >
                  {working === kind
                    ? strings.chat.guidesWorking
                    : guide === null
                      ? strings.chat.guidesNone
                      : strings.chat.guidesTotal(guide.tokenCount)}
                  {guide === null ? null : <span aria-hidden>{open ? "⌃" : "⌄"}</span>}
                </span>
              </button>

              {open && guide !== null ? (
                <div className="pb-[14px]">
                  {editing === guide.id ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        const field = event.currentTarget.elements.namedItem("content");
                        if (field instanceof HTMLTextAreaElement && field.value.trim() !== "") {
                          onEdit(guide.id, field.value.trim());
                        }
                        setEditing(null);
                      }}
                    >
                      <textarea
                        name="content"
                        // Sized to the note rather than a fixed box: a guide
                        // you cannot see all of is one you will not edit.
                        rows={Math.min(14, Math.max(4, guide.content.split("\n").length + 3))}
                        autoFocus
                        defaultValue={guide.content}
                        className="field resize-none py-[10px]"
                        style={{
                          borderColor: "var(--onsen-color-blue-border-strong)",
                          color: "var(--onsen-color-blue-prose)",
                        }}
                      />
                      <div className="mt-[9px] flex gap-[6px]">
                        <button type="submit" className="btn flex-1" style={blueSolid}>
                          {strings.chat.guidesSave}
                        </button>
                        <button
                          type="button"
                          className="btn"
                          style={blueOutline}
                          onClick={() => setEditing(null)}
                        >
                          {strings.common.cancel}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <p
                        className="mb-[12px] font-prose text-[13.5px] leading-[1.62] whitespace-pre-wrap"
                        style={{ color: "var(--onsen-color-blue-prose)" }}
                      >
                        {guide.content}
                      </p>
                      <div className="flex gap-[6px]">
                        <button
                          type="button"
                          className="btn flex-1"
                          style={blueOutline}
                          onClick={() => setEditing(guide.id)}
                        >
                          {strings.chat.guidesEdit}
                        </button>
                        <button
                          type="button"
                          className="btn flex-1"
                          style={blueOutline}
                          disabled={working !== null}
                          onClick={() => onRebuild(kind)}
                        >
                          {strings.chat.guidesRebuild}
                        </button>
                        {/* Flush is the one destructive action in a blue panel,
                            so it is the one thing in it wearing red. */}
                        <button
                          type="button"
                          className="btn"
                          style={{
                            borderColor: "var(--onsen-color-red)",
                            color: "var(--onsen-color-red)",
                          }}
                          onClick={() =>
                            confirm(
                              strings.chat.guidesFlushConfirm(label),
                              () => {
                                setExpanded(null);
                                onFlush(kind);
                              },
                              { confirmLabel: strings.chat.guidesFlush, tone: "blue" },
                            )
                          }
                        >
                          {strings.chat.guidesFlush}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : null}

              {guide !== null ? null : (
                <div className="pb-[12px]">
                  {/* The custom guide has no button here because there is
                      nothing to press: it needs a question first, and the
                      question is scene setup. Saying so is the whole row. */}
                  {unavailable ? (
                    <p
                      className="chrome text-[9px] leading-[1.5]"
                      style={{ color: "var(--onsen-color-blue-text-muted)" }}
                    >
                      {strings.chat.guidesCustomHint}
                    </p>
                  ) : (
                    <button
                      type="button"
                      className="btn w-full"
                      style={blueOutline}
                      disabled={working !== null}
                      onClick={() => onRebuild(kind)}
                    >
                      {working === kind ? strings.chat.guidesWorking : strings.chat.guidesWrite}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        <div className="mt-[16px] flex gap-[6px]">
          <button
            type="button"
            className="btn flex-1"
            style={blueOutline}
            disabled={working !== null}
            onClick={() => onRebuild("all")}
          >
            {working === "all" ? strings.chat.guidesWorking : strings.chat.guidesRebuildAll}
          </button>
          <button type="button" className="btn flex-1" style={blueSolid} onClick={onClose}>
            {strings.chat.guidesDone}
          </button>
        </div>
        {guides.length === 0 ? null : (
          <button
            type="button"
            className="btn mt-[6px] w-full"
            style={{
              borderColor: "var(--onsen-color-red)",
              color: "var(--onsen-color-red)",
            }}
            onClick={() =>
              confirm(
                strings.chat.guidesFlushAllConfirm,
                () => {
                  setExpanded(null);
                  onFlush("all");
                },
                { confirmLabel: strings.chat.guidesFlushAll, tone: "blue" },
              )
            }
          >
            {strings.chat.guidesFlushAll}
          </button>
        )}
      </div>
      {confirmNode}
    </>
  );
}
