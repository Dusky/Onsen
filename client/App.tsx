import { useCallback, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SetupScreen } from "./screens/SetupScreen.tsx";
import { LoginScreen } from "./screens/LoginScreen.tsx";
import { ScenesScreen } from "./screens/ScenesScreen.tsx";
import { ChatScreen } from "./screens/ChatScreen.tsx";
import { CharactersScreen } from "./screens/CharactersScreen.tsx";
import { CharacterEditorScreen } from "./screens/CharacterEditorScreen.tsx";
import { AuthorsScreen, AuthorEditorScreen } from "./screens/AuthorsScreen.tsx";
import { SceneSetupScreen } from "./screens/SceneSetupScreen.tsx";
import { SettingsScreen } from "./screens/SettingsScreen.tsx";
import { LorebooksScreen } from "./screens/LorebooksScreen.tsx";
import { LorebookEditorScreen } from "./screens/LorebookEditorScreen.tsx";
import { api } from "./lib/api.ts";
import { strings } from "./strings.ts";
import { useRoute } from "./lib/router.ts";
import { useIsDesktop } from "./lib/breakpoint.ts";
import { Sidebar } from "./components/Sidebar.tsx";
import { WritingElsewhere } from "./components/WritingElsewhere.tsx";
import { setChimeWanted, unlockAudio } from "./lib/chime.ts";
import { usePreferences } from "./lib/queries.ts";
import { useViewportHeight } from "./lib/viewport.ts";
import type { BootstrapDto } from "@shared/types.ts";

/**
 * Server state is cached but never stale for long: the message tree is
 * authoritative on the server, and a generation can change it without this
 * client asking.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5_000, refetchOnWindowFocus: true, retry: 1 },
  },
});

type Phase = { status: "loading" } | { status: "error" } | { status: "ready"; boot: BootstrapDto };

/**
 * UI state lives in memory only. No localStorage or sessionStorage anywhere in
 * this app (HANDOFF non-negotiable 8) — server state is in SQLite, and what
 * survives a reload is the session cookie and nothing else.
 */
export function App() {
  const [phase, setPhase] = useState<Phase>({ status: "loading" });
  useViewportHeight();

  const refresh = useCallback(async () => {
    try {
      setPhase({ status: "ready", boot: await api.get<BootstrapDto>("/bootstrap") });
    } catch {
      setPhase({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (phase.status === "loading") {
    return (
      <div className="flex screen-height items-center justify-center">
        <p className="chrome text-[10.5px] text-ink-dim">
          {strings.common.working}
        </p>
      </div>
    );
  }

  if (phase.status === "error") {
    return (
      <div className="flex screen-height items-center justify-center px-[22px]">
        <p className="chrome text-center text-[11.5px] text-red-text">
          {strings.errors.network}
        </p>
      </div>
    );
  }

  if (!phase.boot.setupCompleted) {
    return <SetupScreen onComplete={() => void refresh()} />;
  }
  if (!phase.boot.authenticated) {
    return <LoginScreen onAuthenticated={() => void refresh()} />;
  }
  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  );
}

/**
 * The shell (design `4a`, SPEC §16).
 *
 * On a phone a screen is the whole window and navigation is the tab bar at the
 * bottom. With room, the tab bar unrolls into a persistent sidebar beside every
 * screen — same destinations, same treatment, more space — and the screens
 * themselves are unchanged: each one still renders its own header, body and
 * footer into whatever column it is given.
 */
function Shell() {
  const isDesktop = useIsDesktop();
  const preferences = usePreferences();

  // §5's chime, and the autoplay policy that shapes it. A browser will not let
  // a page make a sound before the person has interacted with it, so the audio
  // context is built on the first gesture the app sees and nothing before then
  // can ring.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    setChimeWanted(preferences.data?.completionChime === true);
  }, [preferences.data?.completionChime]);

  // The cross-screen generation indicator sits above whatever screen is
  // showing, on both layouts: a reader who wandered off gets one way back
  // wherever they wandered to (SPEC §5, design §403).
  if (!isDesktop) {
    return (
      <div className="flex screen-height flex-col bg-bg">
        <WritingElsewhere />
        <div className="flex min-h-0 flex-1 flex-col">
          <Routed />
        </div>
      </div>
    );
  }
  return (
    <div className="flex screen-height bg-bg">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <WritingElsewhere />
        <div className="flex min-h-0 flex-1 flex-col">
          <Routed />
        </div>
      </div>
    </div>
  );
}

function Routed() {
  const route = useRoute();
  switch (route.name) {
    case "chat":
      return <ChatScreen sceneId={route.sceneId} />;
    case "characters":
      return <CharactersScreen />;
    case "character":
      return <CharacterEditorScreen characterId={route.characterId} />;
    case "authors":
      return <AuthorsScreen />;
    case "author":
      return <AuthorEditorScreen authorId={route.authorId} />;
    case "setup":
      return <SceneSetupScreen sceneId={route.sceneId} />;
    case "settings":
      return <SettingsScreen />;
    case "lorebooks":
      return <LorebooksScreen />;
    case "lorebook":
      return <LorebookEditorScreen bookId={route.bookId} />;
    case "scenes":
    case "unknown":
      return <ScenesScreen />;
  }
}
