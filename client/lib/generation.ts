import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiRequestError } from "./api.ts";
import { keys } from "./queries.ts";
import { useGenerationStore } from "../state/generation.ts";
import { chimeIfWanted } from "./chime.ts";
import type { BeatBound, ReviseMode, TurnScope } from "@shared/types.ts";

/**
 * Watching a generation from the client (SPEC §5).
 *
 * Deliberately `fetch` plus a stream reader rather than `EventSource`.
 * EventSource reconnects to the URL it was given, which would replay from the
 * original offset and duplicate everything already received. Resuming needs the
 * offset to move, so the reconnect has to be ours.
 */

interface StartArgs {
  sceneId: string;
  sceneTitle: string;
  /** Null when the director has not decided yet — the classifier decides late. */
  speaker: string | null;
  /** Names a parent to fork from — how a reroll asks for a sibling. */
  parentId?: string | null;
  /** Forces who speaks, overriding the turn director for this turn. */
  characterId?: string | null;
  /** One-shot direction for this turn only (SPEC §7). Never becomes a message. */
  nudge?: string;
  /** Produce a better version of an existing turn, as a sibling (SPEC §7). */
  revise?: { messageId: string; mode: ReviseMode; instructions?: string };
  /**
   * Ask the author something out of character (SPEC §7).
   *
   * It goes through here rather than through a plain mutation because the
   * answer arrives on the stream like any other generation — and a caller that
   * only posted would show the question, never the answer, and have nothing to
   * invalidate on.
   */
  ooc?: { question: string };
  /** One voice or the whole room (SPEC §3.5). Defaults to a spotlight. */
  scope?: TurnScope;
  beatBound?: BeatBound;
  /**
   * Rewrite one character's part of an existing beat. The result is spliced
   * into that beat rather than appended, so nothing new appears in the log —
   * the message being corrected changes under the reader.
   */
  recast?: { messageId: string; ordinal: number };
}

interface ServerEvent {
  type: "director" | "chunk" | "reasoning" | "done" | "cancelled" | "error";
  offset?: number;
  text?: string;
  message?: string;
  detail?: string | null;
  /** `director` only: who the turn director settled on, and why (SPEC §6). */
  characterId?: string | null;
  name?: string;
  reason?: string;
  source?: "user" | "director";
  scope?: "spotlight" | "beat";
}

/** Backoff between reconnection attempts, in milliseconds. */
const RETRY_DELAYS = [250, 500, 1_000, 2_000, 4_000];

export function useGeneration() {
  const client = useQueryClient();
  const store = useGenerationStore();
  const abortRef = useRef<AbortController | null>(null);

  // Read the live buffer without making the streaming loop depend on it.
  const offsetOf = useCallback((generationId: string): number => {
    const active = useGenerationStore.getState().active;
    return active !== null && active.generationId === generationId ? active.offset : 0;
  }, []);

  const consume = useCallback(
    async (generationId: string, sceneId: string) => {
      const store = useGenerationStore.getState();
      let attempt = 0;

      for (;;) {
        const controller = new AbortController();
        abortRef.current = controller;
        let sawTerminal = false;

        try {
          const response = await fetch(
            `/api/generations/${generationId}/stream?offset=${offsetOf(generationId)}`,
            { signal: controller.signal, headers: { Accept: "text/event-stream" } },
          );
          if (!response.ok || response.body === null) throw new Error(String(response.status));

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
              // A heartbeat is a comment line with no data; skip it.
              if (dataAt === -1) continue;

              let event: ServerEvent;
              try {
                event = JSON.parse(frame.slice(dataAt + 6)) as ServerEvent;
              } catch {
                continue;
              }

              if (event.type === "director") {
                // Who is speaking, decided after the request returned because
                // the classifier is a model call (SPEC §6). The composer said
                // "choosing" until now.
                store.direct(generationId, {
                  characterId: event.characterId ?? null,
                  name: event.name ?? "",
                  reason: event.reason ?? "",
                  source: event.source ?? "director",
                  scope: event.scope ?? "spotlight",
                });
              } else if (event.type === "chunk") {
                attempt = 0; // progress resets the backoff
                store.appendAt(generationId, event.offset ?? 0, event.text ?? "");
              } else if (event.type === "reasoning") {
                // Reasoning counts as progress too: a model that thinks for
                // twenty seconds before its first word is working, not stalled,
                // and resetting the backoff is what stops a reconnect storm.
                attempt = 0;
                store.appendReasoning(generationId, event.text ?? "");
              } else {
                sawTerminal = true;
                store.settle(
                  generationId,
                  event.type === "done" ? "done" : event.type,
                  event.message ?? null,
                );
                // §5's completion chime, for a turn that finished while the
                // reader was somewhere else. On the scene they are watching the
                // prose arriving is the notification, and a sound over it would
                // be the app talking during the story.
                if (event.type === "done" && document.hidden) chimeIfWanted();
                // Invalidate here, on the terminal event itself, not after the
                // stream loop exits: the message has landed in the tree, and
                // the refetch must not wait on a reader that a proxy or a
                // dropped connection can leave hanging. This is the one place
                // guaranteed to run when a turn finishes.
                void client.invalidateQueries({ queryKey: keys.scene(sceneId) });
                void client.invalidateQueries({ queryKey: keys.scenes });
                void client.invalidateQueries({ queryKey: keys.autopilot(sceneId) });
              }
            }
          }
        } catch {
          // A dropped connection is the expected case on a phone, not a
          // failure: fall through to the reconnect below.
        }

        if (sawTerminal || controller.signal.aborted) break;

        const delay = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]!;
        attempt += 1;
        if (attempt > RETRY_DELAYS.length * 2) {
          store.settle(generationId, "error", "Lost contact with the server.");
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      abortRef.current = null;
      // The message landed in the tree, so the scene has to be re-read. The
      // autopilot row too: a settled turn is exactly when the loop decides
      // whether another one follows (§6), and the strip must not lag it.
      void client.invalidateQueries({ queryKey: keys.scene(sceneId) });
      void client.invalidateQueries({ queryKey: keys.scenes });
      void client.invalidateQueries({ queryKey: keys.autopilot(sceneId) });
    },
    [client, offsetOf],
  );

  const start = useCallback(
    async (args: StartArgs) => {
      const { recast, revise, ooc } = args;
      let started: { id: string };
      try {
        started =
          ooc !== undefined
            ? (
                await api.post<{ generation: { id: string } }>(`/scenes/${args.sceneId}/ooc`, {
                  question: ooc.question,
                })
              ).generation
            : recast !== undefined
            ? await api.post<{ id: string }>(
                `/scenes/${args.sceneId}/messages/${recast.messageId}/recast`,
                { ordinal: recast.ordinal },
              )
            : revise !== undefined
              ? await api.post<{ id: string }>(
                  `/scenes/${args.sceneId}/messages/${revise.messageId}/revise`,
                  {
                    mode: revise.mode,
                    ...(revise.instructions === undefined
                      ? {}
                      : { instructions: revise.instructions }),
                  },
                )
              : await api.post<{ id: string }>(`/scenes/${args.sceneId}/generate`, {
                  ...(args.parentId === undefined ? {} : { parentId: args.parentId }),
                  ...(args.characterId == null ? {} : { characterId: args.characterId }),
                  ...(args.scope === undefined ? {} : { scope: args.scope }),
                  ...(args.beatBound === undefined ? {} : { beatBound: args.beatBound }),
                  ...(args.nudge === undefined ? {} : { nudge: args.nudge }),
                });
      } catch (caught) {
        // The turn never started — the POST was refused. Surface it in the
        // chat rather than leaving it to the console (SPEC §5): the reader
        // should see *why* nothing happened, and how to fix it, in place.
        const error = caught as ApiRequestError;
        useGenerationStore.getState().failStart({
          message: error.message ?? "The scene could not start a reply.",
          code: error.code ?? "unexpected",
        });
        return null;
      }

      useGenerationStore.getState().begin({
        generationId: started.id,
        sceneId: args.sceneId,
        sceneTitle: args.sceneTitle,
        speaker: args.speaker,
        ...(recast === undefined ? {} : { recast }),
      });
      void consume(started.id, args.sceneId);
      return started.id;
    },
    [consume],
  );

  const cancel = useCallback(async () => {
    const active = useGenerationStore.getState().active;
    if (active === null) return;
    await api.post(`/generations/${active.generationId}/cancel`);
  }, []);

  /**
   * Watch a generation this client did not start — autopilot's next turn, or
   * one that began while the tab was suspended. Same stream, same store, same
   * streaming row; the only thing not done here is the POST (SPEC §5, §6).
   */
  const adopt = useCallback(
    async (args: { generationId: string; sceneId: string; sceneTitle: string }) => {
      const current = useGenerationStore.getState().active;
      if (current !== null && current.generationId === args.generationId) return;
      useGenerationStore.getState().begin({
        generationId: args.generationId,
        sceneId: args.sceneId,
        sceneTitle: args.sceneTitle,
        speaker: null,
      });
      void consume(args.generationId, args.sceneId);
    },
    [consume],
  );

  // Stop reading when the app unmounts. The generation itself keeps going —
  // that is the whole point of the server owning it.
  useEffect(() => () => abortRef.current?.abort(), []);

  return {
    active: store.active,
    startError: store.startError,
    start,
    adopt,
    cancel,
    clear: store.clear,
    clearStartError: store.clearStartError,
  };
}
