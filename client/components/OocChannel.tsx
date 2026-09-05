import { useEffect, useRef, useState } from "react";
import type { MessageDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { blueSolid } from "./blue.ts";

/**
 * The OOC channel (design `2a`, SPEC §7).
 *
 * "This is not a mode the user lives in. Notes arrive inline; the channel is
 * where a note *becomes a conversation*." So the sheet holds only the
 * off-script exchange, and the scene dims behind it rather than disappearing —
 * the story is still what this is about.
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

  // Escape closes it, as it does every other sheet.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label={strings.ooc.back}
        onClick={onClose}
        // ~30% rather than the usual dimming: the scene is still the point, and
        // this sheet is a margin note about it.
        className="absolute inset-0 bg-black/70"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={strings.ooc.title}
        className="relative flex max-h-[80dvh] flex-col"
        style={{
          borderRadius: "16px 16px 0 0",
          borderTop: "2px solid var(--onsen-color-blue)",
          background: "var(--onsen-color-blue-bg-sheet)",
          paddingBottom: "calc(12px + env(safe-area-inset-bottom))",
        }}
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
            className="chrome text-[10.5px] tracking-[0.12em] uppercase"
            style={{ color: "var(--onsen-color-blue-text-muted)" }}
          >
            {strings.ooc.back}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-[22px] py-[12px]">
          {messages.length === 0 && pending === null ? (
            <p
              className="chrome text-[11.5px] leading-[1.6] tracking-[0.06em]"
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
          className="chrome px-[22px] pt-[8px] text-[10.5px] leading-[1.5]"
          style={{ color: "var(--onsen-color-blue-text-muted)" }}
        >
          {strings.ooc.hint}
        </p>
      </div>
    </div>
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
          className="chrome mb-[4px] text-[10px] tracking-[0.16em] uppercase"
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
