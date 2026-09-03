import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The per-scene channel (SPEC §5).
 *
 * "The same scene may be open on a phone and a desktop. Broadcast active-leaf
 * changes and generation events over a per-scene channel so both clients
 * converge."
 *
 * In process and in memory, deliberately. This app is one server serving one
 * person's devices; a durable queue would be machinery for a fan-out that is
 * never more than a handful of sockets, and a message nobody was connected for
 * is a message about state the reconnecting client will read from the database
 * anyway.
 *
 * Nothing here carries content. Every event says *what changed*, and the client
 * refetches — so a subscriber that missed one and a subscriber that got it
 * converge on the same request, and there is no path where the channel and the
 * database can disagree about what the scene says.
 */

export type SceneEvent =
  /**
   * The active leaf moved. `origin` is the client that caused it, so the one
   * that did the writing can ignore its own echo — §5's last-write-wins needs a
   * loser to know it lost, and the winner not to prompt itself.
   */
  | {
      type: "leaf";
      messageId: string | null;
      /**
       * What the new head hangs off. A device showing this is looking at the
       * turn the new one continues and can take it; one showing anything else
       * has been moved off its branch, which is the case the prompt is for.
       */
      parentId: string | null;
      origin: string | null;
    }
  /** A generation began or ended here, for the other device's indicator. */
  | { type: "generation"; state: "started" | "finished"; generationId: string }
  /** The tree changed in a way that is not a leaf move: an edit, a delete. */
  | { type: "history"; origin: string | null };

type Listener = (event: SceneEvent) => void;

export class SceneChannel {
  private readonly listeners = new Map<string, Set<Listener>>();

  subscribe(sceneUlid: string, listener: Listener): () => void {
    let set = this.listeners.get(sceneUlid);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(sceneUlid, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(sceneUlid);
    };
  }

  /** How many devices are listening to this scene. Used by the tests. */
  countFor(sceneUlid: string): number {
    return this.listeners.get(sceneUlid)?.size ?? 0;
  }

  publish(sceneUlid: string, event: SceneEvent): void {
    const set = this.listeners.get(sceneUlid);
    if (set === undefined) return;
    // A copy, because a listener that unsubscribes on delivery would otherwise
    // mutate the set being iterated.
    for (const listener of [...set]) {
      try {
        listener(event);
      } catch {
        /* One dead socket does not stop the others. */
      }
    }
  }
}

/**
 * The one channel the process uses.
 *
 * A singleton rather than a value threaded through every query, because the
 * leaf moves in three places inside the storage layer and passing an emitter
 * down to each would put a notification concern into functions whose job is a
 * SQL statement. What is threaded instead is the *origin* — see `withOrigin`.
 */
export const sceneChannel = new SceneChannel();

/**
 * Which client is doing the current request.
 *
 * `AsyncLocalStorage` rather than a module-level variable, because a handler is
 * async: a plain variable restored when the function returns would be restored
 * at the first `await`, and every publish after that would read whichever
 * request happened to set it last. This is the one thing that has to be right
 * for last-write-wins to work at all — an origin that leaks between requests
 * makes a client ignore an echo that was not its own.
 */
const origins = new AsyncLocalStorage<string | null>();

export function withOrigin<T>(origin: string | null, run: () => T): T {
  return origins.run(origin, run);
}

export function originOfRequest(): string | null {
  return origins.getStore() ?? null;
}
