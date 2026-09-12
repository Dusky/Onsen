import { useEffect, useRef, useState } from "react";
import type { MessageDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { blueSolid } from "./blue.ts";
import { SheetShell } from "./Sheet.tsx";

/**
 * The OOC channel (design `2a`, SPEC §7).
 *
 * "This is not a mode the user lives in. Notes arrive inline; the channel is
 * where a note *becomes a conversation*." So the sheet holds only the
 * off-script exchange, and the scene dims behind it rather than disappearing —
 * the story is still what this is about.
 *
 * Its shape is `SheetShell`'s, which is the point of the shell existing: this
 * channel had hand-rolled the whole overlay for itself — the same covering
 * layer, the same backdrop button, the same bottom anchor and rounded top — so
 * when phase 174 turned a sheet into a dialog on a desktop, the off-script
 * window alone kept rising from the bottom edge of a 1600px screen. It owns
 * its interior (a scrolling exchange with a composer pinned under it, which a
 * plain `Sheet` cannot hold) and nothing about where it sits.
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
 * The whole sheet is blue because everything in it is the author speaking as
 * itself, which is what the blue pencil marks everywhere else in the app.
 */
export function OocChannel({
  messages,
  authorName,
  personaName,
  pending,
  onSend,
  onClose,
}: {
  /** Every off-script message on the active path, oldest first. */
  messages: MessageDto[];
  /** Null with no author set. The bubbles then carry no name. */
  authorName: string | null;
  personaName: string;
  /** An answer being written right now, or null. */
  pending: string | null;
  onSend(question: string): void;
  onClose(): void;
}) {
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
    // The whole exchange is the author speaking as itself, which is what the
    // blue pencil marks everywhere else — so the shell's blue tone, not a
    // border this file draws for itself.
    //
    // `max-h-[80dvh]` on the panel rather than on the scroll area, because the
    // composer and the hint are pinned below it: the log takes whatever height
    // is left, and the pair under it never scrolls away. The `pb` gives the
    // hint room on a desktop and is overridden on a phone, where the shell's
    // own safe-area allowance is the inline style and wins.
    <SheetShell
      label={strings.ooc.title}
      tone="blue"
      panelClassName="max-h-[80dvh] pb-[12px]"
      onClose={onClose}
    >
      <div
        className="flex flex-none items-baseline justify-between gap-[10px] px-[22px] pt-[16px] pb-[10px]"
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

      <div className="min-h-0 flex-1 overflow-y-auto px-[22px] py-[12px]">
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

      <div
        className="flex flex-none items-end gap-[8px] px-[22px] pt-[10px]"
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
          className="chrome max-h-[120px] min-h-[44px] flex-1 resize-none px-[12px] py-[12px] text-[12.5px] leading-[1.55]"
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
        className="chrome flex-none px-[22px] pt-[8px] text-[12.5px] leading-[1.5]"
        style={{ color: "var(--onsen-color-blue-text-muted)" }}
      >
        {strings.ooc.hint}
      </p>
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
