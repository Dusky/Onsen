import { useEffect, useRef, useState } from "react";
import type { MessageDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { blueSolid } from "./blue.ts";
import { SheetShell } from "./Sheet.tsx";

/**
 * The OOC channel (design `2a`, SPEC §7).
 *
 * "This is not a mode the user lives in. Notes arrive inline; the channel is
 * where a note *becomes a conversation*." The exchange is only ever about the
 * story, so it never takes the story's place: on a desktop it is a rail panel
 * beside the log, and on a phone a sheet with the scene dimmed behind it.
 *
 * Two components, because the where and the what came apart under use. This
 * had hand-rolled its own overlay — covering layer, backdrop button, bottom
 * anchor, rounded top — so when phase 174 turned a sheet into a dialog on a
 * desktop, the off-script window alone kept rising from the bottom edge of a
 * 1600px screen. Phase 176 moved the shape into `SheetShell`; phase 177 was
 * the report that a dialog was not what was wanted either. `OocExchange`
 * below is the part that never changed through any of it.
 *
 * The classes are deliberately not quoted above: `test/sheet-dialog.test.ts`
 * sweeps this directory for them as text, and a guard that cannot tell a
 * mention from a use is one worth writing the comment around.
 *
 * Alternating bubbles, unlike the inline treatment: the author left with the
 * blue tail, the reader right in the warm tint the design gives their own
 * words. Inline, one aside in one margin needs no sides; here there are two
 * people talking and the shape has to say which is which.
 *
 * Everything in it is the author speaking as itself, which is what the blue
 * pencil marks everywhere else in the app — so the whole panel is blue.
 */
export interface OocProps {
  /** Every off-script message on the active path, oldest first. */
  messages: MessageDto[];
  /** Null with no author set. The bubbles then carry no name. */
  authorName: string | null;
  personaName: string;
  /** An answer being written right now, or null. */
  pending: string | null;
  onSend(question: string): void;
}

/**
 * The exchange itself: a scrolling log of bubbles, a composer pinned under it,
 * and the one line saying none of this is the story. Fills whatever it is
 * given and scrolls inside itself, so the composer never scrolls away —
 * which is why a rail hosting it must not wrap it in a scroll container
 * (`PanelMeta.fills`, `DockPanels.tsx`).
 */
export function OocExchange({ messages, authorName, personaName, pending, onSend }: OocProps) {
  const [draft, setDraft] = useState("");
  const foot = useRef<HTMLDivElement>(null);

  // Follow the conversation down as it grows, including while an answer streams.
  useEffect(() => {
    foot.current?.scrollIntoView({ block: "end" });
  }, [messages.length, pending]);

  function send() {
    const question = draft.trim();
    if (question === "") return;
    setDraft("");
    onSend(question);
  }

  return (
    // The blue ground is painted here rather than only by the sheet, because
    // this is where the rule lives: everything in this panel is the author
    // speaking as itself. In a sheet it repeats what the shell already paints,
    // which costs nothing; in a rail it is the only thing that paints it, and
    // without it the exchange sat on the rail's own ground and read as part of
    // the furniture.
    <div
      className="flex h-full min-h-0 flex-col"
      style={{ background: "var(--onsen-color-blue-bg-sheet)" }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-[16px] py-[12px]">
        {messages.length === 0 && pending === null ? (
          <p
            className="chrome text-[13.5px] leading-[1.6]"
            style={{ color: "var(--onsen-color-blue-text-muted)" }}
          >
            {strings.ooc.empty}
          </p>
        ) : null}

        {messages.map((message) => (
          <Bubble
            key={message.id}
            text={message.content}
            fromReader={message.authorType === "user"}
            name={message.authorType === "user" ? personaName : authorName}
          />
        ))}
        {pending === null ? null : (
          <Bubble text={pending === "" ? strings.ooc.thinking : pending} fromReader={false} name={authorName} />
        )}
        <div ref={foot} />
      </div>

      {/* The composer wraps rather than sitting in a row: a rail is 352px by
          default and can be dragged to 260px, and a textarea sharing that with
          a Send button is a textarea nobody can write in. */}
      <div
        className="flex flex-none flex-wrap items-end justify-end gap-[8px] px-[16px] pt-[10px]"
        style={{ borderTop: "1px solid var(--onsen-color-blue-border)" }}
      >
        <textarea
          rows={1}
          value={draft}
          aria-label={strings.ooc.placeholder}
          placeholder={strings.ooc.placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          className="chrome max-h-[120px] min-h-[44px] w-full flex-1 basis-[160px] resize-none px-[12px] py-[12px] text-[12.5px] leading-[1.55]"
          style={{
            background: "var(--onsen-color-blue-bg)",
            border: "1px solid var(--onsen-color-blue-border-strong)",
            color: "var(--onsen-color-blue-text)",
          }}
        />
        <button
          type="button"
          onClick={send}
          disabled={draft.trim() === ""}
          className="btn flex-none"
          style={blueSolid}
        >
          {strings.ooc.send}
        </button>
      </div>

      <p
        className="chrome flex-none px-[16px] pt-[8px] pb-[12px] text-[12.5px] leading-[1.5]"
        style={{ color: "var(--onsen-color-blue-text-muted)" }}
      >
        {strings.ooc.hint}
      </p>
    </div>
  );
}

/**
 * The phone's way in: the same exchange in a sheet over the dimmed scene.
 *
 * Desktop reaches the exchange through the rail instead (`ChatScreen`'s
 * `openOoc`), and falls back to this sheet when the reader has undocked the
 * panel from both rails — a way in that depends on a preference is not a way
 * in.
 */
export function OocChannel({ onClose, ...exchange }: OocProps & { onClose(): void }) {
  return (
    <SheetShell
      label={strings.ooc.title}
      tone="blue"
      // The cap is on the panel, not the scroll area: the exchange fills what
      // it is given and does its own scrolling inside.
      panelClassName="max-h-[80dvh]"
      onClose={onClose}
    >
      <div
        className="flex flex-none items-baseline justify-between gap-[10px] px-[16px] pt-[16px] pb-[10px]"
        style={{ borderBottom: "1px solid var(--onsen-color-blue-border)" }}
      >
        <p className="section-label" style={{ color: "var(--onsen-color-blue-text)" }}>
          {strings.ooc.title}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="chrome text-[12.5px]"
          style={{ color: "var(--onsen-color-blue-text-muted)" }}
        >
          {strings.ooc.back}
        </button>
      </div>
      <OocExchange {...exchange} />
    </SheetShell>
  );
}

/** One side of the exchange. The tail points at whoever said it. */
function Bubble({
  text,
  fromReader,
  name,
}: {
  text: string;
  fromReader: boolean;
  name: string | null;
}) {
  return (
    <div className={`mb-[12px] flex flex-col ${fromReader ? "items-end" : "items-start"}`}>
      {name === null ? null : (
        <span
          className="chrome mb-[4px] text-[12px]"
          style={{ color: "var(--onsen-color-blue-text-muted)" }}
        >
          {name}
        </span>
      )}
      <div
        className="chrome max-w-[85%] px-[12px] py-[9px] text-[12.5px] leading-[1.55] whitespace-pre-wrap"
        style={
          fromReader
            ? {
                // The reader's own words keep the warm ground they have
                // everywhere else, even inside the blue panel.
                background: "var(--onsen-color-ooc-reader-bg)",
                color: "var(--onsen-color-ooc-reader-text)",
                borderRadius: "12px 3px 12px 12px",
              }
            : {
                background: "var(--onsen-color-blue-bg)",
                border: "1px solid var(--onsen-color-blue-border)",
                color: "var(--onsen-color-blue-text)",
                borderRadius: "3px 12px 12px 12px",
              }
        }
      >
        {text}
      </div>
    </div>
  );
}
