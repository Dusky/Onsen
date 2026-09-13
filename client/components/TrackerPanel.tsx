import { useState } from "react";
import type { TrackerDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { useEditTracker, useFlushTrackers, useRebuildTrackers, useTrackers } from "../lib/queries.ts";

/**
 * The tracker panel (SPEC §8, §20 phase 31): the strict, structured sibling of
 * the guides, rendered as a collapsible strip above the composer. Each tracker
 * is its JSON, shown field by field, editable — and an edit pins it, so the
 * next automatic refresh leaves it alone.
 */

function FieldRow({ name, value }: { name: string; value: unknown }) {
  const text = typeof value === "string" ? value : Array.isArray(value) ? value.join(", ") : "";
  return (
    <div className="flex items-baseline gap-[8px]">
      <span className="chrome flex-none text-[12px] text-ink-dim">
        {name}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px]">{text}</span>
    </div>
  );
}

function parseContent(content: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(content);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function TrackerBlock({ tracker, sceneId }: { tracker: TrackerDto; sceneId: string }) {
  const edit = useEditTracker(sceneId);
  const flush = useFlushTrackers(sceneId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tracker.content);
  const parsed = parseContent(tracker.content);

  const title = tracker.kind === "scene" ? strings.chat.trackerScene : strings.chat.trackerCharacters;

  return (
    <div className="border-b border-rule py-[8px]">
      <div className="flex items-baseline gap-[8px]">
        <span className="min-w-0 flex-1 truncate text-ui font-medium">
          {title}
        </span>
        <span className="chrome flex-none text-[12px] text-ink-muted">
          {strings.chat.inspectorTokens(tracker.tokenCount)}
          {tracker.isPinned ? ` · ${strings.chat.trackerPinned}` : ""}
        </span>
        <button
          type="button"
          className="chrome flex-none text-[12px]"
          onClick={() => {
            setEditing(!editing);
            setDraft(tracker.content);
          }}
        >
          {editing ? strings.chat.doneEditing : strings.chat.edit}
        </button>
        <button
          type="button"
          className="chrome flex-none text-[12px]"
          style={{ color: "var(--onsen-color-red)" }}
          onClick={() => flush.mutate(tracker.kind)}
        >
          {strings.chat.flush}
        </button>
      </div>

      {editing ? (
        <textarea
          className="field chrome mt-[6px] min-h-[80px] resize-y text-ui leading-[1.5]"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (draft.trim() !== "") edit.mutate({ id: tracker.id, content: draft.trim() });
            setEditing(false);
          }}
        />
      ) : (
        <TrackerFields content={tracker.content} />
      )}
    </div>
  );
}

/**
 * One tracker's state, read-only.
 *
 * Pulled out of the panel so the card under a reply (§20 phase 163) renders
 * the same thing the strip above the composer does. Two renderers for one
 * shape would disagree about a field within a phase or two, and the reader
 * would be looking at both at once.
 *
 * It reads structured data the app wrote, not markup a model emitted. That is
 * the whole design of this card: no parsing, no sanitising, nothing to escape.
 */
export function TrackerFields({ content }: { content: string }) {
  const parsed = parseContent(content);
  if (parsed === null) {
    // §8's rule, one layer up: a malformed tracker is shown as what it is
    // rather than hidden, because a state nobody can see is a state nobody
    // can fix.
    return <p className="chrome mt-[4px] text-ui-loose text-ink-dim">{content}</p>;
  }
  return (
    <div className="mt-[4px] space-y-[2px]">
      {Object.entries(parsed).map(([key, value]) =>
        key === "characters" && Array.isArray(value) ? (
          <div key={key} className="space-y-[1px]">
            {(value as Record<string, unknown>[]).map((member, index) => (
              <div key={index} className="pl-[8px]">
                <span className="chrome text-ui-loose text-ink-label">
                  {String(member["name"] ?? `#${index + 1}`)}
                </span>
                <span className="chrome text-ui-loose text-ink-dim">
                  {` · ${[member["mood"], member["position"], member["notable_state"]]
                    .filter((part) => typeof part === "string" && part !== "")
                    .join(" · ")}`}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <FieldRow key={key} name={key.replaceAll("_", " ")} value={value} />
        ),
      )}
    </div>
  );
}

/**
 * The scene's state as of one reply, folded under it (§20 phase 163).
 *
 * The panel above the composer says what is true *now*, which is the right
 * answer to "what is the scene holding" and the wrong one to "what did it know
 * when it wrote that". A tracker row is already anchored to the turn that
 * produced it, so this is a rendering of data the app has had since phase 31
 * rather than anything new.
 *
 * Two things it deliberately is not. It is not parsed out of the reply: the
 * card reads structured state the app wrote, so there is nothing to sanitise
 * and no markup from a model reaches the DOM. And it is not open by default —
 * a long scene with one of these expanded under every turn is a wall of state
 * with prose between it, which is the opposite of a reading surface.
 */
export function TrackerCard({ trackers }: { trackers: TrackerDto[] }) {
  const [open, setOpen] = useState(false);
  if (trackers.length === 0) return null;

  return (
    <div className="mt-[10px]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="chrome tap flex items-center gap-[7px] text-[12px] text-ink-dim hover:text-ink-label"
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        {strings.chat.stateAtTurn}
      </button>
      {open ? (
        <div className="mt-[4px] border-l border-rule pl-[11px]">
          {trackers.map((tracker) => (
            <div key={tracker.id} className="mb-[6px] last:mb-0">
              <p className="chrome text-[12px] text-ink-muted">
                {tracker.kind === "scene"
                  ? strings.chat.trackerScene
                  : strings.chat.trackerCharacters}
              </p>
              <TrackerFields content={tracker.content} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function TrackerPanel({ sceneId }: { sceneId: string }) {
  const trackers = useTrackers(sceneId);
  const rebuild = useRebuildTrackers(sceneId);
  const [open, setOpen] = useState(false);

  const list = trackers.data ?? [];
  if (list.length === 0) return null;
  const total = list.reduce((sum, tracker) => sum + tracker.tokenCount, 0);

  return (
    <div className="flex-none border-t border-rule bg-bg-raised">
      <div className="mx-auto w-full max-w-[var(--onsen-prose-measure)] px-[16px] py-[6px]">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex w-full items-baseline gap-[8px] py-[2px] text-left"
        >
          <span className="chrome text-ui text-ink-label">
            {strings.chat.trackers}
          </span>
          <span className="chrome flex-none text-[12px] text-ink-muted">
            {strings.chat.guidesTotal(total)}
          </span>
          <span className="flex-1" />
          <span className="chrome text-ui-loose text-ink-muted">{open ? "▾" : "▸"}</span>
        </button>

        {open ? (
          <div className="pt-[4px]">
            {list.map((tracker) => (
              <TrackerBlock key={tracker.id} tracker={tracker} sceneId={sceneId} />
            ))}
            <button
              type="button"
              className="chrome mt-[8px] text-[12px] text-ink-dim"
              disabled={rebuild.isPending}
              onClick={() => rebuild.mutate()}
            >
              {strings.chat.rebuild}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
