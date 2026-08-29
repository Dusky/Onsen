import { useEffect, useState } from "react";

/**
 * A two-screen router over the History API.
 *
 * Written rather than pulled in because the app has two routes and needs
 * exactly two things from a router: real URLs, so a deep link into a scene
 * survives a reload, and back-button behaviour that matches a phone's. The
 * server already falls back to index.html for unknown paths, so both work.
 *
 * No route state is persisted anywhere: the URL is the state.
 */

export type Route =
  | { name: "scenes" }
  | { name: "chat"; sceneId: string }
  | { name: "characters" }
  | { name: "character"; characterId: string }
  /** Anything unrecognised lands on the scenes list. */
  | { name: "unknown" };

export function parseRoute(pathname: string): Route {
  if (pathname === "/" || pathname === "/scenes") return { name: "scenes" };
  const scene = /^\/scenes\/([^/]+)\/?$/.exec(pathname);
  if (scene !== null) return { name: "chat", sceneId: decodeURIComponent(scene[1]!) };
  if (pathname === "/characters") return { name: "characters" };
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
