import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AgentMessageDto, AgentThreadDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { useIsDesktop } from "../lib/breakpoint.ts";
import { useConfirm } from "../components/ConfirmSheet.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { notify } from "../state/notices.ts";
import {
  agentKeys,
  useAgentThread,
  useAgentThreads,
  useAgentTools,
  useAgentUndo,
  useAssistantProfile,
  useConnectionProfiles,
  useCreateAgentThread,
  useDeleteAgentThread,
  useRenameAgentThread,
  useRestoreUndo,
  useSetAssistantProfile,
} from "../lib/queries.ts";
import { useAssistantTurn } from "../lib/assistant.ts";

/**
 * The assistant (SPEC §25, phase 46) — its client, phase 208.
 *
 * One screen, reached like Settings: a conversation with the model that runs
 * this install. The server half was built and tested since phase 46; this is
 * the half that makes it reachable. A thread is a conversation; the model can
 * call tools that read and change the library for real, and every change it
 * makes lands in the Undo list with a way back.
 */

/** "3m", "2h", "5d" — enough to tell conversations apart in a list. */
function ago(at: number): string {
  const minutes = Math.floor((Date.now() - at) / 60_000);
  if (minutes < 1) return strings.assistant.justNow;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function toolNameLabel(raw: string): string {
  return raw.replace(/_/g, " ");
}

export function AssistantScreen() {
  const isDesktop = useIsDesktop();
  const client = useQueryClient();
  const threads = useAgentThreads();
  const tools = useAgentTools();
  const undo = useAgentUndo();
  const profile = useAssistantProfile();
  const setProfile = useSetAssistantProfile();
  const profiles = useConnectionProfiles();
  const createThread = useCreateAgentThread();
  const renameThread = useRenameAgentThread();
  const deleteThread = useDeleteAgentThread();
  const restore = useRestoreUndo();
  const { turn, ask } = useAssistantTurn();
  const [confirm, runConfirm] = useConfirm();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [showTools, setShowTools] = useState(false);
  const [showUndo, setShowUndo] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");

  const log = useRef<HTMLDivElement>(null);
  const selected = threads.data?.find((thread) => thread.id === selectedId) ?? null;
  const thread = useAgentThread(selectedId);
  const messages = thread.data?.messages ?? [];

  // Open the newest conversation once the list has loaded and none is picked.
  useEffect(() => {
    if (selectedId === null && (threads.data?.length ?? 0) > 0) {
      setSelectedId(threads.data![0]!.id);
    }
  }, [threads.data, selectedId]);

  // Follow the conversation down as it grows and while it streams.
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [messages.length, turn.text, turn.steps.length, pendingQuestion]);

  function startThread() {
    createThread.mutate(undefined, {
      onSuccess: (made) => setSelectedId(made.id),
    });
  }

  function send() {
    const text = draft.trim();
    if (text === "" || selectedId === null || turn.busy) return;
    setDraft("");
    setPendingQuestion(text);
    void ask(selectedId, text);
  }

  function finishRename() {
    const title = renameDraft.trim();
    if (title === "" || selected === null) {
      setRenaming(false);
      return;
    }
    renameThread.mutate({ id: selected.id, title });
    setRenaming(false);
  }

  function removeThread(thread: AgentThreadDto) {
    runConfirm(strings.assistant.deleteConfirm, () => {
      deleteThread.mutate(thread.id, {
        onSuccess: () => {
          if (selectedId === thread.id) setSelectedId(null);
        },
      });
    });
  }

  function doRestore(id: string, name: string) {
    restore.mutate(id, {
      onSuccess: (result) => {
        const restored = result.restored;
        const label = typeof restored["name"] === "string" ? (restored["name"] as string) : name;
        notify("done", strings.assistant.restored(label));
      },
    });
  }

  const threadHeader = (
    <div className="flex flex-none items-center gap-[8px] border-b border-rule px-[16px] py-[8px]">
      {renaming && selected !== null ? (
        <input
          autoFocus
          value={renameDraft}
          onChange={(event) => setRenameDraft(event.target.value)}
          onBlur={finishRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") finishRename();
            if (event.key === "Escape") setRenaming(false);
          }}
          className="chrome min-w-0 flex-1 border border-rule-strong bg-bg px-[8px] py-[5px] text-ui"
        />
      ) : (
        <button
          type="button"
          className="chrome min-w-0 flex-1 truncate text-left text-ui-loose font-medium"
          title={strings.assistant.rename}
          onClick={() => {
            if (selected === null) return;
            setRenameDraft(selected.title);
            setRenaming(true);
          }}
        >
          {selected?.title ?? strings.assistant.title}
        </button>
      )}
      {selected === null ? null : (
        <button
          type="button"
          className="chrome text-ui"
          style={{ color: "var(--onsen-color-red)" }}
          onClick={() => removeThread(selected)}
        >
          {strings.assistant.deleteThread}
        </button>
      )}
    </div>
  );

  const body = (
    <div className="flex min-h-0 flex-1">
      {/* The conversation list. On a phone it collapses into a dropdown above. */}
      {isDesktop ? (
        <aside className="flex w-[280px] flex-none flex-col border-r border-rule bg-bg-sunken">
          <div className="flex-none px-[12px] pt-[12px] pb-[8px]">
            <button type="button" className="btn btn-primary w-full" onClick={startThread}>
              {strings.assistant.newThread}
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-[8px] pb-[8px]">
            {(threads.data ?? []).length === 0 ? (
              <p className="explain px-[6px] py-[8px]">{strings.assistant.threadsEmpty}</p>
            ) : null}
            {(threads.data ?? []).map((thread) => (
              <div key={thread.id} className="mb-[2px]">
                <button
                  type="button"
                  onClick={() => setSelectedId(thread.id)}
                  aria-current={selectedId === thread.id ? "true" : undefined}
                  className="chrome w-full px-[8px] py-[7px] text-left text-ui"
                  style={{
                    background:
                      selectedId === thread.id ? "var(--onsen-color-bg-inset)" : "transparent",
                    boxShadow:
                      selectedId === thread.id
                        ? "inset 2px 0 0 var(--onsen-color-blue)"
                        : "none",
                  }}
                >
                  <span className="block truncate">{thread.title}</span>
                  <span className="block text-[11px]" style={{ color: "var(--onsen-color-text-dim)" }}>
                    {ago(thread.updatedAt)}
                  </span>
                </button>
              </div>
            ))}
          </div>

          <div className="flex-none border-t border-rule px-[8px] py-[8px]">
            <button
              type="button"
              onClick={() => setShowUndo((value) => !value)}
              aria-expanded={showUndo}
              className="chrome w-full px-[8px] py-[6px] text-left text-ui text-ink-muted"
            >
              {strings.assistant.undo} · {undo.data?.length ?? 0}
            </button>
            {showUndo ? (
              <div className="max-h-[180px] overflow-y-auto pt-[4px]">
                {(undo.data ?? []).length === 0 ? (
                  <p className="explain px-[6px] py-[4px]">{strings.assistant.undoEmpty}</p>
                ) : null}
                {(undo.data ?? []).map((entry) => (
                  <div key={entry.id} className="flex items-center gap-[6px] px-[6px] py-[3px]">
                    <span className="chrome min-w-0 flex-1 truncate text-[12px] text-ink-dim">
                      {strings.assistant.undoEntry(entry.kind, entry.label)}
                    </span>
                    <button
                      type="button"
                      className="chrome flex-none text-[12px]"
                      style={{ color: "var(--onsen-color-blue-text)" }}
                      onClick={() => doRestore(entry.id, entry.label)}
                    >
                      {strings.assistant.restore}
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </aside>
      ) : null}

      {/* The conversation itself. */}
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Phone: thread picker and new. */}
        {!isDesktop ? (
          <div className="flex flex-none items-center gap-[8px] border-b border-rule px-[14px] py-[8px]">
            <select
              value={selectedId ?? ""}
              onChange={(event) => setSelectedId(event.target.value === "" ? null : event.target.value)}
              className="chrome min-w-0 flex-1 border border-rule-strong bg-bg px-[8px] py-[7px] text-ui"
            >
              <option value="">{strings.assistant.threads}</option>
              {(threads.data ?? []).map((thread) => (
                <option key={thread.id} value={thread.id}>
                  {thread.title}
                </option>
              ))}
            </select>
            <button type="button" className="btn flex-none" onClick={startThread}>
              {strings.assistant.newThread}
            </button>
            <button
              type="button"
              className="btn flex-none"
              onClick={() => setShowUndo((value) => !value)}
            >
              {strings.assistant.undo}
            </button>
          </div>
        ) : null}

        {threadHeader}

        <div ref={log} className="min-h-0 flex-1 overflow-y-auto px-[18px] py-[14px]">
          <div className="mx-auto w-full max-w-[var(--onsen-prose-measure)]">
            {messages.length === 0 && pendingQuestion === null && !turn.busy && selectedId === null ? (
              <p className="chrome py-[16px] text-ui-loose leading-[1.6] text-ink-dim">
                {strings.assistant.empty}
              </p>
            ) : null}

            {messages.map((message) => (
              <PersistedMessage key={message.id} message={message} />
            ))}

            {pendingQuestion !== null ? (
              <Bubble fromReader text={pendingQuestion} name={strings.assistant.reader} />
            ) : null}

            {turn.busy || turn.text !== "" ? (
              <Bubble
                fromReader={false}
                text={turn.text === "" ? strings.assistant.thinking : turn.text}
                name={strings.assistant.name}
              >
                {turn.steps.length > 0 ? (
                  <div className="mt-[8px] flex flex-col gap-[4px]">
                    {turn.steps.map((step, index) => (
                      <span key={index} className="chrome block text-[12px] opacity-80">
                        {step.detail === null
                          ? `${strings.assistant.toolCall(toolNameLabel(step.name))} · ${step.args.slice(0, 80)}`
                          : `${step.ok === true ? strings.assistant.toolResult : strings.assistant.toolFailed} · ${step.detail.slice(0, 120)}`}
                      </span>
                    ))}
                  </div>
                ) : null}
              </Bubble>
            ) : null}

            {turn.error !== null ? (
              <p
                role="alert"
                className="chrome mt-[10px] border border-red-border bg-red-bg px-[11px] py-[9px] text-ui-loose text-red-text"
              >
                {strings.assistant.errorTitle} — {turn.error}
              </p>
            ) : null}
          </div>
        </div>

        {/* The composer. */}
        <div
          className="flex flex-none flex-wrap items-end justify-end gap-[8px] border-t border-rule px-[16px] pt-[10px]"
          style={{ paddingBottom: "calc(10px + env(safe-area-inset-bottom))" }}
        >
          <div className="mx-auto flex w-full max-w-[var(--onsen-prose-measure)] items-end gap-[8px]">
            <textarea
              rows={1}
              value={draft}
              aria-label={strings.assistant.placeholder}
              placeholder={strings.assistant.placeholder}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              className="chrome max-h-[120px] min-h-[44px] w-full flex-1 basis-[160px] resize-none px-[12px] py-[12px] text-ui leading-[1.55]"
              style={{ background: "var(--onsen-color-bg)", border: "1px solid var(--onsen-color-border-quiet)" }}
            />
            <button
              type="button"
              onClick={send}
              disabled={draft.trim() === "" || selectedId === null || turn.busy}
              className="btn btn-primary flex-none"
            >
              {strings.assistant.send}
            </button>
          </div>
        </div>

        {/* Tools, once, so the reader knows what the model can do before asking. */}
        {showTools ? (
          <Sheet title={strings.assistant.tools} onClose={() => setShowTools(false)}>
            {(tools.data ?? []).length === 0 ? (
              <p className="explain py-[8px]">{strings.assistant.toolsEmpty}</p>
            ) : (
              (tools.data ?? []).map((tool) => (
                <div key={tool.name} className="py-[6px]">
                  <p className="chrome text-ui font-medium">{tool.name}</p>
                  <p className="chrome text-[12px] leading-[1.5] text-ink-dim">{tool.description}</p>
                </div>
              ))
            )}
          </Sheet>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="flex screen-height flex-col bg-bg">
      <header className="hairline flex shrink-0 items-end justify-between px-[22px] pb-[14px]" style={{ paddingTop: "22px" }}>
        <div>
          <p className="screen-kicker">{strings.assistant.kicker}</p>
          <h1 className="screen-title mt-[6px]">{strings.assistant.title}</h1>
          <p className="chrome mt-[6px] max-w-[560px] text-ui leading-[1.6] text-ink-dim">
            {strings.assistant.blurb}
          </p>
        </div>
        <button type="button" className="btn flex-none" onClick={() => setShowTools(true)}>
          {strings.assistant.tools}
        </button>
      </header>

      {/* Which profile the assistant runs on (§7): its own routing, set once
          rather than per conversation. */}
      <div className="flex shrink-0 flex-wrap items-center gap-[6px] border-b border-rule px-[22px] py-[8px]">
        <span className="chrome flex-none text-[12px]" style={{ color: "var(--onsen-color-text-dim)" }}>
          {strings.assistant.profile}
        </span>
        <button
          type="button"
          onClick={() => setProfile.mutate(null)}
          className={`btn ${(profile.data?.connectionProfileId ?? null) === null ? "btn-primary" : ""}`}
        >
          {strings.assistant.profileDefault}
        </button>
        {(profiles.data ?? []).map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setProfile.mutate(p.id)}
            className={`btn ${profile.data?.connectionProfileId === p.id ? "btn-primary" : ""}`}
          >
            {p.name}
          </button>
        ))}
      </div>
      {body}
      {confirm}
    </div>
  );
}

/** One persisted turn: the reader, the assistant, and the tools it ran. */
function PersistedMessage({ message }: { message: AgentMessageDto }) {
  if (message.role === "tool") {
    // A result belongs to the call above it; render it as a quiet note.
    return (
      <div className="mb-[8px] ml-[10px]">
        <span
          className="chrome block text-[12px] leading-[1.5]"
          style={{ color: message.isError ? "var(--onsen-color-red)" : "var(--onsen-color-text-dim)" }}
        >
          {message.isError ? strings.assistant.toolFailed : strings.assistant.toolResult} ·{" "}
          {message.content.slice(0, 160)}
        </span>
      </div>
    );
  }
  if (message.role === "user") {
    return <Bubble fromReader text={message.content} name={strings.assistant.reader} />;
  }
  return (
    <Bubble fromReader={false} text={message.content} name={strings.assistant.name}>
      {message.toolCalls.length === 0 ? null : (
        <div className="mt-[8px] flex flex-wrap gap-[4px]">
          {message.toolCalls.map((call, index) => (
            <span
              key={index}
              className="chrome text-[12px]"
              style={{
                border: "1px solid var(--onsen-color-border-quiet)",
                padding: "1px 6px",
                color: "var(--onsen-color-text-muted)",
              }}
            >
              {strings.assistant.toolCall(toolNameLabel(call.name))}
            </span>
          ))}
        </div>
      )}
    </Bubble>
  );
}

/** One side of the conversation. The reader right, the assistant left. */
function Bubble({
  text,
  fromReader,
  name,
  children,
}: {
  text: string;
  fromReader: boolean;
  name: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`mb-[12px] flex flex-col ${fromReader ? "items-end" : "items-start"}`}>
      <span className="chrome mb-[4px] text-[12px]" style={{ color: "var(--onsen-color-text-dim)" }}>
        {name}
      </span>
      <div
        className="chrome max-w-[85%] px-[12px] py-[9px] text-ui leading-[1.55] whitespace-pre-wrap"
        style={
          fromReader
            ? {
                background: "var(--onsen-color-ooc-reader-bg)",
                color: "var(--onsen-color-ooc-reader-text)",
                borderRadius: "12px 3px 12px 12px",
              }
            : {
                background: "var(--onsen-color-bg-raised)",
                border: "1px solid var(--onsen-color-border-quiet)",
                borderRadius: "3px 12px 12px 12px",
              }
        }
      >
        {text}
        {children}
      </div>
    </div>
  );
}
