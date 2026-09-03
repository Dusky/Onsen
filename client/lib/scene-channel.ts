import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CLIENT_ID } from "./api.ts";
import { keys } from "./queries.ts";

/**
 * The per-scene channel (SPEC §5).
 *
 * The same scene may be open on a phone and a desktop. This listens to what
 * happened there so the two converge — and, where they cannot converge
 * silently, so this one can say so.
 *
 * `EventSource` this time rather than `fetch` plus a reader. The generation
 * stream needs its own reconnect because resuming has to move an offset;
 * nothing here is offsetted, and EventSource's automatic reconnect is exactly
 * the behaviour a channel that must survive a phone sleeping wants.
 */

interface LeafEvent {
  type: "leaf";
  messageId: string | null;
  /** What the new head hangs off. Null on the opening frame. */
  parentId: string | null;
  origin: string | null;
}

interface GenerationEvent {
  type: "generation";
  state: "started" | "finished";
  generationId: string;
}

interface HistoryEvent {
  type: "history";
  origin: string | null;
}

export interface SceneChannelState {
  /**
   * Set when another device moved this scene's head somewhere this one is not.
   * §5: the losing client shows a "chat moved" prompt rather than silently
   * diverging — silently jumping the reader to someone else's branch mid-
   * sentence is the failure that rule exists to prevent.
   */
  movedTo: string | null;
  /** Whether a turn is being written by another device right now. */
  writingElsewhere: boolean;
  /** Take the move: refetch and clear the prompt. */
  accept(): void;
}

export function useSceneChannel(
  sceneId: string | null,
  /** The head the scene query last returned. */
  fetchedLeafId: string | null,
): SceneChannelState {
  const client = useQueryClient();
  const [movedTo, setMovedTo] = useState<string | null>(null);
  const [writingElsewhere, setWritingElsewhere] = useState(false);

  /**
   * The head this client is *showing*, which is not the same as the head it
   * last fetched.
   *
   * Tracked here rather than by the caller because the caller's version of it
   * depends on `movedTo`, and reading a value out of this hook to feed back
   * into it lags a render — which, the first time it happened, meant the hook
   * always saw `null` and converged silently instead of prompting.
   *
   * Read inside the handlers rather than closed over, so the subscription is
   * not torn down and rebuilt on every message the reader sends.
   */
  const local = useRef<string | null>(fetchedLeafId);
  if (movedTo === null) local.current = fetchedLeafId;

  useEffect(() => {
    if (sceneId === null) return;
    setMovedTo(null);
    setWritingElsewhere(false);

    const source = new EventSource(`/api/scenes/${sceneId}/events`);

    source.addEventListener("leaf", (message) => {
      const event = JSON.parse((message as MessageEvent<string>).data) as LeafEvent;
      // Our own write, echoed back. The winner does not prompt itself.
      if (event.origin === CLIENT_ID) return;
      if (event.messageId === local.current) {
        setMovedTo(null);
        return;
      }
      // A scene this client has not drawn yet has nothing to diverge from, so
      // the first event after connecting converges rather than prompting.
      if (local.current === null) {
        void client.invalidateQueries({ queryKey: keys.scene(sceneId) });
        return;
      }
      // A turn written onto the branch this client is showing is a
      // continuation, not a divergence: it simply appears, which is what a
      // scene open on two devices should look like. Prompting on every turn the
      // other device wrote would make the feature unusable.
      if (event.parentId !== null && event.parentId === local.current) {
        void client.invalidateQueries({ queryKey: keys.scene(sceneId) });
        return;
      }
      setMovedTo(event.messageId);
    });

    source.addEventListener("history", (message) => {
      const event = JSON.parse((message as MessageEvent<string>).data) as HistoryEvent;
      if (event.origin === CLIENT_ID) return;
      // An edit changes text in place. There is nothing to prompt about — the
      // reader is looking at the same turn, and it now says something else.
      void client.invalidateQueries({ queryKey: keys.scene(sceneId) });
    });

    source.addEventListener("generation", (message) => {
      const event = JSON.parse((message as MessageEvent<string>).data) as GenerationEvent;
      setWritingElsewhere(event.state === "started");
      if (event.state === "finished") {
        void client.invalidateQueries({ queryKey: keys.scene(sceneId) });
      }
    });

    return () => source.close();
  }, [sceneId, client]);

  return {
    movedTo,
    writingElsewhere,
    accept() {
      setMovedTo(null);
      if (sceneId !== null) void client.invalidateQueries({ queryKey: keys.scene(sceneId) });
    },
  };
}
