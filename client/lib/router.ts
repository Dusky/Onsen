import { useEffect, useRef, useState } from "react";

/**
 * A small fixed-set router over the History API.
 *
 * Written rather than pulled in because the app has a closed set of routes and
 * needs exactly two things from a router: real URLs, so a deep link into a
 * scene survives a reload, and back-button behaviour that matches a phone's.
 * The server already falls back to index.html for unknown paths, so both work.
 *
 * No route state is persisted anywhere: the URL is the state.
 */

export type Route =
  | { name: "scenes" }
  | { name: "chat"; sceneId: string }
  | { name: "characters" }
  | { name: "character"; characterId: string }
  | { name: "authors" }
  | { name: "personas" }
  | { name: "author"; authorId: string }
  | { name: "setup"; sceneId: string }
  | { name: "settings" }
  | { name: "lorebooks" }
  | { name: "lorebook"; bookId: string }
  | { name: "backgrounds" }
  /** Anything unrecognised lands on the scenes list. */
  | { name: "unknown" };

export function parseRoute(pathname: string): Route {
  if (pathname === "/" || pathname === "/scenes") return { name: "scenes" };
  const setup = /^\/scenes\/([^/]+)\/setup\/?$/.exec(pathname);
  if (setup !== null) return { name: "setup", sceneId: decodeURIComponent(setup[1]!) };
  const scene = /^\/scenes\/([^/]+)\/?$/.exec(pathname);
  if (scene !== null) return { name: "chat", sceneId: decodeURIComponent(scene[1]!) };
  if (pathname === "/characters") return { name: "characters" };
  if (pathname === "/settings") return { name: "settings" };
  if (pathname === "/lorebooks") return { name: "lorebooks" };
  if (pathname === "/backgrounds") return { name: "backgrounds" };
  const book = /^\/lorebooks\/([^/]+)\/?$/.exec(pathname);
  if (book !== null) return { name: "lorebook", bookId: decodeURIComponent(book[1]!) };
  if (pathname === "/authors") return { name: "authors" };
  if (pathname === "/personas") return { name: "personas" };
  const author = /^\/authors\/([^/]+)\/?$/.exec(pathname);
  if (author !== null) return { name: "author", authorId: decodeURIComponent(author[1]!) };
  const character = /^\/characters\/([^/]+)\/?$/.exec(pathname);
  if (character !== null) {
    return { name: "character", characterId: decodeURIComponent(character[1]!) };
  }
  return { name: "unknown" };
}

export function pathFor(route: Route): string {
  switch (route.name) {
    case "chat":
      return `/scenes/${encodeURIComponent(route.sceneId)}`;
    case "characters":
      return "/characters";
    case "character":
      return `/characters/${encodeURIComponent(route.characterId)}`;
    case "authors":
      return "/authors";
    case "personas":
      return "/personas";
    case "author":
      return `/authors/${encodeURIComponent(route.authorId)}`;
    case "setup":
      return `/scenes/${encodeURIComponent(route.sceneId)}/setup`;
    case "settings":
      return "/settings";
    case "lorebooks":
      return "/lorebooks";
    case "backgrounds":
      return "/backgrounds";
    case "lorebook":
      return `/lorebooks/${encodeURIComponent(route.bookId)}`;
    case "scenes":
    case "unknown":
      return "/";
  }
}

export function navigate(route: Route): void {
  const path = pathFor(route);
  if (path !== window.location.pathname) {
    window.history.pushState(null, "", path);
  }
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));

  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", onChange);
    return () => window.removeEventListener("popstate", onChange);
  }, []);

  return route;
}

/**
 * The two screens a reader actually lives in (§20 phase 171).
 *
 * Everything else — Settings, the character and author editors, the
 * lorebook and persona lists, scene setup, backdrops — is a destination you
 * visit *from* one of these and mean to come back to. That's the split
 * `useShellRoute` renders on: one of these two stays mounted no matter what
 * else the URL names.
 */
function isBaseRoute(route: Route): boolean {
  return route.name === "scenes" || route.name === "chat" || route.name === "unknown";
}

/**
 * Which screen is the persistent base, and which — if any — is floating on
 * top of it (§20 phase 171).
 *
 * `Route` itself is untouched: every existing `navigate()` call site still
 * just names where the URL should point, and the URL still *is* the state,
 * deep-linkable and back-button-correct. Only rendering changes — `Shell`
 * stops swapping its one mounted screen for another and instead keeps the
 * base mounted always, layering the overlay screen on top when the current
 * route is not one of the two base names.
 *
 * The last base route seen is **module state, not a ref** (§20 phase 180).
 * It began as a `useRef`, when `Shell` was the only caller and a ref was the
 * same thing. It is not the same thing once anything else asks: a ref is per
 * component instance, so each caller remembers only the base routes it was
 * itself mounted for, and two callers can disagree about which roleplay is
 * open. That is exactly what happened when the header started asking — it had
 * mounted on an overlay route and answered "no roleplay" while `Shell` had a
 * chat mounted behind it.
 *
 * It is written during render rather than in an effect: an effect would run
 * one render late, so the very first paint after navigating straight to an
 * overlay route (a fresh load of `/settings`, say) would still see the
 * *previous* base — there being none yet — undefined. Writing it inline is
 * safe because it is idempotent (the same route in, the same value out,
 * however many times this render happens to run) and it schedules no render
 * of its own, which is what makes a write during render sanctioned rather
 * than a footgun.
 */
let lastBase: Route = { name: "scenes" };

export function useShellRoute(): { base: Route; overlay: Route | null } {
  const route = useRoute();
  const isBase = isBaseRoute(route);
  if (isBase) lastBase = route;
  return { base: lastBase, overlay: isBase ? null : route };
}
