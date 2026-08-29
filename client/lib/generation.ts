import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";
import { keys } from "./queries.ts";
import { useGenerationStore } from "../state/generation.ts";

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
  speaker: string;
  /** Names a parent to fork from — how a reroll asks for a sibling. */
  parentId?: string | null;
  /** Forces who speaks, overriding the turn director for this turn. */
  characterId?: string | null;
}

interface ServerEvent {
  type: "chunk" | "done" | "cancelled" | "error";
  offset?: number;
  text?: string;
  message?: string;
  detail?: string | null;
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

              if (event.type === "chunk") {
                attempt = 0; // progress resets the backoff
                store.appendAt(generationId, event.offset ?? 0, event.text ?? "");
              } else {
                sawTerminal = true;
                store.settle(
                  generationId,
                  event.type === "done" ? "done" : event.type,
                  event.message ?? null,
                );
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
      // The message landed in the tree, so the scene has to be re-read.
      void client.invalidateQueries({ queryKey: keys.scene(sceneId) });
      void client.invalidateQueries({ queryKey: keys.scenes });
    },
    [client, offsetOf],
  );

  const start = useCallback(
    async (args: StartArgs) => {
      const body: Record<string, unknown> = {};
      if (args.parentId !== undefined) body["parentId"] = args.parentId;
      if (args.characterId != null) body["characterId"] = args.characterId;
      const started = await api.post<{ id: string }>(`/scenes/${args.sceneId}/generate`, body);
      useGenerationStore.getState().begin({
        generationId: started.id,
        sceneId: args.sceneId,
        sceneTitle: args.sceneTitle,
        speaker: args.speaker,
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

  // Stop reading when the app unmounts. The generation itself keeps going —
  // that is the whole point of the server owning it.
  useEffect(() => () => abortRef.current?.abort(), []);

  return { active: store.active, start, cancel, clear: store.clear };
}
