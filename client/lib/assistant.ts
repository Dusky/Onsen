import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { agentKeys } from "./queries.ts";

/**
 * Asking the assistant, streaming (SPEC §25, phase 46).
 *
 * One POST opens an SSE stream whose events are a sentence, a tool firing,
 * what it returned, another sentence, and finally `done` — so the log grows
 * live rather than behind a spinner. The server persists every step as it
 * happens, so a dropped connection loses only the streaming text, never the
 * work: the refetch below reads the whole turn back.
 */

interface AssistantStep {
  name: string;
  args: string;
  /** Set once the result arrives. */
  detail: string | null;
  ok: boolean | null;
}

export interface AssistantTurnState {
  busy: boolean;
  /** The assistant's words so far. */
  text: string;
  /** Tool calls in order, with their results once they come back. */
  steps: AssistantStep[];
  error: string | null;
}

interface ServerEvent {
  type: "text" | "tool" | "result" | "done" | "error";
  text?: string;
  name?: string;
  args?: string;
  ok?: boolean;
  detail?: string;
  message?: string;
}

const EMPTY: AssistantTurnState = { busy: false, text: "", steps: [], error: null };

export function useAssistantTurn() {
  const client = useQueryClient();
  const [state, setState] = useState<AssistantTurnState>(EMPTY);
  const abortRef = useRef<AbortController | null>(null);

  const ask = useCallback(
    async (threadId: string, content: string) => {
      setState({ busy: true, text: "", steps: [], error: null });
      const controller = new AbortController();
      abortRef.current = controller;

      let failed: string | null = null;
      try {
        const response = await fetch(`/api/agent/threads/${threadId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
          signal: controller.signal,
        });

        if (!response.ok || response.body === null) {
          let message = "The assistant could not be reached.";
          try {
            const body = (await response.json()) as { error?: { message?: string } };
            message = body.error?.message ?? message;
          } catch {
            /* A non-JSON failure keeps the default. */
          }
          failed = message;
        } else {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let pending = "";

          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            pending += decoder.decode(value, { stream: true });

            let boundary = pending.indexOf("\n\n");
            while (boundary !== -1) {
              const frame = pending.slice(0, boundary);
              pending = pending.slice(boundary + 2);
              boundary = pending.indexOf("\n\n");

              const dataAt = frame.indexOf("data: ");
              if (dataAt === -1) continue;
              let event: ServerEvent;
              try {
                event = JSON.parse(frame.slice(dataAt + 6)) as ServerEvent;
              } catch {
                continue;
              }

              if (event.type === "text") {
                setState((s) => ({ ...s, text: s.text + (event.text ?? "") }));
              } else if (event.type === "tool") {
                setState((s) => ({
                  ...s,
                  steps: [...s.steps, { name: event.name ?? "", args: event.args ?? "", detail: null, ok: null }],
                }));
              } else if (event.type === "result") {
                setState((s) => ({
                  ...s,
                  steps: s.steps.map((step, index) =>
                    index === s.steps.length - 1
                      ? { ...step, detail: event.detail ?? "", ok: event.ok === true }
                      : step,
                  ),
                }));
              } else if (event.type === "error") {
                failed = event.message ?? "The assistant stopped.";
              }
              // `done` needs no state beyond `busy` clearing below.
            }
          }
        }
      } catch (caught) {
        if (!controller.signal.aborted) {
          failed = caught instanceof Error ? caught.message : "The assistant could not be reached.";
        }
      } finally {
        abortRef.current = null;
        setState((s) => ({ ...s, busy: false, error: failed }));
        // The turn is persisted server-side as it went; refetch it whole.
        void client.invalidateQueries({ queryKey: agentKeys.thread(threadId) });
        void client.invalidateQueries({ queryKey: agentKeys.threads });
        // A turn may have changed things, so the undo list is stale too.
        void client.invalidateQueries({ queryKey: agentKeys.undo });
      }
    },
    [client],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  // Stop reading when the screen unmounts. The turn keeps running server-side.
  useEffect(() => () => abortRef.current?.abort(), []);

  return { turn: state, ask, stop };
}
